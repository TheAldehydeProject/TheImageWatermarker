import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { decodeImage } from '../src/engine/codecs';
import { detectFormat } from '../src/engine/formats';
import { initCodecs } from '../tests/helpers';
import { FIXTURES, FIXTURE_DIR, UNSUPPORTED } from './fixtures';

/** Opens a page with a clean slate: no saved settings from earlier tests. */
export async function open(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

/** Where a fixture file is, and its contents. */
export const fixturePath = (name: string) => join(FIXTURE_DIR, name);
export const fixture = async (name: string) => new Uint8Array(await readFile(fixturePath(name)));

export const ALL_FILES = [...FIXTURES.map((f) => f.file), UNSUPPORTED].map((f) =>
  join(FIXTURE_DIR, f),
);

/** Collects console errors, uncaught exceptions and failed requests. */
export function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('requestfailed', (r) =>
    problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`),
  );
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  return problems;
}

export async function addAll(page: Page) {
  await page.getByTestId('file-input').setInputFiles(ALL_FILES);
  const rows = page.getByTestId('file-row');
  await expect(rows).toHaveCount(ALL_FILES.length);
  // Every supported file gets a thumbnail.
  await expect(page.locator('[data-testid=file-row] img')).toHaveCount(FIXTURES.length, {
    timeout: 60_000,
  });
}

export async function processAll(page: Page, count = FIXTURES.length) {
  await page.getByTestId('process').click();
  await expect(page.locator('[data-testid=file-row][data-status=done]')).toHaveCount(count, {
    timeout: 90_000,
  });
  await expect(page.locator('[data-testid=file-row][data-status=error]')).toHaveCount(0);
}

export function row(page: Page, name: string) {
  return page.getByTestId('file-row').filter({ hasText: name });
}

export async function download(
  page: Page,
  name: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    row(page, name).getByTestId('download').click(),
  ]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(await readFile(path!)) };
}

/**
 * Every result, through "Download all (ZIP)", in the order of the file list.
 * (Browsers block more than about ten separate downloads in quick succession.)
 */
export async function downloadAll(page: Page): Promise<{ name: string; bytes: Uint8Array }[]> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('zip').click()]);
  const zip = unzipSync(new Uint8Array(await readFile((await dl.path())!)));
  return Object.entries(zip).map(([name, bytes]) => ({ name, bytes }));
}

export async function decodeFile(bytes: Uint8Array, name: string) {
  await initCodecs();
  const format = detectFormat(bytes, name);
  if (!format) throw new Error(`unknown format for ${name}`);
  return (await decodeImage(bytes, format)).image;
}

/** Reads a region of the live preview canvas as RGBA values. */
export async function canvasRegion(
  page: Page,
  testId: string,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
) {
  return page.getByTestId(testId).evaluate(
    (c: HTMLCanvasElement, r) => {
      const ctx = c.getContext('2d')!;
      const x = Math.floor(c.width * r.fx);
      const y = Math.floor(c.height * r.fy);
      return Array.from(
        ctx.getImageData(x, y, Math.ceil(c.width * r.fw), Math.ceil(c.height * r.fh)).data,
      );
    },
    { fx, fy, fw, fh },
  );
}

export const differs = (a: number[], b: number[]) => a.some((v, i) => v !== b[i]);

/** Makes every reply from the processing workers arrive late, as on a slow computer. */
export function slowWorkers(delay: number) {
  const Native = window.Worker;
  window.Worker = class extends Native {
    get onmessage() {
      return super.onmessage;
    }
    set onmessage(handler: ((e: MessageEvent) => void) | null) {
      super.onmessage = handler && ((e) => setTimeout(() => handler.call(this, e), delay));
    }
  };
}

export interface LayoutFrame {
  stageTop: number;
  stageHeight: number;
  /** The picture: the live canvas, or the before/after viewer. */
  picture: { x: number; y: number; w: number; h: number } | null;
  /** Pixel size of what the picture's canvas currently holds. */
  pixels: { w: number; h: number } | null;
}

/** Starts recording where the preview sits on every frame. */
export async function recordLayout(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { layoutLog: LayoutFrame[]; layoutTimer: number };
    cancelAnimationFrame(w.layoutTimer);
    w.layoutLog = [];
    const frame = () => {
      const stage = document.querySelector('[data-testid=preview-stage]')!.getBoundingClientRect();
      const c = document.querySelector<HTMLCanvasElement>(
        '[data-testid=live-preview], [data-testid=after]',
      );
      const r = c?.getBoundingClientRect();
      w.layoutLog.push({
        stageTop: stage.top,
        stageHeight: stage.height,
        picture: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
        pixels: c ? { w: c.width, h: c.height } : null,
      });
      w.layoutTimer = requestAnimationFrame(frame);
    };
    frame();
  });
}

export async function recordedLayout(page: Page): Promise<LayoutFrame[]> {
  return page.evaluate(() => (window as unknown as { layoutLog: LayoutFrame[] }).layoutLog);
}

export const near = (a: number, b: number) => Math.abs(a - b) < 0.6;
export const samePlace = (
  a: LayoutFrame['picture'] | undefined,
  b: LayoutFrame['picture'] | undefined,
) => !!a && !!b && near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);

/** Reads a size such as "19.6 KB" back into bytes (approximately). */
export function parseSize(text: string): number {
  const m = /([\d.]+) (B|KB|MB)/.exec(text);
  if (!m) throw new Error(`no size in "${text}"`);
  return Number(m[1]) * { B: 1, KB: 1024, MB: 1024 * 1024 }[m[2] as 'B' | 'KB' | 'MB'];
}

/** The same region as canvasRegion, read from a decoded image instead of the page. */
export function imageRegion(
  img: { width: number; height: number; data: Uint8ClampedArray },
  fx: number,
  fy: number,
  fw: number,
  fh: number,
): number[] {
  const x0 = Math.floor(img.width * fx);
  const y0 = Math.floor(img.height * fy);
  const w = Math.ceil(img.width * fw);
  const h = Math.ceil(img.height * fh);
  const out: number[] = [];
  for (let y = y0; y < y0 + h; y++) {
    out.push(...img.data.subarray((y * img.width + x0) * 4, (y * img.width + x0 + w) * 4));
  }
  return out;
}
