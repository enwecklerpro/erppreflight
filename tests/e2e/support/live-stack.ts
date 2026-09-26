/**
 * Helpers for the live Playwright suites (playwright.live.config.ts). They talk to a real
 * running stack — no route interception, no mocked API:
 *   PLAYWRIGHT_BASE_URL / WEB_URL   web origin (Next.js)
 *   API_BASE_URL / API_URL          API origin (NestJS); default: web port + 1
 *   MAIL_DEV_OUTBOX_TOKEN           dev mailbox token (API with MAIL_TRANSPORT=dev) for e-mail verification
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const WEB_URL = (process.env.PLAYWRIGHT_BASE_URL || process.env.WEB_URL || 'http://localhost:3000').replace(/\/+$/, '');
export const API_URL = (
  process.env.API_BASE_URL ||
  process.env.API_URL ||
  WEB_URL.replace(/:(\d+)$/, (_m, p) => `:${Number(p) + 1}`)
).replace(/\/+$/, '');
export const API = `${API_URL}/api/v1`;

export const FIXTURE_PATH = path.resolve(__dirname, '../../fixtures/known_bad_billing_opd.xml');
export const FIXTURE_SHA256 = crypto.createHash('sha256').update(fs.readFileSync(FIXTURE_PATH)).digest('hex');

export interface LiveAccount {
  email: string;
  password: string;
  token: string;
  organizationId: string;
}

/** Unique suffix per test run and worker so parallel runs never collide. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

/** Waits for the newest dev-mailbox message of a template to `to` and returns its first link. */
export async function mailLink(request: APIRequestContext, to: string, template: string): Promise<string> {
  const headers = { 'X-Dev-Mailbox-Token': process.env.MAIL_DEV_OUTBOX_TOKEN || '' };
  for (let i = 0; i < 30; i++) {
    const res = await request.get(`${API}/dev/mail/messages?to=${encodeURIComponent(to)}`, { headers });
    if (res.status() === 404) throw new Error('dev mailbox unavailable: run the API with MAIL_TRANSPORT=dev and pass MAIL_DEV_OUTBOX_TOKEN');
    if (res.ok()) {
      const { items } = (await res.json()) as { items: Array<{ template: string; links: string[] }> };
      const link = items.filter((m) => m.template === template).flatMap((m) => m.links)[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no ${template} e-mail for ${to}`);
}

/** Registers a tenant through the API and verifies its e-mail address through the dev mailbox. */
export async function registerVerifiedAccount(request: APIRequestContext, label: string): Promise<LiveAccount> {
  const suffix = uniqueSuffix();
  const email = `${label}.${suffix}@e2e.local`;
  const password = `Pw-${suffix}-Live!2026`;
  const reg = await request.post(`${API}/auth/register`, {
    data: { email, password, fullName: `${label} ${suffix}`, organizationName: `${label} Org ${suffix}` },
  });
  expect(reg.status(), await reg.text()).toBe(201);
  const body = await reg.json();
  const link = await mailLink(request, email, 'EMAIL_VERIFICATION');
  const token = new URL(link).searchParams.get('token');
  expect(token, `verification link without token: ${link}`).toBeTruthy();
  const ver = await request.post(`${API}/auth/verify-email`, { data: { token } });
  expect(ver.ok(), await ver.text()).toBeTruthy();
  return { email, password, token: body.accessToken, organizationId: body.user.organizationId };
}

/** Creates a project, uploads the golden OPD fixture and runs OPD_GUARD to completion via the API. */
export async function seedProjectWithFinding(request: APIRequestContext, account: LiveAccount, name: string) {
  const headers = { Authorization: `Bearer ${account.token}` };
  const project = await request.post(`${API}/projects`, {
    headers,
    data: { name, description: 'Playwright live suite', targetRelease: 'S4H_2023' },
  });
  expect(project.status(), await project.text()).toBe(201);
  const projectId: string = (await project.json()).id;
  const upload = await request.post(`${API}/projects/${projectId}/files`, {
    headers,
    multipart: {
      file: { name: 'known_bad_billing_opd.xml', mimeType: 'application/xml', buffer: fs.readFileSync(FIXTURE_PATH) },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const fileId: string = (await upload.json()).fileId;
  const run = await request.post(`${API}/analyses`, {
    headers,
    data: { projectId, engineTypes: ['OPD_GUARD'], fileIds: [fileId] },
  });
  expect(run.ok(), await run.text()).toBeTruthy();
  const analysisId: string = (await run.json()).analysisId ?? (await run.json()).id;
  await expect
    .poll(async () => (await (await request.get(`${API}/analyses/${analysisId}`, { headers })).json()).status, {
      timeout: 60_000,
      intervals: [1000],
    })
    .toMatch(/COMPLETED|PARTIAL/);
  return { projectId, fileId, analysisId };
}

/** Signs in through the real login form (cookie + client session exactly as a user gets them). */
export async function loginThroughUi(page: Page, account: Pick<LiveAccount, 'email' | 'password'>) {
  await page.goto('/login');
  await page.locator('#login-email').fill(account.email);
  await page.locator('#login-password').fill(account.password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

/** Pre-answers the cookie banner so it does not cover controls (the banner itself is audited on the public pages). */
export async function acceptNecessaryCookies(page: Page) {
  await page.context().addCookies([{ name: 'erp_consent', value: 'necessary', url: WEB_URL }]);
}
