import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURES, FIXTURE_DIR, UNSUPPORTED } from './fixtures';
import {
  addAll,
  canvasRegion,
  decodeFile,
  differs,
  download,
  downloadAll,
  fixture,
  imageRegion,
  open,
  processAll,
  recordedLayout,
  recordLayout,
  row,
  samePlace,
  slowWorkers,
  watch,
} from './helpers';

test.beforeEach(async ({ page }) => {
  await open(page, '/watermark/');
});

test('keeps every file as uploaded: same format and size, lossless stays lossless, never bigger', async ({
  page,
}) => {
  const problems = watch(page);
  await addAll(page);
  await processAll(page);
  const sameFormat: Record<string, string> = {
    'rotated-photo.jpg': 'rotated-photo-watermarked.jpg',
    'camera.jpg': 'camera-watermarked.jpg',
    'graphic.png': 'graphic-watermarked.png',
    'lossless.webp': 'lossless-watermarked.webp',
    'lossy.webp': 'lossy-watermarked.webp',
    'scan.tiff': 'scan-watermarked.tiff',
    'photo.avif': 'photo-watermarked.avif',
    'photo.jxl': 'photo-watermarked.jxl',
  };
  const lossy = ['rotated-photo.jpg', 'camera.jpg', 'lossy.webp', 'photo.avif', 'photo.jxl'];
  const outputs = await downloadAll(page);
  expect(outputs).toHaveLength(FIXTURES.length);
  for (const [i, f] of FIXTURES.entries()) {
    const out = outputs[i];
    if (sameFormat[f.file]) expect(out.name).toBe(sameFormat[f.file]);
    const img = await decodeFile(out.bytes, out.name);
    expect([img.width, img.height], f.file).toEqual([f.width, f.height]);
    if (lossy.includes(f.file)) {
      expect(out.bytes.length, f.file).toBeLessThanOrEqual((await fixture(f.file)).length);
    }
  }
  // Formats that can't be written back use the format chosen under More options.
  const named = (file: string) => outputs[FIXTURES.findIndex((f) => f.file === file)];
  expect(named('camera.dng').name).toMatch(/^camera-watermarked( \(\d+\))?\.webp$/);
  expect(named('bitmap.bmp').name).toBe('bitmap-watermarked.webp');
  // Lossless files keep every pixel away from the watermark.
  const png = named('graphic.png');
  const before = await decodeFile(await fixture('graphic.png'), 'graphic.png');
  const after = await decodeFile(png.bytes, png.name);
  expect(imageRegion(after, 0, 0, 0.5, 0.5)).toEqual(imageRegion(before, 0, 0, 0.5, 0.5));
  await expect(row(page, 'lossy.webp')).toContainText(/Done → WebP/);
  expect(problems).toEqual([]);
});

