import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for ERP Preflight (`pnpm exec playwright test`).
 *
 * - Without PLAYWRIGHT_BASE_URL: starts the web dev server on :3000 and runs the UI contract
 *   suites (typed API mocks via route interception); the live suites are skipped because they
 *   need the whole stack.
 * - With PLAYWRIGHT_BASE_URL (and API_BASE_URL, MAIL_DEV_OUTBOX_TOKEN) pointing at a running stack:
 *   no web server is started and every suite runs, including tests/e2e/*.live.spec.ts.
 *   playwright.live.config.ts runs only the live suites, optionally in several browsers.
 */
const liveBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: liveBaseUrl ? [] : ['**/*.live.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  reporter: [['list']],
  use: {
    baseURL: liveBaseUrl || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  webServer: liveBaseUrl
    ? undefined
    : {
        command: 'pnpm --filter @erppreflight/web dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
        launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
      },
    },
  ],
});
