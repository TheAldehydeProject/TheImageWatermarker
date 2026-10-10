import { expect, test } from '@playwright/test';
import { FIXTURES, UNSUPPORTED } from './fixtures';
import {
  addAll,
  decodeFile,
  download,
  downloadAll,
  fixture,
  fixturePath,
  open,
  parseSize,
  processAll,
  row,
  watch,
} from './helpers';
import { maxChannelDiff } from '../tests/helpers';

test.beforeEach(async ({ page }) => {
  await open(page, '/compress/');
});

test('lossless: handles every format and keeps JPG pixels identical', async ({ page }) => {
  const problems = watch(page);
  await addAll(page);
  await processAll(page);
  await expect(row(page, 'camera.jpg').getByTestId('size-change')).toContainText('-');

  const out = await download(page, 'camera.jpg');
  expect(out.name).toBe('camera-compressed.jpg');
  const original = await fixture('camera.jpg');
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

test('saves WebP files no bigger than the target, as small as the size you choose', async ({
  page,
}) => {
  const problems = watch(page);
  await page
    .getByTestId('file-input')
    .setInputFiles([fixturePath('camera.jpg'), fixturePath('graphic.png')]);
  await expect(page.locator('[data-testid=file-row] img')).toHaveCount(2);
  await page.getByRole('radio', { name: 'WebP' }).check({ force: true });
  // WebP aims for 50 KB unless told otherwise.
  await expect(page.getByTestId('target-size')).toHaveValue('50');
  await page.getByTestId('target-size').fill('20');
  await expect(page.getByRole('radio', { name: 'Smaller size, clean look' })).toBeChecked();
  await processAll(page, 2);
  for (const name of ['camera.jpg', 'graphic.png']) {
    const out = await download(page, name);
    expect(out.name).toBe(name.replace(/\.\w+$/, '-compressed.webp'));
    expect(out.bytes.length, name).toBeLessThanOrEqual(20 * 1024);
    const img = await decodeFile(out.bytes, out.name);
    expect(img.width / img.height).toBeCloseTo(4 / 3, 1);
  }
  expect(problems).toEqual([]);
});

test('can keep more pixels at a lower quality instead of shrinking the image', async ({ page }) => {
  const problems = watch(page);
  await page.getByTestId('file-input').setInputFiles(fixturePath('camera.jpg'));
  await expect(row(page, 'camera.jpg').locator('img')).toBeVisible();
  await page.getByRole('radio', { name: 'WebP' }).check({ force: true });
  await page.getByTestId('target-size').fill('2');

  const width = async () => {
    await page.getByTestId('process').click();
    await expect(row(page, 'camera.jpg')).toHaveAttribute('data-status', 'done');
    const out = await download(page, 'camera.jpg');
    expect(out.bytes.length).toBeLessThanOrEqual(2 * 1024);
    return (await decodeFile(out.bytes, out.name)).width;
  };
  const clean = await width();
  await page.getByRole('radio', { name: 'Lower quality first' }).check({ force: true });
  const more = await width();
  expect(clean).toBeLessThan(640);
  expect(more).toBeGreaterThan(clean);
  // The note says which quality it used: lower than the clean level of 50.
  const note = (await page.locator('.preview .notes').textContent())!;
  expect(Number(/at quality (\d+)/.exec(note)![1])).toBeLessThan(50);
  expect(problems).toEqual([]);
});

test('never hands back a bigger file, even as WebP', async ({ page }) => {
  const problems = watch(page);
  await addAll(page);
  await page.getByRole('radio', { name: 'WebP' }).check({ force: true });
  await processAll(page);
  const outputs = await downloadAll(page);
  expect(outputs).toHaveLength(FIXTURES.length);
  for (const [i, f] of FIXTURES.entries()) {
    expect(outputs[i].name.endsWith('.webp'), f.file).toBe(true);
    expect(outputs[i].bytes.length, f.file).toBeLessThanOrEqual((await fixture(f.file)).length);
  }
  expect(problems).toEqual([]);
});

test('keeps the format at a target size, after checking the exact size with Estimate', async ({
  page,
}) => {
  const problems = watch(page);
  await page.getByTestId('file-input').setInputFiles(fixturePath('camera.jpg'));
  await expect(row(page, 'camera.jpg').locator('img')).toBeVisible();
  await page.getByRole('radio', { name: 'Target size' }).check({ force: true });
  await page.getByTestId('target-size').fill('20');

  // The estimate is the exact file, made without saving anything.
  await page.getByTestId('estimate').click();
  const estimate = page.getByTestId('estimate-result');
  await expect(estimate).toContainText('camera.jpg');
  await expect(estimate).toContainText('as JPG, 640×480');
  const text = (await estimate.textContent())!;
  const estimated = parseSize(text.split('→')[1]);
  expect(estimated).toBeLessThanOrEqual(20 * 1024);
  await expect(page.locator('.estimate .notes')).toContainText(/Fits under 20.0 KB at quality \d+/);
  await expect(row(page, 'camera.jpg')).toHaveAttribute('data-status', 'idle');

  // Changing the target makes it out of date; changing it back makes it current again.
  await page.getByTestId('target-size').fill('15');
  await expect(page.getByTestId('estimate-stale')).toBeVisible();
  await page.getByTestId('target-size').fill('20');
  await expect(page.getByTestId('estimate-stale')).toHaveCount(0);

  // Processing saves exactly that file.
  await page.getByTestId('process').click();
  await expect(row(page, 'camera.jpg')).toHaveAttribute('data-status', 'done');
  const out = await download(page, 'camera.jpg');
  expect(out.name).toBe('camera-compressed.jpg');
  expect(out.bytes.length).toBeLessThanOrEqual(20 * 1024);
  expect(Math.abs(out.bytes.length - estimated)).toBeLessThan(60);
  const img = await decodeFile(out.bytes, out.name);
  expect([img.width, img.height]).toEqual([640, 480]);

  // A tiny target is reached by also making the image smaller.
  await page.getByTestId('target-size').fill('3');
  await page.getByTestId('process').click();
  await expect(row(page, 'camera.jpg')).toContainText(/Done → JPG · [\d.]+ KB/);
  const small = await download(page, 'camera.jpg');
  expect(small.bytes.length).toBeLessThanOrEqual(3 * 1024);
  const shrunk = await decodeFile(small.bytes, small.name);
  expect(shrunk.width).toBeLessThan(640);
  await expect(page.getByTestId('result-info')).toBeVisible();
  await expect(page.locator('.preview .notes')).toContainText('resized to');
  expect(problems).toEqual([]);
});

test('has no watermark preview: it only compresses', async ({ page }) => {
  await page.getByTestId('file-input').setInputFiles(fixturePath('camera.jpg'));
  await expect(row(page, 'camera.jpg').locator('img')).toBeVisible();
  await expect(page.getByTestId('generate-preview')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Original' })).toBeVisible();
  await expect(page.getByTestId('blend-mode')).toHaveCount(0);
});

test('settings are remembered after a reload, separately from the other pages', async ({
  page,
}) => {
  await page.getByRole('radio', { name: 'WebP' }).check({ force: true });
  await page.getByTestId('target-size').fill('75');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'WebP' })).toBeChecked();
  await expect(page.getByTestId('target-size')).toHaveValue('75');
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toEqual(['the-image-watermarker:compress:v2']);
});

test('removing files and clearing the list', async ({ page }) => {
  await addAll(page);
  await page.getByRole('button', { name: `Remove ${UNSUPPORTED}` }).click();
  await expect(page.getByTestId('file-row')).toHaveCount(FIXTURES.length);
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByTestId('file-row')).toHaveCount(0);
});
