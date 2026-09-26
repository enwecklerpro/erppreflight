#!/usr/bin/env node
/* eslint-disable */
/**
 * Browser verification of the Integrations UI (/integrations) and the finding →
 * work item flow against a running web + API + contract doubles.
 *
 *   WEB_URL=http://localhost:3700 API_BASE_URL=http://localhost:3701 DOUBLES_FILE=... \
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/e2e-integrations-ui.cjs <screenshotDir>
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..');
const WEB = process.env.WEB_URL || 'http://localhost:3700';
const A = `${(process.env.API_BASE_URL || 'http://localhost:3701').replace(/\/+$/, '')}/api/v1`;
const D = JSON.parse(fs.readFileSync(process.env.DOUBLES_FILE, 'utf8'));
const OUT = process.argv[2] || path.join(require('node:os').tmpdir(), 'erppf-integrations-ui');
fs.mkdirSync(OUT, { recursive: true });
const R = Math.random().toString(36).slice(2, 8);
let failures = 0;

async function api(method, p, token, body) {
  const res = await fetch(`${A}${p}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await res.text();
  return t ? JSON.parse(t) : {};
}

(async () => {
  // ---- seed a realistic tenant through the public API -----------------------------------
  const email = `ui.${R}@e2e-integrations.test`;
  const password = 'UiIntegrations!2026';
  const reg = await api('POST', '/auth/register', null, { email, password, fullName: 'Ingrid Integrations', organizationName: `Integrations UI ${R}` });
  const token = reg.accessToken;
  const project = await api('POST', '/projects', token, { name: `S/4 Upgrade ${R}`, targetRelease: 'S4H_2023' });
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(path.join(ROOT, 'tests/fixtures/known_bad_billing_opd.xml'))]), 'known_bad_billing_opd.xml');
  const up = await (await fetch(`${A}/projects/${project.id}/files`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })).json();
  const an = await api('POST', '/analyses', token, { projectId: project.id, engineTypes: ['OPD_GUARD'], fileIds: [up.fileId] });
  for (let i = 0; i < 40; i++) {
    const s = (await api('GET', `/analyses/${an.analysisId}`, token)).status;
    if (/COMPLETED|FAILED|PARTIAL/.test(s)) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const calm = await api('POST', '/connectors', token, {
    type: 'SAP_CLOUD_ALM',
    name: 'Cloud ALM – S/4 program',
    config: { apiBaseUrl: D.cloudAlm.url, tokenUrl: D.cloudAlm.tokenUrl, defaultProjectId: D.cloudAlm.projects[0].id },
    credentials: { clientId: D.cloudAlm.clientId, clientSecret: D.cloudAlm.clientSecret },
  });
  await api('POST', '/connectors', token, { type: 'JIRA', name: 'Jira – SAPS4 (read-only)', config: { baseUrl: D.jira.url, projectKey: 'SAPS4' }, credentials: { email: D.jira.email, apiToken: 'revoked-token' } });
  await api('POST', '/connectors', token, { type: 'ODATA', name: 'OData – API_BUSINESS_PARTNER', config: { serviceRootUrl: D.odata.serviceRootUrl, authType: 'BASIC' }, credentials: { username: D.odata.username, password: D.odata.password } });
  const hook = await api('POST', '/webhooks', token, { url: `${D.webhook.url}/ui`, events: ['analysis.completed', 'traceability.task_dispatched', 'connector.unhealthy'] });
  await api('POST', `/webhooks/${hook.id}/test`, token);
  const enroll = await api('POST', '/agents/enrollment-tokens', token, { label: 'ui', ttlMinutes: 30 });
  const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'erppf-ui-agent-'));
  require('node:child_process').spawnSync('node', [path.join(ROOT, 'apps/local-agent/dist/cli.js'), 'enroll', A.replace(/\/api\/v1$/, ''), enroll.enrollmentToken, '--name', 'plant-walldorf-01'], { env: { ...process.env, ERP_PREFLIGHT_AGENT_HOME: home } });
  require('node:child_process').spawnSync('node', [path.join(ROOT, 'apps/local-agent/dist/cli.js'), 'daemon', '--once'], { env: { ...process.env, ERP_PREFLIGHT_AGENT_HOME: home } });
  await api('PUT', '/sso/admin/config', token, { issuer: D.oidc.issuer, clientId: D.oidc.clientId, clientSecret: D.oidc.clientSecret });
  await api('POST', '/sso/admin/domains', token, { domain: `ui-${R}.test` });

  // ---- browser ---------------------------------------------------------------------------
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  const step = async (name, fn) => {
    try {
      await fn();
      console.log(`OK    ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL  ${name}: ${err.message.split('\n')[0]}`);
    }
    await page.screenshot({ path: path.join(OUT, `${name.replace(/\W+/g, '_')}.png`), fullPage: true }).catch(() => undefined);
  };

  await step('01 login', async () => {
    await page.goto(`${WEB}/login`);
    await page.getByLabel(/Work Email/i).fill(email);
    await page.getByLabel(/^Password/i).fill(password);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/projects/, { timeout: 20000 });
  });

  await step('02 integrations connectors tab', async () => {
    await page.goto(`${WEB}/integrations`);
    await page.getByText('Cloud ALM – S/4 program').waitFor({ timeout: 15000 });
    await page.getByRole('link', { name: 'Integrations' }).first().waitFor();
  });

  await step('03 test Cloud ALM connection shows capability handshake', async () => {
    const row = page.locator('li', { hasText: 'Cloud ALM – S/4 program' });
    await row.getByRole('button', { name: /Test connection/ }).click();
    await row.getByText(/Connection OK/).waitFor({ timeout: 20000 });
    await row.getByText('What ERP Preflight cannot access').waitFor();
    await row.getByText('Healthy').waitFor();
  });

  await step('04 failing Jira connector shows error state', async () => {
    const row = page.locator('li', { hasText: 'Jira – SAPS4 (read-only)' });
    await row.getByRole('button', { name: /Test connection/ }).click();
    await row.getByText(/Connection failed/).waitFor({ timeout: 20000 });
    await row.getByText(/authentication failed/).first().waitFor();
  });

  await step('05 fetch OData metadata baseline', async () => {
    const row = page.locator('li', { hasText: 'OData – API_BUSINESS_PARTNER' });
    await row.getByRole('button', { name: /Fetch metadata baseline/ }).click();
    await row.getByText(/Baseline V2 stored/).waitFor({ timeout: 20000 });
  });

  await step('06 grant write access with two-step confirmation', async () => {
    const row = page.locator('li', { hasText: 'Cloud ALM – S/4 program' });
    await row.getByRole('button', { name: /Allow writes/ }).click();
    await row.getByRole('button', { name: /Confirm: allow/ }).click();
    await row.getByText('Read + write').waitFor({ timeout: 10000 });
  });

  await step('07 add connector form (registry-driven, least privilege)', async () => {
    await page.getByRole('button', { name: /^Add connector$/ }).click();
    await page.getByLabel('Connector type').selectOption('AZURE_DEVOPS');
    await page.getByText('Permissions requested (least privilege)').waitFor();
    await page.getByRole('button', { name: /Save connector/ }).click();
    await page.getByText(/Name must have at least 2 characters/).waitFor({ timeout: 5000 });
    await page.getByRole('button', { name: 'Cancel' }).first().click();
  });

  await step('08 finding → preview → create Cloud ALM work item', async () => {
    await page.goto(`${WEB}/projects/${project.id}/findings`);
    await page.getByText(/OPD_DETERMINATION_STEP_MISSING|Output Type Determination Failed/).first().click({ timeout: 20000 });
    await page.getByText('Work Management Integration').first().waitFor({ timeout: 10000 });
    await page.getByLabel('Target work management system').first().selectOption({ label: 'Cloud ALM – S/4 program' });
    await page.getByRole('button', { name: /Preview work item/ }).first().click();
    await page.getByText(/Reproducibility \/ support ID/).first().waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Create work item in/ }).first().click();
    await page.getByRole('link', { name: /TSK-\d+/ }).first().waitFor({ timeout: 20000 });
  });

  await step('09 work items tab with remediation state', async () => {
    await page.goto(`${WEB}/integrations?tab=work-items`);
    await page.getByRole('link', { name: /TSK-\d+/ }).first().waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /Sync/ }).first().click();
    await page.getByText('Open').first().waitFor();
  });

  await step('10 webhooks tab delivery log', async () => {
    await page.goto(`${WEB}/integrations?tab=webhooks`);
    await page.getByRole('button', { name: /Show delivery log/ }).first().click({ timeout: 15000 });
    await page.getByText('Delivered').first().waitFor({ timeout: 15000 });
  });

  await step('11 local agents tab shows enrolled device', async () => {
    await page.goto(`${WEB}/integrations?tab=agents`);
    await page.getByText('plant-walldorf-01').waitFor({ timeout: 15000 });
    await page.getByText(/Online/).first().waitFor();
  });

  await step('12 SSO and SCIM tab', async () => {
    await page.goto(`${WEB}/integrations?tab=identity`);
    await page.getByLabel(/Issuer URL/).waitFor({ timeout: 15000 });
    await page.getByText(`ui-${R}.test`).first().waitFor();
    await page.getByText(/_erppreflight-challenge/).waitFor();
  });

  await step('13 partners tab', async () => {
    await page.goto(`${WEB}/integrations?tab=partners`);
    await page.getByText('Consulting partners with access to this organization').waitFor({ timeout: 15000 });
    await page.getByText(/No client organizations/).waitFor();
  });

  await step('14 keyboard navigation of the tablist', async () => {
    await page.goto(`${WEB}/integrations?tab=connectors`);
    await page.getByRole('tab', { name: 'Connectors' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForURL(/tab=work-items/);
    const selected = await page.getByRole('tab', { name: 'Work items' }).getAttribute('aria-selected');
    if (selected !== 'true') throw new Error('arrow key did not select the next tab');
  });

  await step('15 traceability matrix page', async () => {
    await page.goto(`${WEB}/projects/${project.id}/traceability`);
    await page.getByText('Traceability matrix').first().waitFor({ timeout: 15000 });
    await page.getByRole('link', { name: /TSK-\d+/ }).first().waitFor({ timeout: 15000 });
  });

  await step('16 mobile layout without horizontal scroll', async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${WEB}/integrations`);
    await page.getByText('Cloud ALM – S/4 program').waitFor({ timeout: 15000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) throw new Error(`page scrolls horizontally by ${overflow}px`);
  });

  await step('17 SSO start page', async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${WEB}/sso`);
    await page.getByLabel(/Work e-mail/).fill(`nobody@unknown-${R}.test`);
    await page.getByRole('button', { name: /Continue with SSO/ }).click();
    await page.getByText(/not configured for this e-mail domain/).waitFor({ timeout: 10000 });
  });

  await browser.close();
  if (problems.length) console.log('PAGE ERRORS', problems);
  console.log(failures ? `${failures} STEP(S) FAILED (screenshots: ${OUT})` : `ALL STEPS PASSED (screenshots: ${OUT})`);
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
