// Category A: UI contract tests — the real Next.js pages with API responses fixed by route
// interception (restricted to /api/v1/auth/*). They pin down the client-side behaviour that a live
// stack cannot provoke on demand: validation before any request, and the error states for
// 401 / SSO_REQUIRED / 503 envelopes of apps/api/src/common/filters/http-exception.filter.ts.
// The full journey against the real API is tests/e2e/preflight-pipeline.live.spec.ts.
import { test, expect, type Page } from '@playwright/test';

type Envelope = { statusCode: number; message: string; code?: string; path: string; timestamp: string; correlationId: string };
const envelope = (statusCode: number, message: string, code?: string): Envelope => ({
  statusCode,
  message,
  ...(code ? { code } : {}),
  path: '/api/v1/auth/login',
  timestamp: new Date().toISOString(),
  correlationId: 'contract-test',
});

/** Records every API request the page makes, so tests can assert that none was sent. */
function trackApiRequests(page: Page) {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/')) seen.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  return seen;
}

async function mockLogin(page: Page, status: number, body: Envelope) {
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

async function submitLogin(page: Page, email: string) {
  await page.goto('/login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill('Some-Password-2026!');
  await page.locator('#login-password').press('Enter'); // keyboard submit (Axiom 1 #6)
}

test.describe('Auth UI contract (mocked /api/v1/auth responses)', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'erp_consent', value: 'necessary', url: baseURL! }]);
  });

  test('signup validates with Zod before any request is sent', async ({ page }) => {
    const requests = trackApiRequests(page);
    await page.goto('/signup');
    await expect(page.locator('h1')).toContainText('Create your workspace');
    await page.locator('button[type=submit]').click();
    await expect(page.getByText('Organization name must be at least 2 characters').first()).toBeVisible();
    await expect(page.getByText('Email is required').first()).toBeVisible();
    await page.getByLabel(/Work Email/).fill('not-an-email');
    await page.locator('button[type=submit]').click();
    await expect(page.getByText('Enter a valid email address').first()).toBeVisible();
    expect(requests.filter((r) => r.includes('/auth/register'))).toEqual([]);
    await expect(page).toHaveURL(/\/signup/);
  });

  test('login shows the error state for 401 and stays on the form', async ({ page }) => {
    await mockLogin(page, 401, envelope(401, 'Invalid email or password', 'INVALID_CREDENTIALS'));
    await submitLogin(page, 'someone@example.com');
    const alert = page.getByText('Sign-in failed').first();
    await expect(alert).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('#login-email')).toHaveValue('someone@example.com');
  });

  test('login offers single sign-on when the organisation enforces it (SSO_REQUIRED)', async ({ page }) => {
    await mockLogin(page, 403, envelope(403, 'Single sign-on is required', 'SSO_REQUIRED'));
    await submitLogin(page, 'member@sso-enforced.example');
    await expect(page.getByText('Your organization requires single sign-on.', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('Continue with single sign-on').first()).toBeVisible();
  });

  test('login surfaces a server-side outage (503) instead of failing silently', async ({ page }) => {
    await mockLogin(page, 503, envelope(503, 'Service temporarily unavailable'));
    await submitLogin(page, 'someone@example.com');
    await expect(page.getByText('Sign-in failed').first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
