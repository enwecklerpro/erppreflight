'use client';

import * as React from 'react';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { useT } from '@/i18n/client';
import { AnalysisProgressStepper } from './analysis-progress-stepper';

/**
 * Small, self-translating building blocks the project workspace page embeds for
 * the W2 features (Full Preflight tab, Context tab, run progress), so the page
 * itself only references them.
 */
export function ProjectTabLabel({ tab }: { tab: 'preflight' | 'context' }) {
  const t = useT();
  return <>{tab === 'preflight' ? t('fullPreflight.title') : t('projectContext.tab')}</>;
}

export function RunFullPreflightLabel() {
  const t = useT();
  return <>{t('fullPreflight.run')}</>;
}

/** Collapsible stage stepper for one run in the run history. */
export function RunProgressDisclosure({ analysisId }: { analysisId: string }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const id = `run-progress-${analysisId}`;
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        data-testid={`run-progress-${analysisId}`}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary"
      >
        {open ? <ChevronDown className="size-3" aria-hidden="true" /> : <ChevronRight className="size-3" aria-hidden="true" />}
        <Activity className="size-3" aria-hidden="true" />
        {open ? t('progress.hideProgress') : t('progress.showProgress')}
      </button>
      {open && (
        <div id={id} className="mt-2 rounded-lg border border-border p-3">
          <AnalysisProgressStepper analysisId={analysisId} />
        </div>
      )}
    </div>
  );
}
