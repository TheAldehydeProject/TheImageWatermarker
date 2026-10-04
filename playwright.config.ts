import { defineConfig, devices } from '@playwright/test';

const port = 4173;
// Lets a pre-installed Chromium be used instead of Playwright's download.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], launchOptions: { executablePath } },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
