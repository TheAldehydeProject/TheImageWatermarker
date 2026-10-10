/**
 * The state of one tool page: its own settings, the file list, previews and
 * the actions that run jobs on the tool's own worker. Each page creates one
 * ToolState with its tool definition (src/tools/<tool>/tool.ts).
 * Uses Svelte 5 runes so components update automatically.
 */
import { zipSync } from 'fflate';
import { outputFileName, uniqueNames } from '../engine/filename';
import { detectFormat, type InputFormat, type OutputFormat } from '../engine/formats';
import type { RGBAImage } from '../engine/image';
import { batchFraction, type FileStep } from '../engine/progress';
import type { ProcessedFile } from '../engine/protocol';
import {
  applySettingsInPlace,
  exportSettingsFile,
  importSettingsFile,
  loadStoredSettings,
  saveStoredSettings,
  settingsFileName,
  specKey,
  type SettingsStore,
  type ToolId,
} from '../engine/settings';
import { WorkerPool } from '../engine/workerPool';
import { PreviewCache } from './previewCache';

export const PREVIEW_SIZE = 1400;
const THUMB_SIZE = 112;

/** What a page needs to know about its tool. */
export interface ToolDefinition<S extends object, Spec> {
  id: ToolId;
  store: SettingsStore<S>;
  /** The job these settings describe; passed to the tool's worker as is. */
  spec(settings: S): Spec;
  /** Added to output file names, e.g. "-compressed". */
  suffix: string;
  createWorker(): Worker;
}

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
  blob: Blob;
}

/**
 * The exact file the tool would save for one image, made without saving it:
 * shown by "Estimate size" and "Generate preview". Processing reuses it when
 * the settings haven't changed since.
 */
export interface TrialResult extends FileResult {
  /** specKey() of the job it was made with. */
  key: string;
}

export type ResultKind = 'result' | 'trial';

export interface FileEntry {
  id: number;
  file: File;
  format: InputFormat | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  status: 'idle' | 'processing' | 'done' | 'error';
  /** While processing: the step it has reached, and the try number when fitting a target size. */
  step: FileStep | null;
  attempt: number;
  error: string | null;
  previewError: string | null;
  result: FileResult | null;
  trial: TrialResult | null;
  trialStatus: 'idle' | 'working' | 'error';
  trialError: string | null;
  trialStep: FileStep | null;
  trialAttempt: number;
}

let nextId = 1;

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

export class ToolState<S extends object, Spec> {
  readonly tool: ToolDefinition<S, Spec>;
  settings = $state({} as S);
  files = $state<FileEntry[]>([]);
  selectedId = $state<number | null>(null);
  busy = $state(false);
  progress = $state({ done: 0, total: 0 });
  /** Large previews are kept for a few files only, to limit memory use. */
  private previews = new PreviewCache<Preview>();
  private resultPreviews = new PreviewCache<Preview>();
  private trialPreviews = new PreviewCache<Preview>();
  private pool: WorkerPool;

  selected = $derived(this.files.find((f) => f.id === this.selectedId) ?? null);
  doneCount = $derived(this.files.filter((f) => f.result).length);
  /** specKey() of the job the settings describe now, to tell when a trial is out of date. */
  currentKey = $derived.by(() => specKey(this.tool.spec($state.snapshot(this.settings) as S)));
  /** Share of the current batch that is finished (0–1), including files part-way through. */
  batchProgress = $derived(
    batchFraction(
      this.progress.done,
      this.progress.total,
      this.files.flatMap((f) =>
        f.status === 'processing' && f.step ? [{ step: f.step, attempt: f.attempt }] : [],
      ),
    ),
  );

