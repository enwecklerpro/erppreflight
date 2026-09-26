// Category B: Live System E2E — requires a running stack (playwright.live.config.ts).
import { test, expect } from '@playwright/test';
import { API, FIXTURE_PATH, acceptNecessaryCookies, mailLink, uniqueSuffix } from './support/live-stack';

/**
 * ERP Preflight — core user journey against the real stack (no route interception):
 * 1. Sign up through the web form -> HttpOnly session cookie set by the API.
 * 2. Verify the e-mail address from the link in the dev mailbox (analyses are locked before).
 * 3. Create a project workspace (S/4HANA 2023).
 * 4. Upload tests/fixtures/known_bad_billing_opd.xml through the Artifact Dropzone (ClamAV scan).
 * 5. Run OPD Guard from the Analysis Launcher and wait for the worker.
 * 6. Open the findings ledger: OPD_DETERMINATION_STEP_MISSING with evidence pointer
 *    (known_bad_billing_opd.xml#Channel), line 23 and the SHA-256 the API recorded.
 */
test.describe('Preflight pipeline — known-bad OPD golden fixture (live)', () => {
  test('signup -> verify -> workspace -> upload -> analyze -> findings ledger with evidence', async ({ page, context, request }) => {
    test.setTimeout(180_000);
    const suffix = uniqueSuffix();
    const email = `pw.pipeline.${suffix}@e2e.local`;
    const password = `Pipeline-${suffix}-2026!`;
    const projectName = `Playwright pipeline ${suffix}`;
    await acceptNecessaryCookies(page);

    // 1. Signup
    await page.goto('/signup');
    await page.getByPlaceholder('Acme Global Industries').fill(`Playwright Org ${suffix}`);
    await page.getByPlaceholder('Jane Doe').fill('Playwright Pipeline');
    await page.getByLabel(/Work Email/).fill(email);
    const pw = page.getByPlaceholder('••••••••••••');
    await pw.nth(0).fill(password);
    await pw.nth(1).fill(password);
    await page.locator('button[type=submit]').click();
    await page.waitForURL(/\/(projects|onboarding)/, { timeout: 20_000 });
    const session = (await context.cookies()).find((c) => c.name === 'erppreflight_session');
    expect(session, 'session cookie issued by the API').toBeDefined();
    expect(session?.httpOnly).toBe(true);

    // 2. E-mail verification through the real link
    const link = await mailLink(request, email, 'EMAIL_VERIFICATION');
    await page.goto(link);
    await expect(page.getByText('E-mail verified').first()).toBeVisible({ timeout: 15_000 });

    // 3. Project workspace
    await page.goto('/projects');
    await page.getByText('New Project').click();
    await page.getByPlaceholder('e.g. S/4HANA 2023 Enterprise Migration Preflight').fill(projectName);
    await page.locator('form button[type=submit]').click();
    await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText('Enter Workspace').first().click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 15_000 });
    const projectId = page.url().match(/\/projects\/([0-9a-f-]{36})/)![1];

    // 4. Upload through the dropzone (the file row appears once the scan finished)
    await page.getByText('Artifact Dropzone').first().click();
    await page.locator('input[type=file]').first().setInputFiles(FIXTURE_PATH);
    await expect(page.getByText(/known_bad_billing_opd\.xml/).first()).toBeVisible({ timeout: 30_000 });

    // 5. Run OPD Guard from the launcher
    await page.getByText('Analysis Launcher').first().click();
    const fileCheckbox = page.locator('input[type=checkbox]').first();
    await expect(fileCheckbox).toBeVisible({ timeout: 15_000 });
    await fileCheckbox.check();
    await page.getByRole('button', { name: /Execute Preflight Run/i }).first().click();

    // The API is the source of truth for completion; the UI must then show the result.
    const login = await request.post(`${API}/auth/login`, { data: { email, password } });
    expect(login.ok()).toBeTruthy();
    const headers = { Authorization: `Bearer ${(await login.json()).accessToken}` };
    await expect
      .poll(
        async () => {
          const res = await request.get(`${API}/findings?projectId=${projectId}&pageSize=50`, { headers });
          const body = await res.json();
          return (body.items ?? body).length;
        },
        { timeout: 90_000, intervals: [2000] },
      )
      .toBeGreaterThanOrEqual(1);
    const findings = await (await request.get(`${API}/findings?projectId=${projectId}&pageSize=50`, { headers })).json();
    const opd = (findings.items ?? findings).find((f: any) => (f.ruleId ?? f.code ?? f.findingCode) === 'OPD_DETERMINATION_STEP_MISSING') ?? (findings.items ?? findings)[0];
    const evidence = (opd.evidence ?? [])[0];
    expect(evidence?.artifactPath).toContain('known_bad_billing_opd.xml#Channel');
    expect(evidence?.lineNumber).toBe(23);
    expect(evidence?.sha256).toMatch(/^[a-f0-9]{64}$/);

    // 6. Findings ledger with evidence
    await page.goto(`/projects/${projectId}/findings`);
    const row = page.getByText(/OPD_DETERMINATION_STEP_MISSING|Output Type Determination Failed/).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(page.getByText(/known_bad_billing_opd\.xml#Channel/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Line 23').first()).toBeVisible();
    await expect(page.getByText(`SHA-256: ${evidence.sha256}`).first()).toBeVisible();
    // Severity is shown as text, never as colour alone (AGENTS.md Axiom 1 #5)
    await expect(page.getByText('Major', { exact: true }).first()).toBeVisible();
  });
});
