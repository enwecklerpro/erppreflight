/**
 * axe-core accessibility audit for Playwright pages (AGENTS.md §5.2 Gate 6, WCAG 2.2 AA).
 * Injects the axe-core engine that ships with the repository (root devDependency `axe-core`)
 * into the page — no network access, no extra wrapper package.
 */
import { expect, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'node:fs';

const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes: Array<{ target: string[]; failureSummary?: string; html: string }>;
}

/** Runs axe on the current page, attaches the full report, and fails on serious/critical violations. */
export async function expectNoSeriousA11yViolations(page: Page, testInfo: TestInfo, label: string) {
  await page.waitForLoadState('networkidle');
  // Let entry animations settle (reduced motion is emulated by the live config) before sampling contrast.
  await page.waitForTimeout(300);
  await page.addScriptTag({ content: AXE_SOURCE });
  const result = await page.evaluate(async (tags) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (window as any).axe;
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return {
      url: r.url as string,
      violations: r.violations.map((v: any) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.slice(0, 10).map((n: any) => ({ target: n.target, failureSummary: n.failureSummary, html: String(n.html).slice(0, 300) })),
      })),
    };
  }, WCAG_TAGS);
  await testInfo.attach(`axe-${label}.json`, { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  const blocking = (result.violations as AxeViolation[]).filter((v) => v.impact && BLOCKING_IMPACTS.has(v.impact));
  const summary = blocking
    .map((v) => `${v.impact} ${v.id}: ${v.help}\n    ${v.nodes.map((n) => `${n.target.join(' ')} — ${(n.failureSummary || '').split('\n')[1]?.trim() ?? ''}`).join('\n    ')}`)
    .join('\n');
  expect(blocking, `${label} (${result.url}) has serious/critical WCAG 2.2 AA violations:\n${summary}`).toEqual([]);
}
