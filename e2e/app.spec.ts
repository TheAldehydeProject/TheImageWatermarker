import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { decodeImage } from '../src/lib/codecs';
import { detectFormat } from '../src/lib/formats';
import { initCodecs, maxChannelDiff } from '../tests/helpers';
import { FIXTURES, FIXTURE_DIR, UNSUPPORTED } from './fixtures';

const ALL_FILES = [...FIXTURES.map((f) => f.file), UNSUPPORTED].map((f) => join(FIXTURE_DIR, f));

/** Collects console errors, uncaught exceptions and failed requests. */
function watch(page: Page): string[] {
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

async function addAll(page: Page) {
  await page.getByTestId('file-input').setInputFiles(ALL_FILES);
  const rows = page.getByTestId('file-row');
  await expect(rows).toHaveCount(ALL_FILES.length);
  // Every supported file gets a thumbnail.
  await expect(page.locator('[data-testid=file-row] img')).toHaveCount(FIXTURES.length, {
    timeout: 60_000,
  });
}

async function processAll(page: Page) {
  await page.getByTestId('process').click();
  await expect(page.locator('[data-testid=file-row][data-status=done]')).toHaveCount(
    FIXTURES.length,
    {
      timeout: 90_000,
    },
  );
  await expect(page.locator('[data-testid=file-row][data-status=error]')).toHaveCount(0);
}

function row(page: Page, name: string) {
  return page.getByTestId('file-row').filter({ hasText: name });
}

async function download(page: Page, name: string): Promise<{ name: string; bytes: Uint8Array }> {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    row(page, name).getByTestId('download').click(),
  ]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: new Uint8Array(await readFile(path!)) };
}

