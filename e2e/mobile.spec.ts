import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURE_DIR } from './fixtures';

test('works on a phone-sized screen without sideways scrolling', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  await page.goto('/');
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);

  await page.getByRole('tab', { name: 'Watermark' }).click();
  await page.getByTestId('file-input').setInputFiles(join(FIXTURE_DIR, 'camera.jpg'));
  await expect(page.getByTestId('file-row').locator('img')).toBeVisible();
  await page.getByTestId('process').click();
  await expect(page.getByTestId('file-row')).toHaveAttribute('data-status', 'done', {
    timeout: 60_000,
  });
  expect(await overflow()).toBeLessThanOrEqual(0);
  expect(problems).toEqual([]);
});
