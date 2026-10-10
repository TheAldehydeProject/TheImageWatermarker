import { expect, test } from '@playwright/test';
import { open, watch } from './helpers';

const TOOLS = ['Compress', 'Convert', 'Watermark'];

test('the start page loads cleanly and links to the three separate tools', async ({ page }) => {
  const problems = watch(page);
  await open(page, '/');
  await expect(page).toHaveTitle('The Image Watermarker');
  for (const name of TOOLS) {
    await expect(page.getByTestId(`tool-${name.toLowerCase()}`)).toBeVisible();
  }
  // There is no longer a way to do everything at once.
  await expect(page.getByText('All-in-one')).toHaveCount(0);

  for (const name of TOOLS) {
    await open(page, '/');
    await page.getByTestId(`tool-${name.toLowerCase()}`).click();
    await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}/$`));
    await expect(page).toHaveTitle(`${name} · The Image Watermarker`);
    // Each page marks itself in the links to the others.
    const nav = page.getByRole('navigation', { name: 'Tools' });
    await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    for (const other of TOOLS.filter((t) => t !== name)) {
      await expect(nav.getByRole('link', { name: other })).not.toHaveAttribute('aria-current');
    }
    await expect(page.getByText('All-in-one')).toHaveCount(0);
  }
  // The logo leads back to the start page.
  await page.getByRole('link', { name: 'The Image Watermarker: all tools' }).click();
  await expect(page.getByTestId('tool-compress')).toBeVisible();
  expect(problems).toEqual([]);
});

test('every page uses the plus-sign favicon, and the old molecule icon is gone', async ({
  page,
  request,
}) => {
  for (const path of ['/', '/compress/', '/convert/', '/watermark/']) {
    await page.goto(path);
    const href = await page.locator('link[rel=icon]').getAttribute('href');
    expect(href).toBe(path === '/' ? './favicon-plus.svg' : '../favicon-plus.svg');
    const icon = await request.get(new URL(href!, page.url()).href);
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/svg+xml');
    const svg = await icon.text();
    expect(svg).toContain('M8 2.5v11M2.5 8h11');
    expect(svg).not.toContain('<text');
  }
  // The old file is no longer part of the site.
  const old = await request.get(new URL('/favicon.svg', page.url()).href);
  expect(old.headers()['content-type'] ?? '').not.toContain('image/svg+xml');
});
