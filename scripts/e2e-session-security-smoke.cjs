// Live session-security suite (spec 10.2 magic link, C §8.2 / §68 cookie session, OWASP CSRF).
// Usage: WEB_URL=http://localhost:3000 API_BASE_URL=http://localhost:3001 MAIL_DEV_OUTBOX_TOKEN=... \
//        [DATABASE_URL=postgres://...] [CHROMIUM_PATH=...] node scripts/e2e-session-security-smoke.cjs [screenshotDir]
// Checks against a running web + API stack (API with MAIL_TRANSPORT=dev):
//   - UI login leaves no JWT in localStorage / sessionStorage / document.cookie; a legacy token
//     left in localStorage is deleted on app start; the login response body carries no token;
//   - session cookie HttpOnly + SameSite, CSRF cookie readable; the app works (create project);
//   - cookie-authenticated POST without X-CSRF-Token -> 403 CSRF_REJECTED, with a foreign Origin
//     -> 403, with the header -> 2xx; Bearer (non-browser) clients are unaffected;
//   - logout via the UI clears the cookies and revokes the server session (/auth/me 401 even
//     when the old cookie value is replayed);
//   - magic link end to end through the dev mailbox (UI request -> e-mail -> landing page ->
//     explicit click -> signed in, auth method MAGIC_LINK), identical response for unknown
//     addresses, single use, superseded links, invalid/malformed tokens, expiry (DATABASE_URL),
//     2FA users continue to the TOTP step.
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_ORIGIN = (process.env.API_BASE_URL || process.env.API_URL || WEB.replace(/:(\d+)$/, (_m, p) => `:${Number(p) + 1}`)).replace(/\/$/, '');
const API = `${API_ORIGIN}/api/v1`;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'erp-session-security-'));
fs.mkdirSync(OUT, { recursive: true });
const R = `${Date.now() % 1000000}${Math.floor(Math.random() * 1000)}`;
const PASSWORD = 'SessionSmokePass!2026';
const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Non-browser HTTP call (no Origin, no Sec-Fetch-*): the API treats it as a CLI/script client. */
async function http(method, p, { token, cookie, origin, csrf, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + p, { method, headers, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

async function mailLinks(to, template) {
  const res = await fetch(`${API}/dev/mail/messages?to=${encodeURIComponent(to)}&limit=50`, {
    headers: { 'X-Dev-Mailbox-Token': process.env.MAIL_DEV_OUTBOX_TOKEN || '' },
  });
  if (res.status === 404) throw new Error('dev mailbox unavailable: run the API with MAIL_TRANSPORT=dev');
  const { items } = await res.json();
  return items.filter((m) => m.template === template).flatMap((m) => m.links);
}

/** Waits for a new e-mail link of `template` that is not in `seen`. */
async function nextMailLink(to, template, seen = []) {
  for (let i = 0; i < 40; i++) {
    const link = (await mailLinks(to, template)).find((l) => !seen.includes(l));
    if (link) return link;
    await sleep(250);
  }
  throw new Error(`no new ${template} e-mail for ${to}`);
}

const tokenOf = (link) => new URL(link).searchParams.get('token');

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

async function pg(sql, params = []) {
  const { Client } = require(require.resolve('pg', { paths: [path.join(ROOT, 'apps/api')] }));
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}

async function registerVerified(tag) {
  const email = `session${tag}${R}@e2e.local`;
  const reg = await http('POST', '/auth/register', {
    body: { email, password: PASSWORD, fullName: `Session ${tag}`, organizationName: `Session ${tag} ${R}` },
  });
  assert(reg.status === 201 && reg.body.accessToken, `register failed: ${reg.status} ${JSON.stringify(reg.body).slice(0, 200)}`);
  const link = await nextMailLink(email, 'EMAIL_VERIFICATION');
  const v = await http('POST', '/auth/verify-email', { body: { token: tokenOf(link) } });
  assert(v.status === 200, `verify-email failed: ${v.status}`);
  return { email, token: reg.body.accessToken, orgId: reg.body.user.organizationId };
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'erp_consent', value: 'necessary', url: WEB }]);
  const page = await context.newPage();
  const problems = [];
  page.on('response', (r) => { if (r.url().includes('/api/v1/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  const step = async (name, fn) => {
    try { await fn(); console.log('OK   ', name); }
    catch (e) { failures++; console.log('FAIL ', name, '::', String((e && e.message) || e).split('\n')[0]); }
    await page.screenshot({ path: `${OUT}/${name.replace(/\W+/g, '_')}.png`, fullPage: true }).catch(() => {});
  };
  /** Runs fetch inside the page (Origin = web app, cookies included), like the app itself. */
  const pageFetch = (p, init = {}) =>
    page.evaluate(async ([url, init]) => {
      const res = await fetch(url, { credentials: 'include', ...init });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: res.status, body };
    }, [API + p, init]);
  const sessionCookie = async () => (await context.cookies(API_ORIGIN)).find((c) => c.name === 'erppreflight_session');
  const csrfCookie = async () => (await context.cookies(API_ORIGIN)).find((c) => c.name === 'erp_csrf');

  let user;
  await step('00 setup: verified account (API, non-browser client still receives a bearer token)', async () => {
    user = await registerVerified('a');
    const me = await http('GET', '/auth/me', { token: user.token });
    assert(me.status === 200 && me.body.user.email === user.email, `bearer /auth/me: ${me.status}`);
  });
  if (!user) { await browser.close(); process.exit(1); }

  let loginBody;
  await step('01 UI login: legacy token purged, no token in the response body or in any script-readable storage', async () => {
    await page.goto(`${WEB}/login`);
    await page.evaluate(() => {
      localStorage.setItem('erppreflight_token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsZWdhY3kifQ.legacy-signature-value');
      sessionStorage.setItem('erppreflight_token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsZWdhY3kifQ.legacy-signature-value');
    });
    await page.reload();
    await page.waitForFunction(() => !localStorage.getItem('erppreflight_token') && !sessionStorage.getItem('erppreflight_token'), null, { timeout: 10000 });
    await page.getByLabel('Work Email').fill(user.email);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /Sign In/ }).click(),
    ]);
    loginBody = await resp.json();
    assert(resp.status() === 200, `login HTTP ${resp.status()}`);
    assert(!('accessToken' in loginBody) && !JWT_RE.test(JSON.stringify(loginBody)), 'login response body must not contain the session token');
    assert(typeof loginBody.csrfToken === 'string' && loginBody.csrfToken.length >= 32, 'login response carries a CSRF token');
    await page.waitForURL(/\/projects/, { timeout: 15000 });
    await page.getByRole('button', { name: /Logout/ }).waitFor({ timeout: 15000 });
    const storage = await page.evaluate(() => {
      const dump = (s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`);
      return { local: dump(localStorage), session: dump(sessionStorage), cookie: document.cookie };
    });
    const all = [...storage.local, ...storage.session, storage.cookie].join('\n');
    assert(!JWT_RE.test(all), `a JWT is readable by script: ${all.slice(0, 200)}`);
    assert(!storage.local.some((e) => e.startsWith('erppreflight_token=')), 'legacy token key present');
    assert(!/erppreflight_session=/.test(storage.cookie), 'session cookie visible to document.cookie');
    assert(/erp_auth=1/.test(storage.cookie), 'navigation marker cookie missing');
  });

  let sess;
  await step('02 cookie flags: session HttpOnly + SameSite, CSRF cookie readable, same session as /auth/me', async () => {
    sess = await sessionCookie();
    const csrf = await csrfCookie();
    assert(sess, 'erppreflight_session cookie missing');
    assert(sess.httpOnly === true, 'session cookie must be HttpOnly');
    assert(['Lax', 'Strict'].includes(sess.sameSite), `session cookie SameSite=${sess.sameSite}`);
    assert(csrf && csrf.httpOnly === false && csrf.value === loginBody.csrfToken, 'erp_csrf cookie must be readable and match the login response');
    console.log(`      session cookie: HttpOnly=${sess.httpOnly} SameSite=${sess.sameSite} Secure=${sess.secure} Path=${sess.path}`);
    const me = await pageFetch('/auth/me');
    assert(me.status === 200 && me.body.user.email === user.email, `cookie /auth/me: ${me.status}`);
  });

  await step('03 app works on the cookie session: create a project through the UI', async () => {
    await page.goto(`${WEB}/projects`);
    await page.getByText('New Project').click();
    await page.getByPlaceholder('e.g. S/4HANA 2023 Enterprise Migration Preflight').fill(`Session Smoke ${R}`);
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/v1/projects') && r.request().method() === 'POST'),
      page.locator('form button[type=submit]').click(),
    ]);
    assert(created.status() === 201, `create project HTTP ${created.status()}`);
    assert(!created.request().headers()['authorization'], 'the web app must not send a bearer token');
    assert(created.request().headers()['x-csrf-token'], 'the web app must send X-CSRF-Token on unsafe requests');
    await page.getByText(`Session Smoke ${R}`).first().waitFor({ timeout: 15000 });
  });

  await step('03b production topology (API cookies not readable by the web origin): CSRF token via GET /auth/csrf after reload', async () => {
    // web on erppreflight.com + API on api.erppreflight.com without SESSION_COOKIE_DOMAIN: the
    // web app cannot read erp_csrf and has lost its in-memory copy after a reload.
    await context.clearCookies({ name: 'erp_csrf' });
    const csrfFetches = [];
    const onResponse = (r) => { if (r.url().endsWith('/api/v1/auth/csrf')) csrfFetches.push(r.status()); };
    page.on('response', onResponse);
    await page.goto(`${WEB}/projects`);
    await page.getByText('New Project').click();
    await page.getByPlaceholder('e.g. S/4HANA 2023 Enterprise Migration Preflight').fill(`Session Smoke B ${R}`);
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/v1/projects') && r.request().method() === 'POST'),
      page.locator('form button[type=submit]').click(),
    ]);
    page.off('response', onResponse);
    assert(csrfFetches.length > 0 && csrfFetches.every((s) => s === 200), `GET /auth/csrf: ${JSON.stringify(csrfFetches)}`);
    assert(created.status() === 201, `create project without a readable CSRF cookie: HTTP ${created.status()}`);
    assert(created.request().headers()['x-csrf-token'], 'X-CSRF-Token missing');
    sess = await sessionCookie();
  });

  const cookieHeader = () => `erppreflight_session=${sess.value}`;
  await step('04 CSRF: cookie-auth POST without X-CSRF-Token -> 403 CSRF_REJECTED (in the browser and from a script)', async () => {
    const inPage = await pageFetch('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'csrf-a', targetRelease: 'S4H_2023' }) });
    assert(inPage.status === 403 && inPage.body.code === 'CSRF_REJECTED', `in-page: ${inPage.status} ${JSON.stringify(inPage.body).slice(0, 160)}`);
    const script = await http('POST', '/projects', { cookie: cookieHeader(), origin: WEB, body: { name: 'csrf-b', targetRelease: 'S4H_2023' } });
    assert(script.status === 403 && script.body.code === 'CSRF_REJECTED', `script: ${script.status}`);
    const wrong = await http('POST', '/projects', { cookie: cookieHeader(), origin: WEB, csrf: 'forged-token', body: { name: 'csrf-c', targetRelease: 'S4H_2023' } });
    assert(wrong.status === 403 && wrong.body.code === 'CSRF_REJECTED', `forged token: ${wrong.status}`);
  });

  await step('05 CSRF: foreign Origin / Referer -> 403 even with a valid token', async () => {
    const csrf = (await csrfCookie()).value;
    const evil = await http('POST', '/projects', { cookie: cookieHeader(), origin: 'https://evil.example', csrf, body: { name: 'csrf-d', targetRelease: 'S4H_2023' } });
    assert(evil.status === 403 && evil.body.code === 'CSRF_REJECTED', `foreign origin: ${evil.status}`);
    const nul = await http('POST', '/projects', { cookie: cookieHeader(), origin: 'null', csrf, body: { name: 'csrf-e', targetRelease: 'S4H_2023' } });
    assert(nul.status === 403, `Origin null: ${nul.status}`);
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(), Referer: 'https://evil.example/page', 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'csrf-f', targetRelease: 'S4H_2023' }),
    });
    assert(res.status === 403, `foreign Referer: ${res.status}`);
    const loginCsrf = await http('POST', '/auth/login', { origin: 'https://evil.example', body: { email: user.email, password: PASSWORD } });
    assert(loginCsrf.status === 403 && loginCsrf.body.code === 'CSRF_REJECTED', `login from a foreign origin: ${loginCsrf.status}`);
  });

  await step('06 CSRF: trusted Origin + X-CSRF-Token -> 2xx (browser and script); GET /auth/csrf; Bearer exempt', async () => {
    const got = await pageFetch('/auth/csrf');
    assert(got.status === 200 && got.body.csrfToken === (await csrfCookie()).value, 'GET /auth/csrf returns the session token');
    const inPage = await pageFetch('/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': got.body.csrfToken },
      body: JSON.stringify({ name: `csrf-ok-page-${R}`, targetRelease: 'S4H_2023' }),
    });
    assert(inPage.status === 201, `in-page with header: ${inPage.status} ${JSON.stringify(inPage.body).slice(0, 160)}`);
    const script = await http('POST', '/projects', { cookie: cookieHeader(), origin: WEB, csrf: got.body.csrfToken, body: { name: `csrf-ok-script-${R}`, targetRelease: 'S4H_2023' } });
    assert(script.status === 201, `script with header: ${script.status}`);
    const bearer = await http('POST', '/projects', { token: user.token, body: { name: `bearer-${R}`, targetRelease: 'S4H_2023' } });
    assert(bearer.status === 201, `bearer client: ${bearer.status}`);
    const anon = await http('GET', '/auth/csrf');
    assert(anon.status === 200 && anon.body.csrfToken === null, 'no CSRF token without a session');
  });

  await step('07 logout via the UI: cookies cleared, server session revoked (/auth/me 401, replayed cookie 401)', async () => {
    await page.goto(`${WEB}/projects`);
    await page.getByRole('button', { name: /Logout/ }).click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await page.waitForFunction(() => !document.cookie.includes('erp_auth=1'), null, { timeout: 5000 });
    assert(!(await sessionCookie()), 'session cookie still present after logout');
    const me = await pageFetch('/auth/me');
    assert(me.status === 401, `/auth/me after logout: ${me.status}`);
    const replay = await http('GET', '/auth/me', { cookie: cookieHeader() });
    assert(replay.status === 401, `replayed old cookie after logout: ${replay.status}`);
    const tenant = await page.evaluate(() => localStorage.getItem('erppreflight_tenant_id'));
    assert(!tenant, 'tenant id not cleared on logout');
  });

  // ------------------------------------------------------------------ magic link
  let magicToken;
  await step('08 magic link: UI request ("Send me a sign-in link"), neutral confirmation, identical API answer for unknown addresses', async () => {
    const before = await mailLinks(user.email, 'MAGIC_LINK');
    await page.goto(`${WEB}/login`);
    await page.getByTestId('login-magic-link').click();
    await page.getByLabel('Work Email').fill(user.email);
    await page.getByRole('button', { name: /Send sign-in link/ }).click();
    await page.getByTestId('magic-link-sent').waitFor({ timeout: 15000 });
    const link = await nextMailLink(user.email, 'MAGIC_LINK', before);
    assert(link.startsWith(`${WEB}/login/magic?token=`), `link target ${link}`);
    magicToken = tokenOf(link);
    assert(/^[A-Za-z0-9_-]{43}$/.test(magicToken), 'opaque 256-bit token');
    const known = await http('POST', '/auth/magic-link', { body: { email: `nobody${R}@e2e.local` } });
    const unknown = await http('POST', '/auth/magic-link', { body: { email: `NOBODY-2-${R}@e2e.local` } });
    assert(known.status === 200 && unknown.status === 200 && JSON.stringify(known.body) === JSON.stringify(unknown.body), 'responses differ');
    assert(known.body.expiresInMinutes === 15, 'expiry is 15 minutes');
    await sleep(500);
    assert((await mailLinks(`nobody${R}@e2e.local`, 'MAGIC_LINK')).length === 0, 'mail sent to an unknown address');
    // A second request supersedes the first link (only the newest link is valid).
    const seen = await mailLinks(user.email, 'MAGIC_LINK');
    const again = await http('POST', '/auth/magic-link', { body: { email: user.email } });
    assert(again.status === 200, 'second request');
    const newest = await nextMailLink(user.email, 'MAGIC_LINK', seen);
    const oldPreview = await http('POST', '/auth/magic-link/preview', { body: { token: magicToken } });
    assert(oldPreview.status === 200 && oldPreview.body.valid === false, 'superseded link must be invalid');
    magicToken = tokenOf(newest);
  });

  await step('09 magic link: landing page previews without consuming, explicit click signs in (cookie session, MAGIC_LINK)', async () => {
    await page.goto(`${WEB}/login/magic?token=${magicToken}`);
    await page.getByTestId('magic-link-ready').waitFor({ timeout: 15000 });
    await page.getByText(user.email).first().waitFor({ timeout: 5000 });
    assert(!page.url().includes('token='), 'token not removed from the address bar');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/magic-link/verify')),
      page.getByTestId('magic-link-continue').click(),
    ]);
    const body = await resp.json();
    assert(resp.status() === 200 && !('accessToken' in body) && !JWT_RE.test(JSON.stringify(body)), 'verify body must not carry the token');
    await page.waitForURL(/\/projects/, { timeout: 15000 });
    const sessions = await pageFetch('/auth/sessions');
    const current = (sessions.body || []).find((s) => s.current);
    assert(current && current.authMethod === 'MAGIC_LINK', `current session method ${current && current.authMethod}`);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
    assert(!JWT_RE.test(storage), 'JWT readable after magic-link sign-in');
    const s = await sessionCookie();
    assert(s && s.httpOnly, 'magic-link session is an HttpOnly cookie');
  });

  await step('10 magic link: single use, invalid and malformed tokens rejected', async () => {
    const reuse = await http('POST', '/auth/magic-link/verify', { body: { token: magicToken } });
    assert(reuse.status === 401 && reuse.body.code === 'MAGIC_LINK_INVALID', `reuse: ${reuse.status} ${JSON.stringify(reuse.body).slice(0, 120)}`);
    const random = await http('POST', '/auth/magic-link/verify', { body: { token: crypto.randomBytes(32).toString('base64url') } });
    assert(random.status === 401 && random.body.code === 'MAGIC_LINK_INVALID', `unknown token: ${random.status}`);
    const malformed = await http('POST', '/auth/magic-link/verify', { body: { token: 'not-a-token' } });
    assert(malformed.status === 400, `malformed token: ${malformed.status}`);
    await page.goto(`${WEB}/login/magic?token=${magicToken}`);
    await page.getByTestId('magic-link-invalid').waitFor({ timeout: 15000 });
  });

  await step('11 magic link: expired link rejected (15-minute expiry enforced server-side)', async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to age a link past its expiry');
    const seen = await mailLinks(user.email, 'MAGIC_LINK');
    await http('POST', '/auth/magic-link', { body: { email: user.email } });
    const token = tokenOf(await nextMailLink(user.email, 'MAGIC_LINK', seen));
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const [row] = await pg(
      `SELECT purpose, consumed_at, EXTRACT(EPOCH FROM (expires_at - created_at))::int AS ttl FROM user_action_tokens WHERE token_hash = $1`,
      [hash]
    );
    assert(row && row.purpose === 'MAGIC_LINK' && row.consumed_at === null, 'token stored only as SHA-256 digest');
    assert(row.ttl === 900, `stored TTL ${row.ttl}s, expected 900s`);
    const plain = await pg(`SELECT count(*)::int AS n FROM user_action_tokens WHERE token_hash = $1`, [token]);
    assert(plain[0].n === 0, 'plaintext token must never be stored');
    await pg(`UPDATE user_action_tokens SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1`, [hash]);
    const preview = await http('POST', '/auth/magic-link/preview', { body: { token } });
    assert(preview.body.valid === false, 'expired link previews as invalid');
    const expired = await http('POST', '/auth/magic-link/verify', { body: { token } });
    assert(expired.status === 401 && expired.body.code === 'MAGIC_LINK_INVALID', `expired: ${expired.status}`);
  });

  await step('12 magic link + 2FA: continues to the TOTP step, then issues the session (MAGIC_LINK_2FA)', async () => {
    const mfa = await registerVerified('mfa');
    const setup = await http('POST', '/auth/2fa/setup', { token: mfa.token, body: { password: PASSWORD } });
    assert(setup.status === 200 && setup.body.secret, `2fa setup: ${setup.status}`);
    const enabled = await http('POST', '/auth/2fa/enable', { token: mfa.token, body: { code: totp(setup.body.secret) } });
    assert(enabled.status === 200, `2fa enable: ${enabled.status} ${JSON.stringify(enabled.body).slice(0, 120)}`);
    const seen = await mailLinks(mfa.email, 'MAGIC_LINK');
    await http('POST', '/auth/magic-link', { body: { email: mfa.email } });
    const token = tokenOf(await nextMailLink(mfa.email, 'MAGIC_LINK', seen));
    const first = await http('POST', '/auth/magic-link/verify', { body: { token } });
    assert(first.status === 200 && first.body.mfaRequired === true && first.body.challengeToken && !first.body.accessToken, 'magic link must not bypass 2FA');
    const done = await http('POST', '/auth/login/2fa', { body: { challengeToken: first.body.challengeToken, code: totp(setup.body.secret, 1) } });
    assert(done.status === 200 && done.body.accessToken, `2fa completion: ${done.status} ${JSON.stringify(done.body).slice(0, 120)}`);
    const sessions = await http('GET', '/auth/sessions', { token: done.body.accessToken });
    const current = sessions.body.find((s) => s.current);
    assert(current && current.authMethod === 'MAGIC_LINK_2FA', `auth method ${current && current.authMethod}`);
  });

  await step('13 logout hygiene: cookie logout needs the CSRF header; UI logout clears both cookies', async () => {
    const logout = await pageFetch('/auth/logout', { method: 'POST' });
    assert(logout.status === 403 && logout.body.code === 'CSRF_REJECTED', `cookie logout without CSRF header must be rejected: ${logout.status}`);
    await page.goto(`${WEB}/projects`);
    await page.getByRole('button', { name: /Logout/ }).click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    assert(!(await sessionCookie()) && !(await csrfCookie()), 'cookies not cleared');
    const me = await pageFetch('/auth/me');
    assert(me.status === 401, `/auth/me after logout: ${me.status}`);
  });

  await step('14 audit trail: magic-link request and magic-link sign-in are recorded in the tenant ledger', async () => {
    const events = await http('GET', '/audit/events?limit=300', { token: user.token });
    assert(events.status === 200 && Array.isArray(events.body), `audit events: ${events.status}`);
    const actions = events.body.map((e) => e.action);
    assert(actions.includes('USER_MAGIC_LINK_REQUESTED'), 'USER_MAGIC_LINK_REQUESTED missing');
    const signIn = events.body.find((e) => e.action === 'auth.login.succeeded' && JSON.stringify(e).includes('MAGIC_LINK'));
    assert(signIn, 'auth.login.succeeded with method MAGIC_LINK missing');
    assert(!JWT_RE.test(JSON.stringify(events.body)), 'audit payloads must not contain tokens');
    const chain = await http('GET', '/audit/verify', { token: user.token });
    assert(chain.status === 200 && chain.body.isValid === true, `audit chain verification: ${JSON.stringify(chain.body).slice(0, 160)}`);
  });

  await browser.close();
  if (problems.length) {
    console.log('Server errors observed:\n  ' + [...new Set(problems)].slice(0, 10).join('\n  '));
    failures++;
  }
  console.log(failures === 0 ? '\nSESSION SECURITY SMOKE PASSED' : `\nSESSION SECURITY SMOKE FAILED (${failures})`);
  console.log(`screenshots: ${OUT}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
