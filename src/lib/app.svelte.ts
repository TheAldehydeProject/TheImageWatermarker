/**
 * Application state: the file list, settings and the actions that run jobs.
 * Uses Svelte 5 runes so components update automatically.
 */
import { zipSync } from 'fflate';
import ProcessWorker from '../workers/process.worker?worker';
import { outputFileName, uniqueNames } from './filename';
import { detectFormat, type InputFormat, type OutputFormat } from './formats';
import type { RGBAImage } from './image';
import type { ProcessedFile } from './protocol';
import {
  jobSpecFor,
  loadSettings,
  saveSettings,
  specKey,
  watermarkSpecFor,
  type AppSettings,
  type JobSpec,
  type Tool,
} from './settings';
import { WorkerPool } from './workerPool';

export const PREVIEW_SIZE = 1400;
const THUMB_SIZE = 112;

export interface Preview {
  image: RGBAImage;
  fullWidth: number;
  fullHeight: number;
}

export interface FileResult {
  url: string;
  name: string;
  size: number;
  format: OutputFormat;
  width: number;
  height: number;
  lossless: boolean;
  keptOriginal: boolean;
  notes: string[];
  tool: Tool;
  blob: Blob;
}

/** A watermark result generated only for viewing: not downloaded, not in the ZIP. */
export interface DraftResult extends FileResult {
  /** specKey() of the settings it was made with, to tell when it is out of date. */
  key: string;
}

export type ResultKind = 'result' | 'draft';

export interface FileEntry {
  id: number;
  file: File;
  format: InputFormat | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  status: 'idle' | 'processing' | 'done' | 'error';
  error: string | null;
  previewError: string | null;
  result: FileResult | null;
  draft: DraftResult | null;
  draftStatus: 'idle' | 'working' | 'error';
  draftError: string | null;
}

let nextId = 1;

const pool = new WorkerPool(
  () => new ProcessWorker({ name: 'image-processor' }),
  Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1)),
);

