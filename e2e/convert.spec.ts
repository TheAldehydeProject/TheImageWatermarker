import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { FIXTURES, UNSUPPORTED } from './fixtures';
import {
  addAll,
  decodeFile,
  download,
  fixture,
  fixturePath,
  open,
  processAll,
  row,
  watch,
} from './helpers';
import { maxChannelDiff } from '../tests/helpers';

test.beforeEach(async ({ page }) => {
  await open(page, '/convert/');
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

test('defaults to lossless WebP with identical pixels', async ({ page }) => {
  const problems = watch(page);
  await addAll(page);
  await processAll(page);
  const out = await download(page, 'graphic.png');
  expect(out.name).toBe('graphic.webp');
  const original = await decodeFile(await fixture('graphic.png'), 'graphic.png');
  expect(maxChannelDiff(original, await decodeFile(out.bytes, out.name))).toBe(0);

  const tiff = await download(page, 'scan.tiff');
  expect(tiff.name).toBe('scan.webp');
  expect(problems).toEqual([]);
});

test('converts to each output format', async ({ page }) => {
  const problems = watch(page);
  await page.getByTestId('file-input').setInputFiles(fixturePath('rotated-photo.jpg'));
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

test('Download all gives a ZIP with every result, each name used once', async ({ page }) => {
  const problems = watch(page);
  await addAll(page);
  await processAll(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('zip').click()]);
  expect(dl.suggestedFilename()).toBe('images.zip');
  const zip = unzipSync(new Uint8Array(await readFile((await dl.path())!)));
  const names = Object.keys(zip).sort();
  expect(names).toHaveLength(FIXTURES.length);
  expect(new Set(names).size).toBe(names.length);
  expect(names.every((n) => n.endsWith('.webp'))).toBe(true);
  // camera.jpg and camera.dng both become camera.webp, so one is numbered.
  expect(names).toContain('camera (2).webp');
  expect(problems).toEqual([]);
});

test('Estimate size shows the exact size before converting', async ({ page }) => {
  const problems = watch(page);
  await page.getByTestId('file-input').setInputFiles(fixturePath('graphic.png'));
  await expect(row(page, 'graphic.png').locator('img')).toBeVisible();
  await page.getByTestId('estimate').click();
  await expect(page.getByTestId('estimate-result')).toContainText('as WebP, 320×240');
  await page.getByTestId('process').click();
  await expect(row(page, 'graphic.png')).toHaveAttribute('data-status', 'done');
  const out = await download(page, 'graphic.png');
  const shown = (await page.getByTestId('estimate-result').textContent())!;
  expect(shown).toContain((await page.getByTestId('size-change').textContent())!.trim());
  expect(out.bytes.length).toBeLessThan((await fixture('graphic.png')).length);
  expect(problems).toEqual([]);
});