test('live preview: both letter options, layouts, blend modes and motion blur', async ({
  page,
}) => {
  const problems = watch(page);
  await page.getByTestId('file-input').setInputFiles(join(FIXTURE_DIR, 'camera.jpg'));
  await expect(row(page, 'camera.jpg').locator('img')).toBeVisible();

  // The watermark is drawn in the bottom-right corner only.
  const canvas = page.getByTestId('live-preview');
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(640);
  const corner = () => canvasRegion(page, 'live-preview', 0.75, 0.75, 0.25, 0.25);
  const topLeft = () => canvasRegion(page, 'live-preview', 0, 0, 0.5, 0.5);
  const original = await decodeFile(await fixture('camera.jpg'), 'camera.jpg');
  await expect
    .poll(async () => differs(await corner(), imageRegion(original, 0.75, 0.75, 0.25, 0.25)))
    .toBe(true);
  expect(differs(await topLeft(), imageRegion(original, 0, 0, 0.5, 0.5))).toBe(false);
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
  const before = original;
  const after = await decodeFile(out.bytes, out.name);
  // Same format and size as the original, and no bigger a file.
  expect([after.width, after.height]).toEqual([640, 480]);
  expect(out.bytes.length).toBeLessThanOrEqual((await fixture('camera.jpg')).length);
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

test('Generate preview shows the exact result without exporting', async ({ page }) => {
  const problems = watch(page);
  const downloads: string[] = [];
  page.on('download', (d) => downloads.push(d.suggestedFilename()));
  await page.getByTestId('file-input').setInputFiles(join(FIXTURE_DIR, 'camera.jpg'));
  await expect(row(page, 'camera.jpg').locator('img')).toBeVisible();

  await page.getByTestId('generate-preview').click();
  const info = page.getByTestId('draft-info');
  await expect(info).toContainText('JPG');
  await expect(info).toContainText('640×480');
  await expect(page.getByTestId('draft-stale')).toHaveCount(0);

  // The before/after viewer shows the watermark in the bottom-right corner.
  await expect
    .poll(() => page.getByTestId('after').evaluate((c: HTMLCanvasElement) => c.width))
    .toBe(640);
  const corner = (id: string) => canvasRegion(page, id, 0.75, 0.75, 0.25, 0.25);
  await expect.poll(async () => differs(await corner('after'), await corner('before'))).toBe(true);

  // Nothing was exported or marked as processed.
  await expect(row(page, 'camera.jpg')).toHaveAttribute('data-status', 'idle');
  await expect(page.getByTestId('zip')).toBeDisabled();
  expect(downloads).toEqual([]);

  // Changing a setting marks the preview as out of date; generating again updates it.
  await page.getByTestId('blend-mode').selectOption('multiply');
  await expect(page.getByTestId('draft-stale')).toBeVisible();
  await page.getByTestId('generate-preview').click();
  await expect(page.getByTestId('draft-stale')).toHaveCount(0);

  // It can be downloaded if wanted, and it is byte-for-byte what Watermark saves.
  const link = page.getByTestId('draft-download');
  await expect(link).toHaveAttribute('download', 'camera-watermarked.jpg');
  const [dl] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const previewBytes = new Uint8Array(await readFile((await dl.path())!));
  await expect(row(page, 'camera.jpg')).toHaveAttribute('data-status', 'idle');
  await page.getByTestId('process').click();
  await expect(row(page, 'camera.jpg')).toHaveAttribute('data-status', 'done');
  const saved = await download(page, 'camera.jpg');
  expect(saved.name).toBe('camera-watermarked.jpg');
  expect(previewBytes).toEqual(saved.bytes);
  expect(problems).toEqual([]);
});

test('the preview stays put while settings change and while it loads', async ({ page }) => {
  const problems = watch(page);
  // Wide enough for the preview toolbar to fit on one line, where anything
  // appearing in it would push the picture down.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.addInitScript(slowWorkers, 400);
  await page.reload();
  await page.getByTestId('file-input').setInputFiles(join(FIXTURE_DIR, 'camera.jpg'));
  const canvas = page.getByTestId('live-preview');
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(640);
  await page.waitForTimeout(500);
  await recordLayout(page);
  const [start] = await recordedLayout(page);
  expect(start.pixels).toEqual({ w: 640, h: 480 });
  const fit = start.picture;

  // Dragging sliders in Fit view.
  for (const id of ['wm-size', 'wm-opacity', 'wm-margin']) {
    const box = (await page.locator(`#${id}`).boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.06), y);
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  let frames = await recordedLayout(page);
  expect(frames.length).toBeGreaterThan(5);
  for (const f of frames) {
    expect(f.stageTop).toBeCloseTo(start.stageTop, 0);
    expect(f.stageHeight).toBeCloseTo(start.stageHeight, 0);
    expect(samePlace(f.picture, fit)).toBe(true);
  }

  // Close-up takes a moment to load. Until it is ready, the picture keeps its
  // size and shape, and the loading notice doesn't push anything around.
  await recordLayout(page);
  await page.getByRole('button', { name: 'Close-up' }).click();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBeLessThan(640);
  frames = await recordedLayout(page);
  const waiting = frames.filter((f) => f.pixels?.w === 640);
  expect(waiting.length).toBeGreaterThan(3);
  for (const f of waiting) expect(samePlace(f.picture, fit)).toBe(true);
  for (const f of frames) expect(f.stageTop).toBeCloseTo(start.stageTop, 0);
  await page.getByRole('button', { name: 'Fit' }).click();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(640);

  // Generating a preview (first time, and again after a change) keeps the
  // picture where it is and the same size.
  for (const blend of ['normal', 'multiply']) {
    await page.getByTestId('blend-mode').selectOption(blend);
    await page.getByRole('tab', { name: 'Watermark preview' }).click();
    await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width)).toBe(640);
    await recordLayout(page);
    await page.getByTestId('generate-preview').click();
    await expect(page.getByTestId('draft-info')).toBeVisible();
    await expect(page.getByTestId('draft-stale')).toHaveCount(0);
    await expect
      .poll(() => page.getByTestId('after').evaluate((c: HTMLCanvasElement) => c.width))
      .toBe(640);
    await page.waitForTimeout(100);
    frames = await recordedLayout(page);
    expect(frames.length).toBeGreaterThan(10);
    for (const f of frames) {
      expect(f.stageTop).toBeCloseTo(start.stageTop, 0);
      expect(f.stageHeight).toBeCloseTo(start.stageHeight, 0);
      expect(samePlace(f.picture, fit)).toBe(true);
    }
  }
  expect(problems).toEqual([]);
});