  constructor(tool: ToolDefinition<S, Spec>) {
    this.tool = tool;
    this.settings = loadStoredSettings(tool.store);
    this.pool = new WorkerPool(
      () => tool.createWorker(),
      Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1)),
    );
    $effect.root(() => {
      $effect(() => {
        saveStoredSettings(tool.store, $state.snapshot(this.settings) as S);
      });
    });
  }

  /** The name a downloaded settings file gets. */
  get settingsFileName(): string {
    return settingsFileName(this.tool.id);
  }

  /** A downloadable file with this page's settings. */
  settingsFile(): Blob {
    const text = exportSettingsFile(this.tool.store, $state.snapshot(this.settings) as S);
    return new Blob([text], { type: 'application/json' });
  }

  /** Applies a settings file. Throws SettingsFileError if it isn't one for this page. */
  async loadSettingsFile(file: Blob): Promise<void> {
    const next = importSettingsFile(this.tool.store, await file.text());
    applySettingsInPlace(this.settings, next);
  }

  /** The job the current settings describe. */
  spec(): Spec {
    return this.tool.spec($state.snapshot(this.settings) as S);
  }

  addFiles(list: Iterable<File>): void {
    const added: FileEntry[] = [];
    for (const file of list) {
      added.push({
        id: nextId++,
        file,
        format: null,
        thumbUrl: null,
        width: null,
        height: null,
        status: 'idle',
        step: null,
        attempt: 0,
        error: null,
        previewError: null,
        result: null,
        trial: null,
        trialStatus: 'idle',
        trialError: null,
        trialStep: null,
        trialAttempt: 0,
      });
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
    return this.previews.get(id, maxSize, () => {
      const e = this.entry(id);
      if (!e) return Promise.reject(new Error('File was removed'));
      return this.decode(e.file, e.file.name, maxSize);
    });
  }

  /** The processed result (or trial), decoded at the same scale as `preview`. */
  resultPreview(id: number, maxSize = PREVIEW_SIZE, kind: ResultKind = 'result'): Promise<Preview> {
    const e = this.entry(id);
    const output = kind === 'trial' ? e?.trial : e?.result;
    if (!output) return Promise.reject(new Error('Not processed yet'));
    const cache = kind === 'trial' ? this.trialPreviews : this.resultPreviews;
    return cache.get(id, maxSize, () => this.decode(output.blob, output.name, maxSize));
  }

  private async decode(blob: Blob, name: string, maxSize: number): Promise<Preview> {
    const res = await this.pool.run(async () => {
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
    for (const cache of [this.previews, this.resultPreviews, this.trialPreviews]) {
      cache.trim(this.selectedId);
    }
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
    if (e.trial) URL.revokeObjectURL(e.trial.url);
    this.previews.forget(id);
    this.resultPreviews.forget(id);
    this.trialPreviews.forget(id);
    if (this.selectedId === id)
      this.selectedId = this.files[Math.min(i, this.files.length - 1)]?.id ?? null;
  }

  clear(): void {
    for (const f of [...this.files]) this.remove(f.id);
  }

  /** `onStep` hears when the job starts reading the file and each step after that. */
  private runJob(file: File, spec: Spec, onStep?: (step: FileStep, attempt: number) => void) {
    return this.pool.run(
      async () => {
        onStep?.('reading', 0);
        const bytes = await file.arrayBuffer();
        return { job: { type: 'process', name: file.name, bytes, spec }, transfer: [bytes] };
      },
      (p) => onStep?.(p.step, p.attempt ?? 0),
    );
  }

  /**
   * Makes the exact file this tool would save for one image, without
   * downloading it or marking the image as processed.
   */
  async tryFile(id: number): Promise<void> {
    const e = this.entry(id);
    if (!e?.format || e.trialStatus === 'working') return;
    const spec = this.spec();
    e.trialStatus = 'working';
    e.trialError = null;
    e.trialStep = 'queued';
    e.trialAttempt = 0;
    try {
      const res = await this.runJob(e.file, spec, (step, attempt) => {
        const cur = this.entry(id);
        if (cur?.trialStatus !== 'working') return;
        cur.trialStep = step;
        cur.trialAttempt = attempt;
      });
      if (res.type !== 'process-done') throw new Error('Unexpected reply');
      const cur = this.entry(id);
      if (!cur) return;
      if (cur.trial) URL.revokeObjectURL(cur.trial.url);
      this.trialPreviews.forget(id);
      cur.trial = { ...this.makeResult(cur, res.file), key: specKey(spec) };
      cur.trialStatus = 'idle';
    } catch (err) {
      const cur = this.entry(id);
      if (cur) {
        cur.trialStatus = 'error';
        cur.trialError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      const cur = this.entry(id);
      if (cur) cur.trialStep = null;
    }
  }

  /** Runs the tool on every file. */
  async processAll(): Promise<void> {
    if (this.busy) return;
    const targets = this.files.filter((f) => f.format);
    if (!targets.length) return;
    const spec = this.spec();
    const key = specKey(spec);
    this.busy = true;
    this.progress = { done: 0, total: targets.length };
    await Promise.all(
      targets.map(async (t) => {
        const e = this.entry(t.id);
        if (!e) return;
        e.status = 'processing';
        e.step = 'queued';
        e.attempt = 0;
        e.error = null;
        try {
          // A trial made with the same settings is already the exact file.
          if (e.trial?.key === key) {
            this.setResult(t.id, { ...e.trial, url: URL.createObjectURL(e.trial.blob) });
            return;
          }
          const res = await this.runJob(e.file, spec, (step, attempt) => {
            const cur = this.entry(t.id);
            if (cur?.status !== 'processing') return;
            cur.step = step;
            cur.attempt = attempt;
          });
          if (res.type !== 'process-done') throw new Error('Unexpected reply');
          const cur = this.entry(t.id);
          if (cur) this.setResult(t.id, this.makeResult(cur, res.file));
        } catch (err) {
          const cur = this.entry(t.id);
          if (cur) {
            cur.status = 'error';
            cur.error = err instanceof Error ? err.message : String(err);
          }
        } finally {
          const cur = this.entry(t.id);
          if (cur) cur.step = null;
          this.progress.done++;
        }
      }),
    );
    this.busy = false;
  }

  private makeResult(e: FileEntry, f: ProcessedFile): FileResult {
    const blob = new Blob([f.bytes], { type: f.mime });
    return {
      url: URL.createObjectURL(blob),
      name: outputFileName(e.file.name, f.extension, this.tool.suffix),
      size: blob.size,
      format: f.format,
      width: f.width,
      height: f.height,
      lossless: f.lossless,
      keptOriginal: f.keptOriginal,
      notes: f.notes,
      blob,
    };
  }

  private setResult(id: number, r: FileResult): void {
    const e = this.entry(id);
    if (!e) return;
    if (e.result) URL.revokeObjectURL(e.result.url);
    this.resultPreviews.forget(id);
    e.result = {
      url: r.url,
      name: r.name,
      size: r.size,
      format: r.format,
      width: r.width,
      height: r.height,
      lossless: r.lossless,
      keptOriginal: r.keptOriginal,
      notes: r.notes,
      blob: r.blob,
    };
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
