// Browser smoke test of the account lifecycle UI against a running web + API stack.
// Usage: WEB_URL=http://localhost:3000 [API_URL=http://localhost:3001] [MAIL_DEV_OUTBOX_TOKEN=...]
//        [CHROMIUM_PATH=/path/to/chromium] node scripts/e2e-account-ui-smoke.cjs [screenshotDir]
// Requires the API to run with MAIL_TRANSPORT=dev (links are read from the dev mailbox).
// Covers: forgot/reset password, 2FA enrollment + 2FA login, sessions, invitations
// (new and existing users), organization switching and account deletion.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('@playwright/test');

const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_URL || WEB.replace(/:(\d+)$/, (_m, p) => `:${Number(p) + 1}`)).replace(/\/$/, '');
const S = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'erp-account-ui-'));
const R = Date.now() % 1000000;
let failures = 0;

async function api(pathname, body, token) {
  const res = await fetch(`${API}/api/v1${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function mailLink(to, template, notIn = []) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${API}/api/v1/dev/mail/messages?to=${encodeURIComponent(to)}`, {
      headers: { 'X-Dev-Mailbox-Token': process.env.MAIL_DEV_OUTBOX_TOKEN || '' },
    });
    if (res.status === 404) throw new Error('dev mailbox unavailable: run the API with MAIL_TRANSPORT=dev');
    const { items } = await res.json();
    const link = items.filter((m) => m.template === template).flatMap((m) => m.links).find((l) => !notIn.includes(l));
    if (link) return link;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no ${template} e-mail for ${to}`);
}

function totp(secret, offsetSteps = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/\s+/g, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}

async function registerVerified(email, password, org) {
  const res = await api('/auth/register', { email, password, fullName: email.split('@')[0], organizationName: org });
  const link = await mailLink(email, 'EMAIL_VERIFICATION');
  await api('/auth/verify-email', { token: link.split('token=')[1] });
  return res;
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const step = async (p, name, fn) => {
    try {
      await fn();
      console.log('OK   ', name);
    } catch (e) {
      failures++;
      console.log('FAIL ', name, '::', e.message.split('\n')[0]);
    }
    await p.screenshot({ path: `${S}/${name.replace(/\W+/g, '_')}.png`, fullPage: true }).catch(() => {});
  };
  const login = async (p, email, password) => {
    await p.goto(WEB + '/login');
    await p.getByLabel(/Work Email/).fill(email);
    await p.getByLabel(/^Password/).fill(password);
    await p.getByRole('button', { name: /Sign In/ }).click();
  };

  const owner = `owner${R}@e2e.local`;
  let ownerPw = 'OwnerPass!2026xy';
  await registerVerified(owner, ownerPw, `UI Org ${R}`);

  await step(page, '01 forgot password -> reset -> sign in', async () => {
    await page.goto(WEB + '/forgot-password');
    await page.getByLabel(/Account email/).fill(owner);
    await page.getByRole('button', { name: /Send reset link/ }).click();
    await page.getByText('Check your inbox').waitFor({ timeout: 10000 });
    const link = await mailLink(owner, 'PASSWORD_RESET');
    await page.goto(link);
    ownerPw = 'OwnerReset!2026zz';
    await page.getByLabel(/^New password/).fill(ownerPw);
    await page.getByLabel(/Confirm new password/).fill(ownerPw);
    await page.getByRole('button', { name: /Set new password/ }).click();
    await page.getByText('Password changed').waitFor({ timeout: 10000 });
    await login(page, owner, ownerPw);
    await page.waitForURL(/\/projects/, { timeout: 15000 });
  });

  let secret = '';
  await step(page, '02 enroll TOTP 2FA in settings', async () => {
    await page.goto(WEB + '/settings/security');
    await page.getByRole('button', { name: /Set up two-factor authentication/ }).click();
    await page.getByLabel(/Confirm your password/).fill(ownerPw);
    await page.getByRole('button', { name: /^Continue$/ }).click();
    secret = (await page.getByLabel('Setup key').textContent()).replace(/\s+/g, '');
    await page.getByLabel(/Authentication code/).fill(totp(secret));
    await page.getByRole('button', { name: /Enable 2FA/ }).click();
    await page.getByRole('list', { name: 'Recovery codes' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /I have stored my codes/ }).click();
    await page.getByText('Two-factor authentication is on').waitFor({ timeout: 10000 });
    await page.getByText('This device').first().waitFor({ timeout: 10000 });
  });

  await step(page, '03 sign out and sign in with TOTP', async () => {
    await page.getByRole('button', { name: /Logout/ }).click();
    await page.waitForURL(/\/login/, { timeout: 10000 });
    await login(page, owner, ownerPw);
    await page.getByText('Two-factor authentication').first().waitFor({ timeout: 10000 });
    await page.getByLabel(/Authentication code/).fill(totp(secret, 1));
    await page.getByRole('button', { name: /Verify and sign in/ }).click();
    await page.waitForURL(/\/projects/, { timeout: 15000 });
  });

  const newbie = `newbie${R}@e2e.local`;
  const member = `member${R}@e2e.local`;
  const memberPw = 'MemberPass!2026q';
  await registerVerified(member, memberPw, `Member Org ${R}`);
  await step(page, '04 invite a new and an existing user', async () => {
    await page.goto(WEB + '/settings/members');
    for (const [email, role] of [[newbie, 'AUDITOR'], [member, 'LEAD_ARCHITECT']]) {
      await page.getByLabel(/E-mail address/).fill(email);
      await page.getByLabel(/^Role/).selectOption(role);
      await page.getByRole('button', { name: /Send invitation/ }).click();
      await page.getByText(`Invitation sent to ${email}`).waitFor({ timeout: 10000 });
    }
    await page.getByText(newbie).first().waitFor();
  });

  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on('dialog', (d) => d.accept());
  await step(p2, '05 new user accepts invitation by creating an account', async () => {
    await p2.goto(await mailLink(newbie, 'ORGANIZATION_INVITATION'));
    await p2.getByText(`Join UI Org ${R}`).waitFor({ timeout: 10000 });
    await p2.getByLabel(/Full name/).fill('New Bie');
    await p2.getByLabel(/^Password/).fill('NewbiePass!2026w');
    await p2.getByLabel(/Confirm password/).fill('NewbiePass!2026w');
    await p2.getByRole('button', { name: /Create account and join/ }).click();
    await p2.waitForURL(/\/projects/, { timeout: 15000 });
  });

  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p3 = await ctx3.newPage();
  p3.on('dialog', (d) => d.accept());
  await step(p3, '06 existing user accepts invitation and switches organization', async () => {
    const link = await mailLink(member, 'ORGANIZATION_INVITATION');
    await p3.goto(link);
    await p3.getByRole('link', { name: /Sign in as/ }).click();
    await p3.getByLabel(/Work Email/).fill(member);
    await p3.getByLabel(/^Password/).fill(memberPw);
    await p3.getByRole('button', { name: /Sign In/ }).click();
    await p3.waitForURL(/accept-invite/, { timeout: 15000 });
    await p3.getByRole('button', { name: new RegExp(`Join UI Org ${R}`) }).click();
    await p3.waitForURL(/\/projects/, { timeout: 15000 });
    const switcher = p3.getByRole('combobox', { name: /Active organization/ });
    await switcher.waitFor({ timeout: 10000 });
    const before = await p3.evaluate(() => localStorage.getItem('erppreflight_tenant_id'));
    const other = await switcher.evaluate((el, cur) => [...el.options].map((o) => o.value).find((v) => v !== cur), before);
    await switcher.selectOption(other);
    await p3.waitForFunction((v) => localStorage.getItem('erppreflight_tenant_id') === v, other, { timeout: 10000 });
    await p3.goto(WEB + '/settings/members');
    await p3.getByText(member).first().waitFor({ timeout: 10000 });
  });

  await step(p3, '07 export personal data and delete account', async () => {
    await p3.goto(WEB + '/settings/account');
    const [download] = await Promise.all([
      p3.waitForEvent('download', { timeout: 15000 }),
      p3.getByRole('button', { name: /Personal data \(JSON\)/ }).click(),
    ]);
    const file = path.join(S, 'account-export.json');
    await download.saveAs(file);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (json.profile.email !== member || json.memberships.length !== 2) throw new Error('unexpected export content');
    await p3.getByRole('button', { name: /Start account deletion/ }).click();
    await p3.getByText(/Organizations deleted with your account/).waitFor({ timeout: 10000 });
    await p3.getByLabel(/I understand these organizations/).check();
    await p3.locator('#delete-password').fill(memberPw);
    await p3.locator('#delete-confirmation').fill('DELETE MY ACCOUNT');
    await p3.getByRole('button', { name: /Permanently delete my account/ }).click();
    await p3.waitForURL(/\/login/, { timeout: 15000 });
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: member, password: memberPw }),
    });
    if (res.status !== 401) throw new Error(`deleted account can still sign in (${res.status})`);
  });

  await step(page, '08 owner sees members and revokes a pending invitation', async () => {
    const extra = `extra${R}@e2e.local`;
    await page.goto(WEB + '/settings/members');
    await page.getByLabel(/E-mail address/).fill(extra);
    await page.getByRole('button', { name: /Send invitation/ }).click();
    await page.getByText(`Invitation sent to ${extra}`).waitFor({ timeout: 10000 });
    const row = page.locator('li', { hasText: extra });
    await row.getByRole('button', { name: /Revoke/ }).click();
    await row.getByText('Revoked').waitFor({ timeout: 10000 });
    await page.getByText('New Bie').first().waitFor({ timeout: 10000 });
  });

  await browser.close();
  console.log(failures ? `${failures} STEP(S) FAILED (screenshots: ${S})` : 'ALL STEPS PASSED');
  process.exit(failures ? 1 : 0);
})();