async function decodeFile(bytes: Uint8Array, name: string) {
  await initCodecs();
  const format = detectFormat(bytes, name);
  if (!format) throw new Error(`unknown format for ${name}`);
  return (await decodeImage(bytes, format)).image;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('loads cleanly with the four tools', async ({ page }) => {
  const problems = watch(page);
  await page.reload();
  await expect(page).toHaveTitle('The Image Watermarker');
  for (const name of ['Compress', 'Convert', 'Watermark', 'All-in-one']) {
    await expect(page.getByRole('tab', { name })).toBeVisible();
  }
  await expect(page.getByRole('tab', { name: 'Compress' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(problems).toEqual([]);
});

test('reads every supported format, with EXIF rotation, and rejects other files', async ({
  page,
}) => {
  const problems = watch(page);
  await addAll(page);
  for (const f of FIXTURES) {
    await expect(row(page, f.file)).toContainText(`${f.width}×${f.height}`);
  }
  await expect(row(page, UNSUPPORTED)).toContainText('not supported');
  expect(problems).toEqual([]);
});

test('Compress (lossless) handles every format and keeps JPG pixels identical', async ({
  page,
}) => {
  const problems = watch(page);
  await addAll(page);
  await processAll(page);
  await expect(row(page, 'camera.jpg').getByTestId('size-change')).toContainText('-');

  const out = await download(page, 'camera.jpg');
  expect(out.name).toBe('camera-compressed.jpg');
  const original = new Uint8Array(await readFile(join(FIXTURE_DIR, 'camera.jpg')));
  expect(out.bytes.length).toBeLessThan(original.length);
  const [a, b] = await Promise.all([
    decodeFile(original, 'camera.jpg'),
    decodeFile(out.bytes, out.name),
  ]);
  expect(maxChannelDiff(a, b)).toBe(0);

  // RAW can't be written back, so it falls back to WebP.
  const raw = await download(page, 'camera.dng');
  expect(raw.name).toBe('camera-compressed.webp');
  expect((await decodeFile(raw.bytes, raw.name)).width).toBe(240);
  expect(problems).toEqual([]);
});

test('Convert defaults to lossless WebP with identical pixels', async ({ page }) => {
  const problems = watch(page);
  await page.getByRole('tab', { name: 'Convert' }).click();
  await addAll(page);
  await processAll(page);
  const out = await download(page, 'graphic.png');
  expect(out.name).toBe('graphic.webp');
  const original = await decodeFile(
    new Uint8Array(await readFile(join(FIXTURE_DIR, 'graphic.png'))),
    'graphic.png',
  );
  expect(maxChannelDiff(original, await decodeFile(out.bytes, out.name))).toBe(0);

  const tiff = await download(page, 'scan.tiff');
  expect(tiff.name).toBe('scan.webp');
  expect(problems).toEqual([]);
});

test('Convert to each output format', async ({ page }) => {
  const problems = watch(page);
  await page.getByRole('tab', { name: 'Convert' }).click();
  await page.getByTestId('file-input').setInputFiles(join(FIXTURE_DIR, 'rotated-photo.jpg'));
  for (const [label, ext] of [
    ['JPG', 'jpg'],
    ['PNG', 'png'],
    ['AVIF', 'avif'],
    ['JPEG XL', 'jxl'],
    ['TIFF', 'tiff'],
  ] as const) {
    await page
      .locator('fieldset.formats label')
      .filter({ hasText: new RegExp(`^\\s*${label}\\b`) })
      .first()
      .click();
    await page.getByTestId('process').click();
    await expect(row(page, 'rotated-photo.jpg')).toHaveAttribute('data-status', 'done');
    const out = await download(page, 'rotated-photo.jpg');
    // Same type as the original gets "-converted" so it never reuses the original name.
    expect(out.name).toBe(ext === 'jpg' ? 'rotated-photo-converted.jpg' : `rotated-photo.${ext}`);
    const img = await decodeFile(out.bytes, out.name);
    expect([img.width, img.height]).toEqual([300, 400]);
  }
  expect(problems).toEqual([]);
});

/** Reads a region of the live preview canvas as RGBA values. */
async function canvasRegion(
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

const differs = (a: number[], b: number[]) => a.some((v, i) => v !== b[i]);

test('Watermark: live preview, both variants, blend modes and motion blur', async ({ page }) => {
  const problems = watch(page);
  await page.getByTestId('file-input').setInputFiles(join(FIXTURE_DIR, 'camera.jpg'));
  await expect(row(page, 'camera.jpg').locator('img')).toBeVisible();

  // Original corner (Compress tab shows the untouched image).
  const canvas = page.getByTestId('live-preview');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(640);
  const corner = () => canvasRegion(page, 'live-preview', 0.75, 0.75, 0.25, 0.25);
  const topLeft = () => canvasRegion(page, 'live-preview', 0, 0, 0.5, 0.5);
  const plainCorner = await corner();
  const plainTopLeft = await topLeft();

  await page.getByRole('tab', { name: 'Watermark' }).click();
  await expect.poll(async () => differs(await corner(), plainCorner)).toBe(true);
  expect(differs(await topLeft(), plainTopLeft)).toBe(false);
  const classic = await corner();

  // Custom letters.
  await page.getByText('Custom letters').click();
  await page.getByTestId('letter-o').fill('Q');
  await expect.poll(async () => differs(await corner(), classic)).toBe(true);
  const custom = await corner();

  // Vertical layout.
  await page.locator('fieldset.layouts label').filter({ hasText: 'Vertical' }).click();
  await expect.poll(async () => differs(await corner(), custom)).toBe(true);
  const vertical = await corner();

  // Blend mode.
  await page.getByTestId('blend-mode').selectOption('overlay');
  await expect.poll(async () => differs(await corner(), vertical)).toBe(true);
  const overlay = await corner();

  // Motion blur.
  await page.getByText('Motion blur', { exact: true }).click();
  await expect.poll(async () => differs(await corner(), overlay)).toBe(true);
  await page.getByText('Blurred', { exact: true }).click();
  await expect(page.getByLabel('Direction', { exact: true })).toBeVisible();

  // Close-up renders at higher resolution.
  await page.getByRole('button', { name: 'Close-up' }).click();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBeLessThan(640);

  // Process with plain settings so the change is easy to measure.
  await page.getByTestId('blend-mode').selectOption('normal');
  await page.getByText('Motion blur', { exact: true }).click();
  await page.getByTestId('process').click();
  await expect(row(page, 'camera.jpg')).toHaveAttribute('data-status', 'done');
  const out = await download(page, 'camera.jpg');
  expect(out.name).toBe('camera-watermarked.jpg');
  const before = await decodeFile(
    new Uint8Array(await readFile(join(FIXTURE_DIR, 'camera.jpg'))),
    'camera.jpg',
  );
  const after = await decodeFile(out.bytes, out.name);
  expect([after.width, after.height]).toEqual([640, 480]);
  // The bottom-right corner changed noticeably; the top-left only by re-saving.
  const regionDiff = (x0: number, y0: number, x1: number, y1: number) => {
    let d = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        d = Math.max(d, Math.abs(before.data[(y * 640 + x) * 4] - after.data[(y * 640 + x) * 4]));
    return d;
  };
  expect(regionDiff(480, 360, 640, 480)).toBeGreaterThan(40);
  expect(regionDiff(0, 0, 200, 200)).toBeLessThan(25);

  // Before/after comparison is shown.
  await expect(page.getByTestId('before')).toBeVisible();
  await expect(page.getByTestId('after')).toBeVisible();
  expect(problems).toEqual([]);
});

test('Watermark keeps lossless files lossless and handles every format', async ({ page }) => {
  const problems = watch(page);
  await page.getByRole('tab', { name: 'Watermark' }).click();
  await addAll(page);
  await processAll(page);
  const png = await download(page, 'graphic.png');
  expect(png.name).toBe('graphic-watermarked.png');
  const heicLike = await download(page, 'camera.dng');
  expect(heicLike.name).toBe('camera-watermarked.webp');
  expect(problems).toEqual([]);
});

test('All-in-one produces a ZIP with every result', async ({ page }) => {
  const problems = watch(page);
  await page.getByRole('tab', { name: 'All-in-one' }).click();
  await addAll(page);
  await processAll(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('zip').click()]);
  expect(dl.suggestedFilename()).toBe('images.zip');
  const zip = unzipSync(new Uint8Array(await readFile((await dl.path())!)));
  const names = Object.keys(zip).sort();
  expect(names).toHaveLength(FIXTURES.length);
  expect(new Set(names).size).toBe(names.length);
  // camera.jpg and camera.dng both become camera-edited.webp, so one is numbered.
  expect(names.every((n) => /-edited( \(\d+\))?\.webp$/.test(n))).toBe(true);
  expect(names).toContain('camera-edited (2).webp');
  expect(problems).toEqual([]);
});

test('settings are remembered after a reload', async ({ page }) => {
  await page.getByRole('tab', { name: 'Watermark' }).click();
  await page.getByTestId('blend-mode').selectOption('soft-light');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Watermark' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('blend-mode')).toHaveValue('soft-light');
});

test('removing files and clearing the list', async ({ page }) => {
  await addAll(page);
  await page.getByRole('button', { name: `Remove ${UNSUPPORTED}` }).click();
  await expect(page.getByTestId('file-row')).toHaveCount(FIXTURES.length);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByTestId('file-row')).toHaveCount(0);
});