test('shows overall progress and the step each file is on while processing', async ({ page }) => {
  const problems = watch(page);
  await page.addInitScript(slowWorkers, 150);
  await page.reload();
  await addAll(page);
  // Record the progress bar and the steps shown in the file list on every frame.
  await page.evaluate(() => {
    const w = window as unknown as {
      progressLog: { value: number; text: string; steps: string[] }[];
    };
    w.progressLog = [];
    const frame = () => {
      const bar = document.querySelector('[data-testid=batch-progress] [role=progressbar]');
      if (bar) {
        w.progressLog.push({
          value: Number(bar.getAttribute('aria-valuenow')),
          text: document.querySelector('.batch-text')?.textContent?.trim() ?? '',
          steps: [...document.querySelectorAll('[data-testid=file-step]')].map(
            (e) => e.textContent?.trim() ?? '',
          ),
        });
      }
      requestAnimationFrame(frame);
    };
    frame();
  });
  await processAll(page);
  await expect(page.getByTestId('batch-progress')).toHaveCount(0);

  const log = await page.evaluate(
    () =>
      (window as unknown as { progressLog: { value: number; text: string; steps: string[] }[] })
        .progressLog,
  );
  expect(log.length).toBeGreaterThan(10);
  const total = FIXTURES.length;
  for (const entry of log) {
    expect(entry.text).toMatch(new RegExp(`^\\d+ of ${total} done · \\d+%$`));
  }
  // The bar only moves forward, and shows the work in between.
  const values = log.map((e) => e.value);
  for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
  expect(values.some((v) => v > 0 && v < 100)).toBe(true);
  // Each file shows the step it is on.
  const steps = new Set(log.flatMap((e) => e.steps));
  for (const step of ['Waiting…', 'Reading…', 'Adding the watermark…', 'Compressing…']) {
    expect(steps).toContain(step);
  }
  // Finished files say so.
  for (const f of FIXTURES) await expect(row(page, f.file)).toContainText('Done');
  expect(problems).toEqual([]);
});

test('settings can be exported to a file and uploaded again', async ({ page }) => {
  const problems = watch(page);
  // Make some changes worth saving.
  await page.getByTestId('blend-mode').selectOption('overlay');
  await page.getByText('Custom letters').click();
  await page.getByTestId('letter-o').fill('Q');
  await page.getByText('More options', { exact: true }).click();
  await page.getByTestId('fallback-format').selectOption('png');

  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-settings').click(),
  ]);
  expect(dl.suggestedFilename()).toBe('image-watermark-settings.json');
  const settingsPath = (await dl.path())!;
  const saved = JSON.parse(await readFile(settingsPath, 'utf8'));
  expect(saved).toMatchObject({ app: 'the-image-watermarker', version: 2, tool: 'watermark' });
  expect(saved.settings.watermark).toMatchObject({ blendMode: 'overlay', variant: 'custom' });
  expect(saved.settings.watermark.customLabels.o).toBe('Q');
  expect(saved.settings.fallbackFormat).toBe('png');
  // Only this page's settings are in it.
  expect(Object.keys(saved.settings).sort()).toEqual(['fallbackFormat', 'watermark']);

  // Change things again, then upload the file.
  await page.getByTestId('blend-mode').selectOption('screen');
  await page.getByTestId('fallback-format').selectOption('jxl');
  // Playwright stores downloads under random names, so upload it under its real one.
  await page.getByTestId('settings-input').setInputFiles({
    name: 'image-watermark-settings.json',
    mimeType: 'application/json',
    buffer: await readFile(settingsPath),
  });
  await expect(page.getByTestId('settings-message')).toContainText(
    'Settings loaded from image-watermark-settings.json',
  );
  await expect(page.getByTestId('blend-mode')).toHaveValue('overlay');
  await expect(page.getByTestId('letter-o')).toHaveValue('Q');
  await expect(page.getByTestId('fallback-format')).toHaveValue('png');

  // A file that isn't a settings file, or is for another page, is rejected and changes nothing.
  await page.getByTestId('settings-input').setInputFiles(join(FIXTURE_DIR, UNSUPPORTED));
  await expect(page.getByTestId('settings-message')).toContainText(
    "This isn't a settings file from The Image Watermarker.",
  );
  await page.getByTestId('settings-input').setInputFiles({
    name: 'image-compress-settings.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ app: 'the-image-watermarker', version: 2, tool: 'compress', settings: {} }),
    ),
  });
  await expect(page.getByTestId('settings-message')).toContainText('for the Compress page');
  await expect(page.getByTestId('blend-mode')).toHaveValue('overlay');
  expect(problems).toEqual([]);
});

test('settings are remembered after a reload, separately from the other pages', async ({
  page,
}) => {
  await page.getByTestId('blend-mode').selectOption('soft-light');
  await page.reload();
  await expect(page.getByTestId('blend-mode')).toHaveValue('soft-light');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toEqual(['the-image-watermarker:watermark:v2']);
});
