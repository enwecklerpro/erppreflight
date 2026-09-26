import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/analyze',
  useSearchParams: () => new URLSearchParams(),
}));

import { ProblemRouteResponseSchema, type AnalysisProgress } from '@erppreflight/schemas';
import { I18nProvider } from '../i18n/client';
import { parseSseBuffer } from '../lib/api/analysis-orchestration';
import { ProgressStepperView } from '../components/analysis/analysis-progress-stepper';
import { RouterSuggestions } from '../components/analysis/router-suggestions';
import { toContextPayload } from '../components/projects/project-context-form';
import { requiresAuth } from '../lib/routing';

const withI18n = (ui: React.ReactElement, locale: 'en' | 'de' = 'en') => render(<I18nProvider locale={locale}>{ui}</I18nProvider>);

describe('SSE parsing', () => {
  it('splits complete messages, keeps the partial tail and reads event/id/data', () => {
    const { messages, rest } = parseSseBuffer('event: stage\nid: 7\ndata: {"a":1}\n\n: comment\n\nevent: end\ndata: {"status":"COMPLETED"}\n\nevent: snap');
    expect(messages).toEqual([
      { event: 'stage', id: '7', data: '{"a":1}' },
      { event: 'end', id: null, data: '{"status":"COMPLETED"}' },
    ]);
    expect(rest).toBe('event: snap');
  });
});

const progress: AnalysisProgress = {
  analysisId: '11111111-1111-4111-8111-111111111111',
  status: 'RUNNING',
  kind: 'STANDARD',
  currentStage: 'RUNNING_RULES',
  percent: 42,
  terminal: false,
  updatedAt: null,
  stages: {
    UPLOAD_VALIDATED: { state: 'COMPLETED' },
    PARSING: { state: 'COMPLETED' },
    RUNNING_RULES: { state: 'RUNNING', detail: { done: 1, total: 3 } },
    MATCHING_EVIDENCE: { state: 'PENDING' },
    GENERATING_TESTS: { state: 'SKIPPED', detail: { reason: 'nothing eligible' } },
    FINALIZING: { state: 'PENDING' },
  },
};

describe('ProgressStepperView', () => {
  it('renders the six stages with textual state (not colour only) and an accessible progressbar', () => {
    withI18n(<ProgressStepperView progress={progress} transport="sse" />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(6);
    expect(within(items[2]).getByText('In progress')).toBeTruthy();
    expect(items[2].getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('1 of 3 engine runs')).toBeTruthy();
    expect(within(items[4]).getByText('Skipped')).toBeTruthy();
    expect(screen.getByText('Live updates')).toBeTruthy();
  });

  it('is localized in German', () => {
    withI18n(<ProgressStepperView progress={progress} />, 'de');
    expect(screen.getByText('3. Regeln ausführen')).toBeTruthy();
  });
});

describe('RouterSuggestions', () => {
  it('shows role, reasons, required inputs and keeps AI output separate', () => {
    const result = ProblemRouteResponseSchema.parse({
      routingId: '22222222-2222-4222-8222-222222222222',
      classifierVersion: 'router-2026.09.1',
      problem: 'supplier email is not sent',
      unmatched: false,
      contractsAvailable: true,
      notice: 'Routing is advisory.',
      context: { projectId: null, targetRelease: null, sourceErp: null, targetProduct: null, deploymentType: null, modules: [], countries: [] },
      suggestions: [
        {
          engine: 'OPD_GUARD',
          engineName: 'OPD Guard',
          role: 'PRIMARY',
          score: 5,
          confidence: 0.71,
          confidenceClass: 'RULE_DERIVED',
          why: [{ kind: 'PHRASE', detail: 'output / e-mail / print is not produced', weight: 4 }],
          condition: null,
          acceptedFormats: ['JSON', 'XML'],
          inputSummary: 'decision tables',
          requiredInputs: [{ description: 'At least one decision table', satisfiedBy: [] }],
          matchingFileIds: [],
        },
      ],
      ai: {
        status: 'APPLIED',
        provider: 'OPENAI',
        model: 'm',
        tokens: 10,
        latencyMs: 5,
        suggestions: [{ engine: 'FORM_DOCTOR', reason: 'maybe the form', confidence: 0.6, confidenceClass: 'INFERRED', agreesWithDeterministic: false }],
        conflicts: ['AI additionally proposes FormDoctor'],
        note: 'AI refinement',
      },
    });
    withI18n(<RouterSuggestions result={result} />);
    expect(screen.getByText('OPD Guard')).toBeTruthy();
    expect(screen.getByText('Primary')).toBeTruthy();
    expect(screen.getByText(/At least one decision table/)).toBeTruthy();
    expect(screen.getByTestId('router-ai').textContent).toContain('INFERRED');
    expect(screen.getByTestId('router-ai').textContent).toContain('not matched by rules');
  });
});

describe('Project context payload', () => {
  it('normalises lists and maps empty selects to null', () => {
    expect(
      toContextPayload({
        sourceErp: 'SAP_ECC',
        sourceVersion: ' EHP8 ',
        targetProduct: '',
        targetEdition: '',
        targetRelease: 'S4H_2023',
        deploymentType: 'PUBLIC_CLOUD',
        countries: 'de, fr;at',
        modules: 'fi mm',
      })
    ).toEqual({
      sourceErp: 'SAP_ECC',
      sourceVersion: 'EHP8',
      targetProduct: null,
      targetEdition: null,
      targetRelease: 'S4H_2023',
      deploymentType: 'PUBLIC_CLOUD',
      countries: ['DE', 'FR', 'AT'],
      modules: ['FI', 'MM'],
    });
  });
});

describe('routing', () => {
  it('guards the new Analyze and Reports routes', () => {
    expect(requiresAuth('/analyze')).toBe(true);
    expect(requiresAuth('/reports')).toBe(true);
  });
});
