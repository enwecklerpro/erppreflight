'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { AnalysisRunDetail, AnalysisRunDetailSkeleton } from '@/components/analysis-run/analysis-run-detail';

/**
 * Analysis detail page (section C §15/§16, KNOWN_LIMITATIONS P8):
 * /projects/:projectId/analyses/:analysisId — status and live progress, engine
 * orchestration, inputs with SHA-256, knowledge snapshot, configuration, timing, errors,
 * findings of this run, generated tests, exports, lineage, cancel and re-run.
 */
export default function AnalysisRunPage() {
  const params = useParams();
  const projectId = String(params?.id ?? '');
  const analysisId = String(params?.analysisId ?? '');
  return (
    <React.Suspense fallback={<AnalysisRunDetailSkeleton />}>
      <AnalysisRunDetail projectId={projectId} analysisId={analysisId} />
    </React.Suspense>
  );
}
