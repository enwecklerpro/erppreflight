// Browser part of scripts/e2e-tenant-admin-smoke.cjs (run by it when WEB_URL is set).
// Real Chromium against the running web + API: ticket conversation (customer + support console),
// IP allowlist settings (save, lockout confirmation, removal), impersonation from the admin console
// (read-only banner with countdown, a refused write, End), suspend / reactivate dialogs and the
// suspended screen (EN + DE), trial extension dialog.
const path = require('path');

async function run(ctx) {
  const { A, WEB, SHOTS, admin, a, b, R, PASSWORD, step, call, expect, expectStatus } = ctx;
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch {
    ({ chromium } = require(require.resolve('@playwright/test', { paths: [path.join(__dirname, '../apps/web')] })));
  }
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const consent = [
    { name: 'erp_consent', value: 'necessary', url: WEB },
    { name: 'erp_locale', value: 'en', url: WEB },
  ];
  const opsCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const memberCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await opsCtx.addCookies(consent);
  await memberCtx.addCookies(consent);
  const ops = await opsCtx.newPage();
  const member = await memberCtx.newPage();
  for (const p of [ops, member]) p.on('dialog', (d) => d.accept());

  const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }).catch(() => undefined);
  const login = async (p, email, password) => {
    await p.goto(`${WEB}/login`);
    await p.getByLabel(/Work Email/).fill(email);
    await p.getByLabel(/^Password/).fill(password);
    await p.getByRole('button', { name: /Sign In/ }).click();
    await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  };
  const openTenantDialog = async (orgName) => {
    await ops.goto(`${WEB}/admin`);
    await ops.getByRole('button', { name: 'Tenant Directory' }).click();
    await ops.getByLabel('Search organizations').fill(orgName);
    await ops.getByRole('button', { name: `Manage access of ${orgName}` }).click();
    const dialog = ops.getByRole('dialog');
    await dialog.getByText(`Access administration: ${orgName}`).waitFor({ timeout: 15000 });
    await dialog.getByTestId('tenant-access-status').waitFor({ timeout: 15000 });
    return dialog;
  };
  const orgA = `Tenant Admin a ${R}`;
  const orgB = `Tenant Admin b ${R}`;

  await step('60 UI: sign-in of operator and member', async () => {
    await login(ops, admin.email, process.env.SUPER_ADMIN_PASSWORD);
    await login(member, a.email, PASSWORD);
  });

  await step('61 UI: ticket conversation (customer reply, support console thread)', async () => {
    await member.goto(`${WEB}/settings/support`);
    const item = member.locator('li', { hasText: `Dashboard leer ${R}` }).first();
    await item.getByRole('button', { name: 'Conversation' }).click();
    const thread = item.getByRole('region', { name: 'Conversation' });
    await thread.getByText('Bitte laden Sie die Datei erneut hoch.').waitFor({ timeout: 15000 });
    await thread.getByLabel(/^Reply/).fill(`Reply from the browser ${R}`);
    await thread.getByRole('button', { name: 'Send reply' }).click();
    await thread.getByText('Reply sent.').waitFor({ timeout: 15000 });
    await thread.getByText(`Reply from the browser ${R}`).waitFor({ timeout: 15000 });
    await shot(member, '61_customer_thread');
    await ops.goto(`${WEB}/admin`);
    await ops.getByRole('button', { name: 'Support Console' }).click();
    const row = ops.locator('li', { hasText: `Dashboard leer ${R}` }).first();
    await row.getByRole('button', { name: 'Conversation' }).click();
    await row.getByText(`Reply from the browser ${R}`).waitFor({ timeout: 15000 });
    await row.getByText(/Language of the requester’s e-mails: German/).waitFor();
    await shot(ops, '61_support_console_thread');
  });

  await step('62 UI: IP allowlist settings (save own address, lockout warning, removal)', async () => {
    await member.goto(`${WEB}/settings/security`);
    const panel = member.locator('section', { has: member.getByRole('heading', { name: 'IP allowlist' }) });
    await panel.getByText(/Not enforced/).waitFor({ timeout: 15000 });
    await panel.getByRole('button', { name: 'Add my current address' }).click();
    await panel.getByRole('button', { name: 'Save allowlist' }).click();
    await panel.getByText('The IP allowlist was saved.').waitFor({ timeout: 15000 });
    await panel.getByText(/Enforced: 1 entry/).waitFor();
    await panel.getByText('Allowed by the list').waitFor();
    // Replace the own address with a foreign network -> lockout confirmation, cancelled.
    await panel.getByRole('button', { name: 'Remove entry 1' }).click();
    await panel.getByRole('button', { name: 'Add entry' }).click();
    await panel.getByLabel(/Address or CIDR range/).first().fill('10.0.0.5/24x');
    await panel.getByRole('button', { name: 'Save allowlist' }).click();
    await panel.getByText(/Enter an IPv4\/IPv6 address or CIDR range/).waitFor({ timeout: 5000 });
    await panel.getByLabel(/Address or CIDR range/).first().fill('203.0.113.0/24');
    await panel.getByRole('button', { name: 'Save allowlist' }).click();
    const dlg = member.getByRole('dialog');
    await dlg.getByText('This would lock you out').waitFor({ timeout: 15000 });
    await shot(member, '62_lockout_dialog');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect((await call('GET', '/projects', { token: a.token })).status === 200, 'still allowed after cancel');
    await member.reload();
    await panel.getByRole('button', { name: 'Remove allowlist' }).click();
    await member.getByRole('dialog').getByRole('button', { name: 'Remove allowlist' }).click();
    await panel.getByText(/every network is allowed again/).waitFor({ timeout: 15000 });
    const view = await call('GET', '/organizations/current/ip-allowlist', { token: a.token });
    expect(view.json?.enforced === false, 'allowlist removed');
  });

  await step('63 UI: impersonation from the admin console (banner, read-only, End)', async () => {
    const dialog = await openTenantDialog(orgA);
    await dialog.getByRole('button', { name: `Impersonate ${a.email}` }).click();
    await dialog.getByLabel(/^Duration/).selectOption('5');
    await dialog.getByLabel(/^Reason/).fill(`UI smoke ${R}: reproduce customer view`);
    await shot(ops, '63_impersonate_dialog');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await ops.waitForURL(/\/dashboard/, { timeout: 20000 });
    const banner = ops.getByTestId('impersonation-banner');
    await banner.getByText(`You are impersonating ${a.email}`).waitFor({ timeout: 20000 });
    await banner.getByText('Read-only').waitFor();
    const countdown = await ops.getByTestId('impersonation-countdown').innerText();
    expect(/Ends in 0[0-5]:\d\d/.test(countdown), `countdown "${countdown}"`);
    await shot(ops, '63_banner');
    // A write is refused with a clear message (API 403 IMPERSONATION_READ_ONLY).
    await ops.goto(`${WEB}/settings/security`);
    const panel = ops.locator('section', { has: ops.getByRole('heading', { name: 'IP allowlist' }) });
    await panel.getByRole('button', { name: 'Add entry' }).click();
    await panel.getByLabel(/Address or CIDR range/).first().fill('198.51.100.0/24');
    await panel.getByRole('button', { name: 'Save allowlist' }).click();
    await panel.getByText(/This impersonation session is read-only/).waitFor({ timeout: 15000 });
    await shot(ops, '63_read_only_refused');
    await ops.getByTestId('impersonation-banner').getByRole('button', { name: 'End impersonation' }).click();
    await ops.waitForURL(/\/admin/, { timeout: 20000 });
    await ops.getByRole('heading', { name: 'Platform administration' }).waitFor({ timeout: 20000 });
    const list = await call('GET', `/admin/impersonations?organizationId=${a.orgId}`, { token: admin.token });
    const s = list.json.find((x) => x.reason === `UI smoke ${R}: reproduce customer view`);
    expect(s && s.status === 'ENDED' && s.requestCount > 0, `session ${JSON.stringify(s && { status: s.status, n: s.requestCount })}`);
    expect((await call('GET', '/organizations/current/ip-allowlist', { token: a.token })).json?.enforced === false, 'nothing was written');
  });

  await step('64 UI: suspend dialog -> member sees the suspended screen (EN + DE)', async () => {
    const dialog = await openTenantDialog(orgA);
    await dialog.getByRole('button', { name: 'Suspend organization' }).click();
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await dialog.getByText(/at least 10 characters/).waitFor({ timeout: 5000 });
    await dialog.getByLabel(/^Reason/).fill(`UI suspension ${R}: contract ended`);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await dialog.getByText(/The organization was suspended; 1 owner was notified/).waitFor({ timeout: 15000 });
    await dialog.getByTestId('tenant-access-status').getByText('Suspended').waitFor();
    await shot(ops, '64_suspended_dialog');
    expectStatus(await call('GET', '/projects', { token: a.token }), 403, 'TENANT_SUSPENDED', 'member API');
    await member.goto(`${WEB}/dashboard`);
    await member.waitForURL(/\/suspended/, { timeout: 20000 });
    await member.getByTestId('access-suspended').getByText(`UI suspension ${R}: contract ended`).waitFor({ timeout: 15000 });
    await member.getByRole('link', { name: 'Account & personal data' }).waitFor();
    await shot(member, '64_suspended_en');
    await memberCtx.addCookies([{ name: 'erp_locale', value: 'de', url: WEB }]);
    await member.reload();
    await member.getByRole('heading', { name: `${orgA} ist gesperrt` }).waitFor({ timeout: 15000 });
    await member.getByText('Was weiterhin möglich ist').waitFor();
    await shot(member, '64_suspended_de');
    await memberCtx.addCookies([{ name: 'erp_locale', value: 'en', url: WEB }]);
  });

  await step('65 UI: reactivate dialog restores access', async () => {
    const dialog = ops.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Reactivate organization' }).click();
    await dialog.getByLabel(/^Reason/).fill(`UI reactivation ${R}: contract renewed`);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await dialog.getByText(/The organization was reactivated/).waitFor({ timeout: 15000 });
    await dialog.getByTestId('tenant-access-status').getByText('Active').waitFor();
    await member.goto(`${WEB}/suspended`);
    await member.getByTestId('access-active').waitFor({ timeout: 15000 });
    await member.goto(`${WEB}/dashboard`);
    await member.waitForTimeout(1500);
    expect(new URL(member.url()).pathname === '/dashboard', `member stays on ${member.url()}`);
    expect((await call('GET', '/projects', { token: a.token })).status === 200, 'API access restored');
  });

  await step('66 UI: extend-trial dialog (bounded, reflected at once)', async () => {
    await ops.keyboard.press('Escape');
    const before = await call('GET', `/admin/tenants/${b.orgId}/access`, { token: admin.token });
    expect(before.json?.trial?.extendable === true, 'tenant b has an extendable trial');
    const dialog = await openTenantDialog(orgB);
    await dialog.getByRole('button', { name: 'Extend trial' }).click();
    await dialog.getByLabel(/^Days/).fill('95');
    await dialog.getByLabel(/^Reason/).fill(`UI trial extension ${R}`);
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await dialog.getByText('Invalid value').first().waitFor({ timeout: 5000 });
    await dialog.getByLabel(/^Days/).fill('7');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await dialog.getByText(/The trial now ends on/).waitFor({ timeout: 15000 });
    await shot(ops, '66_trial_extended');
    const after = await call('GET', `/admin/tenants/${b.orgId}/access`, { token: admin.token });
    const moved = (new Date(after.json.trial.endsAt) - new Date(before.json.trial.endsAt)) / 86_400_000;
    expect(Math.round(moved) === 7 && after.json.trial.extendedDays === 7, `trial moved by ${moved} days`);
  });

  await browser.close();
}

module.exports = { run };