async function thumbnailUrl(img: RGBAImage): Promise<string> {
  const scale = Math.min(1, THUMB_SIZE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const src = new OffscreenCanvas(img.width, img.height);
  src
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const dst = new OffscreenCanvas(w, h);
  const ctx = dst.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return URL.createObjectURL(await dst.convertToBlob({ type: 'image/png' }));
}

class AppState {
  settings = $state<AppSettings>(loadSettings());
  files = $state<FileEntry[]>([]);
  selectedId = $state<number | null>(null);
  busy = $state(false);
  progress = $state({ done: 0, total: 0 });
  /** Large previews are kept for a few files only, to limit memory use. */
  private previews = new Map<string, Promise<Preview>>();
  private resultPreviews = new Map<string, Promise<Preview>>();
  private draftPreviews = new Map<string, Promise<Preview>>();

  selected = $derived(this.files.find((f) => f.id === this.selectedId) ?? null);
  doneCount = $derived(this.files.filter((f) => f.result).length);

  constructor() {
    $effect.root(() => {
      $effect(() => {
        saveSettings($state.snapshot(this.settings) as AppSettings);
      });
    });
  }

  setTool(tool: Tool): void {
    this.settings.tool = tool;
  }

  addFiles(list: Iterable<File>): void {
    const added: FileEntry[] = [];
    for (const file of list) {
      const entry: FileEntry = {
        id: nextId++,
        file,
        format: null,
        thumbUrl: null,
        width: null,
        height: null,
        status: 'idle',
        error: null,
        previewError: null,
        result: null,
        draft: null,
        draftStatus: 'idle',
        draftError: null,
      };
      added.push(entry);
    }
    if (!added.length) return;
    this.files.push(...added);
    this.selectedId ??= added[0].id;
    for (const entry of added) void this.loadPreview(entry.id);
  }

  private entry(id: number): FileEntry | undefined {
    return this.files.find((f) => f.id === id);
  }

  /** Decodes a file once to learn its size and make a thumbnail. */
  private async loadPreview(id: number): Promise<void> {
    const e = this.entry(id);
    if (!e) return;
    const head = new Uint8Array(await e.file.slice(0, 64).arrayBuffer());
    e.format = detectFormat(head, e.file.name);
    if (!e.format) {
      e.previewError = 'This file type is not supported.';
      return;
    }
    try {
      const preview = await this.preview(id);
      const cur = this.entry(id);
      if (!cur) return;
      cur.width = preview.fullWidth;
      cur.height = preview.fullHeight;
      cur.thumbUrl = await thumbnailUrl(preview.image);
      this.trimPreviews();
    } catch (err) {
      const cur = this.entry(id);
      if (cur) cur.previewError = err instanceof Error ? err.message : String(err);
    }
  }

  /** The original image, downscaled for on-screen previews (cached for recent files). */
  preview(id: number, maxSize = PREVIEW_SIZE): Promise<Preview> {
    const key = `${id}:${maxSize}`;
    const cached = this.previews.get(key);
    if (cached) return cached;
    const e = this.entry(id);
    if (!e) return Promise.reject(new Error('File was removed'));
    const p = this.decode(e.file, e.file.name, maxSize);
    this.previews.set(key, p);
    p.catch(() => this.previews.delete(key));
    return p;
  }

  /** The processed result (or generated preview), decoded at the same scale as `preview`. */
  resultPreview(id: number, maxSize = PREVIEW_SIZE, kind: ResultKind = 'result'): Promise<Preview> {
    const e = this.entry(id);
    const output = kind === 'draft' ? e?.draft : e?.result;
    if (!output) return Promise.reject(new Error('Not processed yet'));
    const cache = kind === 'draft' ? this.draftPreviews : this.resultPreviews;
    const key = `${id}:${maxSize}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const p = this.decode(output.blob, output.name, maxSize);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    return p;
  }

  private async decode(blob: Blob, name: string, maxSize: number): Promise<Preview> {
    const res = await pool.run(async () => {
      const bytes = await blob.arrayBuffer();
      return { job: { type: 'preview', name, bytes, maxSize }, transfer: [bytes] };
    });
    if (res.type !== 'preview-done') throw new Error('Unexpected reply');
    const p = res.preview;
    return {
      image: { width: p.width, height: p.height, data: new Uint8ClampedArray(p.pixels) },
      fullWidth: p.fullWidth,
      fullHeight: p.fullHeight,
    };
  }

  /** Drops cached previews of files other than the selected one, keeping a few. */
  private trimPreviews(): void {
    for (const cache of [this.previews, this.resultPreviews, this.draftPreviews]) {
      for (const key of [...cache.keys()]) {
        if (cache.size <= 4) break;
        if (!key.startsWith(`${this.selectedId}:`)) cache.delete(key);
      }
    }
  }

  private forget(cache: Map<string, Promise<Preview>>, id: number): void {
    for (const key of [...cache.keys()]) if (key.startsWith(`${id}:`)) cache.delete(key);
  }

  select(id: number): void {
    this.selectedId = id;
    this.trimPreviews();
  }

  remove(id: number): void {
    const i = this.files.findIndex((f) => f.id === id);
    if (i === -1) return;
    const [e] = this.files.splice(i, 1);
    if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl);
    if (e.result) URL.revokeObjectURL(e.result.url);
    if (e.draft) URL.revokeObjectURL(e.draft.url);
    this.forget(this.previews, id);
    this.forget(this.resultPreviews, id);
    this.forget(this.draftPreviews, id);
    if (this.selectedId === id)
      this.selectedId = this.files[Math.min(i, this.files.length - 1)]?.id ?? null;
  }

  clear(): void {
    for (const f of [...this.files]) this.remove(f.id);
  }

  /** The job the Watermark tool would run right now (used to spot stale previews). */
  watermarkSpec(): JobSpec {
    return watermarkSpecFor($state.snapshot(this.settings) as AppSettings);
  }

  private runJob(file: File, spec: JobSpec) {
    return pool.run(async () => {
      const bytes = await file.arrayBuffer();
      return { job: { type: 'process', name: file.name, bytes, spec }, transfer: [bytes] };
    });
  }

  /**
   * Makes the exact watermarked file for one image so it can be inspected,
   * without downloading it or marking the image as processed.
   */
  async generateDraft(id: number): Promise<void> {
    const e = this.entry(id);
    if (!e?.format || e.draftStatus === 'working') return;
    const spec = this.watermarkSpec();
    e.draftStatus = 'working';
    e.draftError = null;
    try {
      const res = await this.runJob(e.file, spec);
      if (res.type !== 'process-done') throw new Error('Unexpected reply');
      const cur = this.entry(id);
      if (!cur) return;
      if (cur.draft) URL.revokeObjectURL(cur.draft.url);
      this.forget(this.draftPreviews, id);
      cur.draft = {
        ...this.makeResult(cur, res.file, 'watermark', spec.suffix),
        key: specKey(spec),
      };
      cur.draftStatus = 'idle';
    } catch (err) {
      const cur = this.entry(id);
      if (cur) {
        cur.draftStatus = 'error';
        cur.draftError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  /** Runs the active tool on every file. */
  async processAll(): Promise<void> {
    if (this.busy) return;
    const targets = this.files.filter((f) => f.format);
    if (!targets.length) return;
    const settings = $state.snapshot(this.settings) as AppSettings;
    const spec = jobSpecFor(settings);
    this.busy = true;
    this.progress = { done: 0, total: targets.length };
    await Promise.all(
      targets.map(async (t) => {
        const e = this.entry(t.id);
        if (!e) return;
        e.status = 'processing';
        e.error = null;
        try {
          const res = await this.runJob(e.file, spec);
          if (res.type !== 'process-done') throw new Error('Unexpected reply');
          this.setResult(t.id, res.file, settings.tool, spec.suffix);
        } catch (err) {
          const cur = this.entry(t.id);
          if (cur) {
            cur.status = 'error';
            cur.error = err instanceof Error ? err.message : String(err);
          }
        } finally {
          this.progress.done++;
        }
      }),
    );
    this.busy = false;
  }

  private makeResult(e: FileEntry, f: ProcessedFile, tool: Tool, suffix: string): FileResult {
    const blob = new Blob([f.bytes], { type: f.mime });
    return {
      url: URL.createObjectURL(blob),
      name: outputFileName(e.file.name, f.extension, suffix),
      size: blob.size,
      format: f.format,
      width: f.width,
      height: f.height,
      lossless: f.lossless,
      keptOriginal: f.keptOriginal,
      notes: f.notes,
      tool,
      blob,
    };
  }

  private setResult(id: number, f: ProcessedFile, tool: Tool, suffix: string): void {
    const e = this.entry(id);
    if (!e) return;
    if (e.result) URL.revokeObjectURL(e.result.url);
    this.forget(this.resultPreviews, id);
    e.result = this.makeResult(e, f, tool, suffix);
    e.status = 'done';
  }

  /** Bundles every finished file into one ZIP download. */
  async zipResults(): Promise<Blob | null> {
    const done = this.files.filter((f) => f.result).map((f) => f.result!);
    if (!done.length) return null;
    const names = uniqueNames(done.map((r) => r.name));
    const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
    const contents = await Promise.all(done.map((r) => r.blob.arrayBuffer()));
    contents.forEach((buf, i) => {
      // Images are already compressed, so the ZIP just stores them.
      entries[names[i]] = [new Uint8Array(buf), { level: 0 }];
    });
    return new Blob([zipSync(entries) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  }
}

export const app = new AppState();
