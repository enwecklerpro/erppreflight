// Browser smoke test of the EN/DE localization of the authenticated application.
// Usage: WEB_URL=http://localhost:3000 [API_URL=http://localhost:3001] [MAIL_DEV_OUTBOX_TOKEN=...]
//        [CHROMIUM_PATH=/path/to/chromium] node scripts/e2e-i18n-smoke.cjs [screenshotDir]
// Requires the API to run with MAIL_TRANSPORT=dev (the account is verified via the dev mailbox).
//
// Flow: registers a verified tenant with a project, signs in through the UI (English),
// switches the language to German with the navbar switcher and visits the main pages
// at 1440 px and 375 px. On every page it asserts:
//   - no raw dictionary keys are rendered (e.g. "app.dashboard.title", "nav.projects");
//   - on German pages, none of the English denylist phrases appear;
//   - no horizontal page scroll at 375 px (both languages);
//   - <html lang> matches the selected language.
// Screenshots of every page/viewport/locale are written to the screenshot directory.
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const WEB = (process.env.WEB_URL || 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_URL || WEB.replace(/:(\d+)$/, (_m, p) => `:${Number(p) + 1}`)).replace(/\/$/, '');
const S = process.argv[2] || fs.mkdtempSync(path.join(require('os').tmpdir(), 'erp-i18n-smoke-'));
const R = Date.now() % 1000000;
let failures = 0;

