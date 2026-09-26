// Category B: Live System E2E — axe-core WCAG 2.2 AA audit of the key pages (AGENTS.md §5.2 Gate 6).
import { test, expect } from '@playwright/test';
import { acceptNecessaryCookies, loginThroughUi, registerVerifiedAccount, seedProjectWithFinding, type LiveAccount } from './support/live-stack';
import { expectNoSeriousA11yViolations } from './support/axe';

/**
 * Serious and critical axe violations fail the test; minor/moderate ones are attached to the
 * report (axe-<page>.json) for review. Pages are audited in their loaded state with real data:
 * a verified tenant with one project, the golden OPD fixture and a completed OPD Guard run.
 */
test.describe('Accessibility (axe-core, WCAG 2.2 AA) — public pages', () => {
  for (const locale of ['en', 'de'] as const) {
    test(`public home /${locale}`, async ({ page }, testInfo) => {
      await page.goto(`/${locale}`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('h1').first()).toBeVisible();
      await expectNoSeriousA11yViolations(page, testInfo, `home-${locale}`);
    });
  }

  test('login', async ({ page }, testInfo) => {
    await acceptNecessaryCookies(page);
    await page.goto('/login');
    await expect(page.locator('#login-email')).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, 'login');
  });
});

test.describe('Accessibility (axe-core, WCAG 2.2 AA) — application pages', () => {
  let account: LiveAccount;
  let projectId: string;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    account = await registerVerifiedAccount(request, 'pw-a11y');
    ({ projectId } = await seedProjectWithFinding(request, account, 'Accessibility audit project'));
  });

  test.beforeEach(async ({ page }) => {
    await acceptNecessaryCookies(page);
    await loginThroughUi(page, account);
  });

  test('projects list', async ({ page }, testInfo) => {
    await page.goto('/projects');
    await expect(page.getByText('Accessibility audit project').first()).toBeVisible({ timeout: 15_000 });
    await expectNoSeriousA11yViolations(page, testInfo, 'projects');
  });

  test('project workspace', async ({ page }, testInfo) => {
    await page.goto(`/projects/${projectId}`);
    await expect(page.getByText('Accessibility audit project').first()).toBeVisible({ timeout: 15_000 });
    await expectNoSeriousA11yViolations(page, testInfo, 'project-workspace');
  });

  test('findings ledger with an expanded finding', async ({ page }, testInfo) => {
    await page.goto(`/projects/${projectId}/findings`);
    const row = page.getByText(/OPD_DETERMINATION_STEP_MISSING|Output Type Determination Failed/).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expectNoSeriousA11yViolations(page, testInfo, 'findings');
    await row.click();
    await expect(page.getByText(/known_bad_billing_opd\.xml#Channel/).first()).toBeVisible({ timeout: 10_000 });
    await expectNoSeriousA11yViolations(page, testInfo, 'finding-detail');
  });

  test('analyze', async ({ page }, testInfo) => {
    await page.goto('/analyze');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expectNoSeriousA11yViolations(page, testInfo, 'analyze');
  });

  test('settings', async ({ page }, testInfo) => {
    await page.goto('/settings');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expectNoSeriousA11yViolations(page, testInfo, 'settings');
  });
});
