import { defineConfig, devices, type Project } from '@playwright/test';

/**
 * Playwright configuration for the LIVE suites (tests/e2e/*.live.spec.ts): real web + API +
 * analysis service + Postgres/Redis/MinIO/ClamAV, no route interception, no web server started
 * by Playwright. Used by scripts/ci-live-e2e.sh (multi-browser hook) and locally:
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3000 API_BASE_URL=http://localhost:3001 \
 *   MAIL_DEV_OUTBOX_TOKEN=<api value> pnpm exec playwright test -c playwright.live.config.ts
 *
 * Browsers: PW_BROWSERS (comma list, default "chromium"). CI installs Chromium, Firefox and WebKit
 * (`playwright install --with-deps chromium firefox webkit`) and sets PW_BROWSERS=chromium,firefox,webkit.
 * CHROMIUM_PATH points Chromium at a preinstalled binary (e.g. /opt/pw-browsers/chromium in
 * sandboxes without the Playwright download); Firefox/WebKit always use Playwright's own builds.
 * The API must run with MAIL_TRANSPORT=dev (e-mail verification through the dev mailbox).
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL || process.env.WEB_URL || 'http://localhost:3000';
const wanted = (process.env.PW_BROWSERS || 'chromium').split(',').map((b) => b.trim()).filter(Boolean);

const all: Record<string, Project> = {
  chromium: {
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    },
  },
  firefox: { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  webkit: { name: 'webkit', use: { ...devices['Desktop Safari'] } },
};
const unknown = wanted.filter((b) => !all[b]);
if (unknown.length) throw new Error(`PW_BROWSERS: unknown browser(s) ${unknown.join(', ')} (use chromium, firefox, webkit)`);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.live.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Live suites create their own tenants; one worker keeps the auth rate limiter and the
  // shared analysis worker predictable.
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1400, height: 1000 },
    // Motion discipline (AGENTS.md Axiom 1 #6): audit the reduced-motion rendering.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: wanted.map((b) => all[b]),
});