/** Raw next-intl keys that leaked into the UI (fallback renders the key itself). */
const RAW_KEY = /(?:^|[\s"'(>])((?:app|nav|common|footer|notFound|cookieConsent|pricing|security|knowledge|home|solutions|legal)\.[a-zA-Z][\w-]*(?:\.[\w-]+)+)(?=$|[\s"'),.:;<])/m;

/**
 * English UI phrases that must not appear on German pages (whole-word, case-sensitive).
 * Canonical SAP names, engine names and user data are not in this list.
 */
const EN_DENYLIST = [
  'Loading', 'Try again', 'Retry', 'Could not', 'Something went wrong', 'No results', 'Save changes', 'Cancel',
  'Settings', 'Members', 'Billing', 'Notifications', 'Sign out', 'Sign in', 'Sign In', 'Logout', 'Delete', 'Search',
  'Refresh', 'Unknown', 'Failed', 'Enabled', 'Disabled', 'Required', 'Invite', 'Projects', 'New Project',
  'Enter Workspace', 'Overview', 'Back to', 'View all', 'Show more', 'Description', 'Created', 'Last used',
  'Rows per page', 'selected', 'Columns', 'Export CSV', 'Clear filters', 'No data', 'Unsaved changes', 'Add',
  'Templates', 'Landscapes', 'Release Matrix', 'Knowledge graph', 'Two-factor authentication', 'Password',
  'Current plan', 'Audit log', 'Support tickets', 'Apply', 'Submit', 'Close', 'Open', 'Actions', 'Type', 'Target',
  'Engine status', 'Analysis', 'Findings', 'Objects', 'Traceability', 'Artifacts', 'Welcome', 'Continue',
  'Previous', 'Mark all', 'All caught up', 'Organization', 'Privacy', 'Usage', 'Trial', 'Upgrade', 'Blocked',
];

async function api(pathname, { body, token, tenant, method } = {}) {
  const res = await fetch(`${API}/api/v1${pathname}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenant ? { 'X-Tenant-Id': tenant } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathname} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

async function mailLink(to, template) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${API}/api/v1/dev/mail/messages?to=${encodeURIComponent(to)}`, {
      headers: { 'X-Dev-Mailbox-Token': process.env.MAIL_DEV_OUTBOX_TOKEN || '' },
    });
    if (res.status === 404) throw new Error('dev mailbox unavailable: run the API with MAIL_TRANSPORT=dev');
    const { items } = await res.json();
    const link = items.filter((m) => m.template === template).flatMap((m) => m.links)[0];
    if (link) return link;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no ${template} e-mail for ${to}`);
}

function wordRegex(phrase) {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Hyphenated German compounds (e.g. "Upgrade-Stabilität") are not English copy.
  return new RegExp(`(^|[^A-Za-zÄÖÜäöüß-])${esc}($|[^A-Za-zÄÖÜäöüß-])`);
}
const DENY = EN_DENYLIST.map((p) => [p, wordRegex(p)]);

(async () => {
  const email = `i18n${R}@e2e.local`;
  const password = 'I18nSmokePass!2026';
  const reg = await api('/auth/register', { body: { email, password, fullName: 'Erika Muster', organizationName: `Musterorganisation ${R}` } });
  const link = await mailLink(email, 'EMAIL_VERIFICATION');
  await api('/auth/verify-email', { body: { token: link.split('token=')[1] } });
  const tenant = reg.user && reg.user.organizationId;
  const project = await api('/projects', {
    body: { name: `Testprojekt ${R}`, targetRelease: 'S4H_2023', description: 'Lokalisierungstest' },
    token: reg.accessToken,
    tenant,
  });
  const projectId = project.id || (project.data && project.data.id);

  // Pages owned by this workstream get the full English denylist check on German pages.
  // Pages that also host other workstreams' components (project workspace) only get the
  // raw-key and overflow checks.
  const PAGES = [
    { path: '/dashboard', name: 'dashboard' },
    { path: '/projects', name: 'projects' },
    { path: `/projects/${projectId}`, name: 'project-workspace', partial: true },
    { path: `/projects/${projectId}/objects`, name: 'project-objects' },
    { path: `/projects/${projectId}/simulation`, name: 'project-simulation' },
    { path: `/projects/${projectId}/traceability`, name: 'project-traceability' },
    { path: '/inspector', name: 'inspector', partial: true }, // hosts the findings grid (findings workstream)
    { path: '/templates', name: 'templates' },
    { path: '/artifacts', name: 'artifacts' },
    { path: '/landscapes', name: 'landscapes' },
    { path: '/agent-gate', name: 'agent-gate' },
    { path: '/matrix', name: 'matrix' },
    { path: '/notifications', name: 'notifications' },
    { path: '/knowledge-graph', name: 'knowledge-graph' },
    { path: '/knowledge-graph/lookup', name: 'kg-lookup' },
    { path: '/knowledge-graph/watches', name: 'kg-watches' },
    { path: '/knowledge-graph/releases', name: 'kg-releases' },
    { path: '/onboarding', name: 'onboarding' },
    { path: '/settings', name: 'settings-workspace' },
    { path: '/settings/members', name: 'settings-members' },
    { path: '/settings/security', name: 'settings-security' },
    { path: '/settings/account', name: 'settings-account' },
    { path: '/settings/billing', name: 'settings-billing' },
    { path: '/settings/audit', name: 'settings-audit' },
    { path: '/settings/retention', name: 'settings-retention' },
    { path: '/settings/support', name: 'settings-support' },
    { path: '/status', name: 'status' },
    { path: '/trust', name: 'trust' },
    { path: '/demo', name: 'demo' },
    { path: '/feedback', name: 'feedback' },
    { path: '/changelog', name: 'changelog' },
    { path: '/procurement', name: 'procurement' },
  ];

  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'erp_consent', value: 'necessary', url: WEB }]);
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss());

  const fail = (msg) => {
    failures++;
    console.log('FAIL ', msg);
  };

  // 1. Sign in (English) and switch to German with the navbar language switcher.
  await page.goto(WEB + '/login');
  await page.getByLabel(/Work Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: /Sign In/ }).click();
  await page.waitForURL(/\/(projects|onboarding|dashboard)/, { timeout: 20000 });
  await page.goto(WEB + '/dashboard');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${S}/00_dashboard_en_before_switch.png`, fullPage: true });
  await page.getByTestId('lang-de').first().click();
  try {
    await page.waitForFunction(() => document.documentElement.lang === 'de', null, { timeout: 15000 });
    await page.getByRole('heading', { name: 'Clean Core und Preflight im Überblick' }).waitFor({ timeout: 15000 });
    console.log('OK    language switcher: dashboard re-rendered in German');
  } catch (e) {
    fail(`language switcher did not switch the app to German: ${e.message.split('\n')[0]}`);
  }

  async function checkPage(p, locale, width) {
    const tag = `${p.name}_${locale}_${width}`;
    await page.setViewportSize({ width, height: width < 500 ? 812 : 1000 });
    try {
      await page.goto(WEB + p.path, { waitUntil: 'networkidle', timeout: 30000 });
    } catch {
      // networkidle can time out on polling pages; the DOM is still usable
    }
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${S}/${tag}.png`, fullPage: true });
    const info = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      text: document.body.innerText,
      // Content marked translate="no" (canonical SAP/engine names, customer data) is not UI copy.
      uiText: (() => {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('[translate="no"], script, style').forEach((el) => el.remove());
        document.body.appendChild(clone);
        clone.style.position = 'absolute';
        clone.style.left = '-99999px';
        // Product names that contain English words.
        const text = clone.innerText.replace(/GitHub Actions|Cloud ALM|Clean Core/g, ' ');
        clone.remove();
        return text;
      })(),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      // Outermost elements sticking out on the right (diagnostics for overflow failures).
      offenders: Array.from(document.querySelectorAll('body *'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const pr = el.parentElement ? el.parentElement.getBoundingClientRect() : null;
          return r.width > 0 && r.right > window.innerWidth + 1 && (!pr || pr.right <= window.innerWidth + 1);
        })
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className || '').slice(0, 60)}`),
    }));
    const problems = [];
    if (info.lang !== locale) problems.push(`html lang is "${info.lang}"`);
    const raw = info.text.match(RAW_KEY);
    if (raw) problems.push(`raw dictionary key rendered: ${raw[1]}`);
    if (locale === 'de' && !p.partial) {
      const hits = DENY.map(([phrase, re]) => {
        const m = info.uiText.match(re);
        if (!m) return null;
        const at = m.index ?? 0;
        return `${phrase} (…${info.uiText.slice(Math.max(0, at - 25), at + phrase.length + 25).replace(/\s+/g, ' ')}…)`;
      }).filter(Boolean);
      if (hits.length) problems.push(`English text on German page: ${hits.slice(0, 8).join('; ')}`);
    }
    if (info.scrollWidth > info.innerWidth + 1) problems.push(`horizontal scroll (${info.scrollWidth}px > ${info.innerWidth}px: ${info.offenders.join(' ; ')})`);
    if (problems.length) fail(`${p.path} [${locale} ${width}px] ${problems.join(' | ')}`);
    else console.log('OK   ', `${p.path} [${locale} ${width}px]`);
  }

  // 2. German pass (cookie set by the switcher), desktop and mobile.
  for (const p of PAGES) {
    for (const width of [1440, 375]) await checkPage(p, 'de', width);
  }

  // 3. English pass: switch back with the navbar switcher; raw keys and overflow checks.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(WEB + '/dashboard', { waitUntil: 'networkidle' }).catch(() => undefined);
  await page.getByTestId('lang-en').first().click();
  await page.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 15000 }).catch(() => fail('switch back to English failed'));
  for (const p of PAGES) {
    for (const width of [1440, 375]) await checkPage(p, 'en', width);
  }

  // 4. Signed-out auth pages in German (preference cookie is honoured without a session).
  await context.clearCookies();
  await context.addCookies([
    { name: 'erp_consent', value: 'necessary', url: WEB },
    { name: 'erp_locale', value: 'de', url: WEB },
  ]);
  for (const p of [
    { path: '/login', name: 'login' },
    { path: '/signup', name: 'signup' },
    { path: '/forgot-password', name: 'forgot-password' },
    { path: '/reset-password?token=invalid', name: 'reset-password' },
    { path: '/verify-email?token=invalid', name: 'verify-email' },
  ]) {
    for (const width of [1440, 375]) await checkPage(p, 'de', width);
  }

  await browser.close();
  console.log(`\nScreenshots: ${S}`);
  console.log(failures === 0 ? 'i18n smoke: ALL PASSED' : `i18n smoke: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
