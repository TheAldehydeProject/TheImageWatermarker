import { expect, test } from '@playwright/test';
import { fixturePath, open, watch } from './helpers';

for (const tool of ['compress', 'convert', 'watermark']) {
  test(`${tool} works on a phone-sized screen without sideways scrolling`, async ({ page }) => {
    const problems = watch(page);
    await open(page, `/${tool}/`);
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);

    await page.getByTestId('file-input').setInputFiles(fixturePath('camera.jpg'));
    await expect(page.getByTestId('file-row').locator('img')).toBeVisible();
    await page.getByTestId('process').click();
    await expect(page.getByTestId('file-row')).toHaveAttribute('data-status', 'done', {
      timeout: 60_000,
    });
    expect(await overflow()).toBeLessThanOrEqual(0);
    expect(problems).toEqual([]);
  });
}

test('the start page works on a phone-sized screen', async ({ page }) => {
  await open(page, '/');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});
