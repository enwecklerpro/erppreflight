'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  FileDown,
  FileSearch,
  FlaskConical,
  GitBranch,
  Info,
  ListTree,
  SearchX,
  Settings2,
  Timer,
} from 'lucide-react';
import type { AnalysisDetail } from '@erppreflight/schemas';
import { ApiError } from '@/lib/api/custom-instance';
import { analysisRunHref, analysisRunKeys, fetchAnalysisDetail } from '@/lib/api/analysis-lifecycle';
import { orchestrationKeys } from '@/lib/api/analysis-orchestration';
import { AnalysisProgressStepper } from '@/components/analysis/analysis-progress-stepper';
import { ReportExportPanel } from '@/components/commercial/report-export-panel';
import { ErrorState } from '@/components/commercial/states';
import { useFmt, useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';
import { CallOutcome, LabVerdict, RunKindBadge, RunStatusBadge, useDuration } from './run-status';
import { RunActions } from './run-actions';
import { RunFindingsTable } from './run-findings-table';
import { GeneratedTestsPanel } from './generated-tests-panel';

const ACTIVE = new Set(['QUEUED', 'RUNNING']);

function Section({
  id,
  title,
  icon: Icon,
  children,
  testId,
}: {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section aria-labelledby={id} data-testid={testId} className="min-w-0 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <h2 id={id} className="mb-3 flex items-center gap-1.5 text-sm font-bold text-foreground">
        <Icon className="size-4 shrink-0 text-primary" aria-hidden={true} />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

function CopyHash({ value, name }: { value: string; name: string }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => undefined
        );
      }}
      aria-label={t('app.analysisRun.inputs.copySha', { name })}
      className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      {copied ? <Check className="size-3 text-emerald-600" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">
        {copied ? t('app.analysisRun.inputs.copied') : ''}
      </span>
    </button>
  );
}

function JsonBlock({ value, emptyText }: { value: Record<string, unknown>; emptyText: string }) {
  const entries = Object.entries(value);
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-wrap gap-1">
          <dt className="font-mono text-muted-foreground" translate="no">
            {k}
          </dt>
          <dd className="min-w-0 break-all font-mono text-foreground" translate="no">
            {typeof v === 'string' ? v : JSON.stringify(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AnalysisRunDetailSkeleton() {
  const t = useT();
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite" data-testid="analysis-detail-loading">
      <span className="sr-only">{t('app.analysisRun.loading')}</span>
      <div className="h-4 w-56 rounded bg-muted animate-pulse motion-reduce:animate-none" />
      <div className="space-y-2 border-b border-border pb-5">
        <div className="h-7 w-72 max-w-full rounded bg-muted animate-pulse motion-reduce:animate-none" />
        <div className="h-4 w-96 max-w-full rounded bg-muted animate-pulse motion-reduce:animate-none" />
      </div>
      {[160, 120, 200, 260].map((h, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 h-4 w-40 rounded bg-muted animate-pulse motion-reduce:animate-none" />
          <div className="rounded-lg bg-muted animate-pulse motion-reduce:animate-none" style={{ height: h }} />
        </div>
      ))}
    </div>
  );
}

function NotFound({ projectId }: { projectId: string }) {
  const t = useT();
  return (
    <div data-testid="analysis-not-found" className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
      <SearchX className="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-base font-bold text-foreground">{t('app.analysisRun.notFoundTitle')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('app.analysisRun.notFoundBody')}</p>
      <Link
        href={`/projects/${encodeURIComponent(projectId)}`}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {t('app.analysisRun.backToWorkspace')}
      </Link>
    </div>
  );
}

/** Analysis detail page (section C §15/§16, P8): everything about one run. */
export function AnalysisRunDetail({ projectId, analysisId }: { projectId: string; analysisId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [message, setMessage] = React.useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const query = useQuery({
    queryKey: analysisRunKeys.detail(analysisId),
    queryFn: ({ signal }) => fetchAnalysisDetail(analysisId, signal),
    enabled: Boolean(analysisId),
    retry: (count, err) => !(err instanceof ApiError && [400, 403, 404].includes(err.statusCode)) && count < 2,
    refetchInterval: (q) => {
      const d = q.state.data as AnalysisDetail | undefined;
      return d && ACTIVE.has(d.analysis.status) ? 4000 : false;
    },
  });

  const onTerminal = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: analysisRunKeys.detail(analysisId) });
    void queryClient.invalidateQueries({ queryKey: analysisRunKeys.findings(analysisId) });
    void queryClient.invalidateQueries({ queryKey: analysisRunKeys.generatedTests(analysisId) });
    void queryClient.invalidateQueries({ queryKey: orchestrationKeys.analysesByProject(projectId) });
  }, [queryClient, analysisId, projectId]);

  // A status change seen by polling (e.g. cancelled while queued) also refreshes the dependent data.
  const status = query.data?.analysis.status;
  const previous = React.useRef(status);
  React.useEffect(() => {
    if (previous.current && status && previous.current !== status && !ACTIVE.has(status)) onTerminal();
    previous.current = status;
  }, [status, onTerminal]);

  if (query.isLoading) return <AnalysisRunDetailSkeleton />;
  if (query.isError) {
    if (query.error instanceof ApiError && [400, 404].includes(query.error.statusCode)) return <NotFound projectId={projectId} />;
    return <ErrorState title={t('app.analysisRun.loadError')} error={query.error} onRetry={() => query.refetch()} />;
  }
  const detail = query.data!;
  if (detail.analysis.projectId !== projectId) return <NotFound projectId={projectId} />;
  return <DetailBody detail={detail} message={message} onMessage={setMessage} onTerminal={onTerminal} />;
}

function DetailBody({
  detail,
  message,
  onMessage,
  onTerminal,
}: {
  detail: AnalysisDetail;
  message: { tone: 'info' | 'error'; text: string } | null;
  onMessage: (m: { tone: 'info' | 'error'; text: string } | null) => void;
  onTerminal: () => void;
}) {
  const t = useT();
  const fmt = useFmt();
  const duration = useDuration();
  const { analysis, cancellation } = detail;
  const isLab = analysis.kind.startsWith('LAB_');
  const shortId = analysis.id.slice(0, 8);
  const cancelRequested = Boolean(cancellation?.requestedAt) && analysis.status !== 'CANCELLED';
  const projectHref = `/projects/${encodeURIComponent(analysis.projectId)}`;
  const who = (u: AnalysisDetail['analysis']['triggeredBy']) => (u ? u.name || u.email || u.id.slice(0, 8) : t('app.analysisRun.facts.system'));

  return (
    <div className="min-w-0 space-y-6" data-testid="analysis-detail" data-status={analysis.status} data-kind={analysis.kind}>
      <nav aria-label={t('app.analysisRun.breadcrumb.label')} className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground">
          {t('app.analysisRun.breadcrumb.projects')}
        </Link>
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <Link href={projectHref} className="max-w-[40vw] truncate hover:text-foreground">
          {analysis.projectName ?? t('app.analysisRun.breadcrumb.workspace')}
        </Link>
        <ChevronRight className="size-3.5" aria-hidden="true" />
        <span className="font-semibold text-foreground" aria-current="page">
          {t('app.analysisRun.breadcrumb.run', { id: shortId })}
        </span>
      </nav>

      <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-extrabold text-foreground sm:text-2xl">
            {isLab ? <FlaskConical className="size-6 shrink-0 text-primary" aria-hidden="true" /> : <FileSearch className="size-6 shrink-0 text-primary" aria-hidden="true" />}
            {isLab ? t('app.analysisRun.title.lab') : t('app.analysisRun.title.analysis')}
            <span className="font-mono text-base font-semibold text-muted-foreground" translate="no">
              {shortId}
            </span>
          </h1>
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            <RunStatusBadge status={analysis.status} cancelRequested={cancelRequested} testId="analysis-status" />
            <RunKindBadge kind={analysis.kind} />
            {analysis.targetRelease && (
              <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] font-semibold text-foreground" translate="no">
                {analysis.targetRelease}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('app.analysisRun.subtitle', { id: analysis.id, project: analysis.projectName ?? analysis.projectId })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RunActions detail={detail} onMessage={onMessage} />
          <Link
            href={projectHref}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t('app.analysisRun.backToWorkspace')}
          </Link>
        </div>
      </header>

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          data-testid="analysis-action-message"
          className={`rounded-lg border p-3 text-xs ${message.tone === 'error' ? 'border-destructive/30 bg-destructive/10 text-destructive' : 'border-primary/30 bg-primary/5 text-foreground'}`}
        >
          {message.text}
        </p>
      )}

      <Banners detail={detail} />

      <Section id="run-overview" title={t('app.analysisRun.sections.overview')} icon={Info}>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t('app.analysisRun.facts.status')}>
            <RunStatusBadge status={analysis.status} cancelRequested={cancelRequested} size="sm" />
          </Fact>
          <Fact label={t('app.analysisRun.facts.kind')}>{t(`app.analysisRun.kind.${analysis.kind}` as MessageKey)}</Fact>
          <Fact label={t('app.analysisRun.facts.triggeredBy')}>{who(analysis.triggeredBy)}</Fact>
          <Fact label={t('app.analysisRun.facts.findings')}>
            <span className="font-mono font-bold" data-testid="analysis-findings-count">
              {fmt.number(analysis.findingsCount)}
            </span>
          </Fact>
          <Fact label={t('app.analysisRun.facts.created')}>
            <time dateTime={analysis.createdAt}>{fmt.dateTime(analysis.createdAt)}</time>
          </Fact>
          <Fact label={t('app.analysisRun.facts.started')}>
            {analysis.startedAt ? <time dateTime={analysis.startedAt}>{fmt.dateTime(analysis.startedAt)}</time> : t('app.analysisRun.facts.notYet')}
          </Fact>
          <Fact label={t('app.analysisRun.facts.completed')}>
            {analysis.completedAt ? <time dateTime={analysis.completedAt}>{fmt.dateTime(analysis.completedAt)}</time> : t('app.analysisRun.facts.notYet')}
          </Fact>
          <Fact label={t('app.analysisRun.facts.duration')}>{duration(analysis.durationMs)}</Fact>
          <div className="sm:col-span-2 lg:col-span-4">
            <Fact label={t('app.analysisRun.facts.engines')}>
              <span className="flex flex-wrap gap-1">
                {analysis.engineTypes.map((e) => (
                  <span key={e} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]" translate="no">
                    {e}
                  </span>
                ))}
              </span>
            </Fact>
          </div>
          {analysis.problemStatement && (
            <div className="sm:col-span-2 lg:col-span-4">
              <Fact label={t('app.analysisRun.facts.problem')}>
                <span translate="no">{analysis.problemStatement}</span>
              </Fact>
            </div>
          )}
        </dl>
      </Section>

      <Section id="run-progress" title={t('app.analysisRun.sections.progress')} icon={Timer}>
        <AnalysisProgressStepper analysisId={analysis.id} onTerminal={onTerminal} />
      </Section>

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
        <InputsSection detail={detail} />
        <div className="min-w-0 space-y-6">
          <KnowledgeSection detail={detail} />
          <Section id="run-config" title={t('app.analysisRun.sections.configuration')} icon={Settings2}>
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{t('app.analysisRun.config.requested')}</p>
                <JsonBlock value={detail.inputs.requestedConfiguration} emptyText={t('app.analysisRun.config.empty')} />
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{t('app.analysisRun.config.effective')}</p>
                <JsonBlock value={detail.inputs.effectiveConfiguration} emptyText={t('app.analysisRun.config.empty')} />
              </div>
            </div>
          </Section>
        </div>
      </div>

      <OrchestrationSection detail={detail} />

      {isLab ? (
        <LabSection detail={detail} />
      ) : (
        <Section id="run-findings" title={t('app.analysisRun.sections.findings')} icon={AlertTriangle} testId="analysis-findings-section">
          <RunFindingsTable analysisId={analysis.id} status={analysis.status} />
        </Section>
      )}

      {!isLab && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <GeneratedTestsPanel projectId={analysis.projectId} analysisId={analysis.id} canPromote={detail.permissions.canRerun || detail.permissions.canCancel} />
        </div>
      )}

      <Section id="run-exports" title={t('app.analysisRun.sections.exports')} icon={FileDown} testId="analysis-exports">
        {detail.permissions.canExport ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('app.analysisRun.exports.intro')}</p>
            <ReportExportPanel projectId={analysis.projectId} analysisId={analysis.id} />
            <Link href={`/reports?projectId=${encodeURIComponent(analysis.projectId)}`} className="inline-flex text-xs font-semibold text-primary underline">
              {t('app.analysisRun.actions.reportsHub')}
            </Link>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{isLab ? t('app.analysisRun.findings.labNote') : t('app.analysisRun.exports.notAvailable')}</p>
        )}
      </Section>

      <Section id="run-lineage" title={t('app.analysisRun.sections.lineage')} icon={GitBranch}>
        <div className="space-y-2 text-xs">
          {detail.lineage.rerunOf && (
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-muted-foreground">{t('app.analysisRun.lineage.rerunOf')}</span>
              <Link href={analysisRunHref(analysis.projectId, detail.lineage.rerunOf.id)} className="font-mono font-semibold text-primary underline" data-testid="analysis-lineage-parent">
                {detail.lineage.rerunOf.id.slice(0, 8)}
              </Link>
              <RunStatusBadge status={detail.lineage.rerunOf.status} size="sm" />
            </p>
          )}
          {detail.lineage.reruns.length === 0 ? (
            <p className="text-muted-foreground">{t('app.analysisRun.lineage.none')}</p>
          ) : (
            <div>
              <p className="mb-1 font-semibold text-muted-foreground">{t('app.analysisRun.lineage.reruns')}</p>
              <ul className="space-y-1">
                {detail.lineage.reruns.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Link href={analysisRunHref(analysis.projectId, r.id)} className="font-mono font-semibold text-primary underline">
                      {r.id.slice(0, 8)}
                    </Link>
                    <RunStatusBadge status={r.status} size="sm" />
                    <time dateTime={r.createdAt} className="text-muted-foreground">
                      {fmt.dateTime(r.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Banners({ detail }: { detail: AnalysisDetail }) {
  const t = useT();
  const fmt = useFmt();
  const { analysis, cancellation, lineage, knowledgeSnapshot, inputs } = detail;
  const items: React.ReactNode[] = [];
  if (cancellation?.requestedAt && analysis.status !== 'CANCELLED') {
    items.push(
      <div key="req" role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
        <Ban className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{t('app.analysisRun.banner.cancelRequested', { when: fmt.relative(cancellation.requestedAt) })}</span>
      </div>
    );
  }
  if (analysis.status === 'CANCELLED' && cancellation) {
    const by = cancellation.requestedBy
      ? t('app.analysisRun.banner.cancelledBy', { name: cancellation.requestedBy.name || cancellation.requestedBy.email || cancellation.requestedBy.id.slice(0, 8) })
      : '';
    items.push(
      <div key="cancelled" data-testid="analysis-cancelled-banner" className="flex items-start gap-2 rounded-lg border border-slate-300 bg-slate-50 p-3 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
        <Ban className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="font-semibold">{t('app.analysisRun.banner.cancelled', { when: fmt.dateTime(cancellation.cancelledAt ?? cancellation.requestedAt), by })}</p>
          {cancellation.reason && <p className="break-words">{t('app.analysisRun.banner.cancelReason', { reason: cancellation.reason })}</p>}
          {cancellation.discardedFindings !== null && <p>{t('app.analysisRun.banner.discarded', { count: cancellation.discardedFindings })}</p>}
        </div>
      </div>
    );
  }
  if (analysis.status === 'FAILED') {
    items.push(
      <div key="failed" role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 space-y-0.5">
          <p className="font-semibold">{t('app.analysisRun.banner.failed')}</p>
          {analysis.errorMessage && <p className="break-words font-mono">{t('app.analysisRun.banner.errorDetail', { message: analysis.errorMessage })}</p>}
        </div>
      </div>
    );
  }
  if (lineage.rerunOf) {
    items.push(
      <p key="rerun" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
        <GitBranch className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span>{t('app.analysisRun.banner.rerunOf')}</span>
        <Link href={analysisRunHref(analysis.projectId, lineage.rerunOf.id)} data-testid="analysis-rerun-of" className="font-mono font-semibold text-primary underline">
          {lineage.rerunOf.id.slice(0, 8)}
        </Link>
      </p>
    );
  }
  if (knowledgeSnapshot?.superseded) {
    items.push(
      <p key="snap" className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Database className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        {t('app.analysisRun.banner.newerSnapshot')}
      </p>
    );
  }
  if (!inputs.recorded && inputs.files.length > 0) {
    items.push(
      <p key="legacy" className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t('app.analysisRun.banner.legacyInputs')}
      </p>
    );
  }
  if (items.length === 0) return null;
  return <div className="space-y-2">{items}</div>;
}

function InputsSection({ detail }: { detail: AnalysisDetail }) {
  const t = useT();
  const fmt = useFmt();
  const { inputs } = detail;
  return (
    <Section id="run-inputs" title={t('app.analysisRun.sections.inputs')} icon={FileSearch} testId="analysis-inputs">
      <p className="mb-2 text-xs text-muted-foreground">
        {t('app.analysisRun.inputs.assignment', { mode: t(`app.analysisRun.inputs.assignmentMode.${inputs.assignmentMode}` as MessageKey) })}
        {inputs.testCaseIds.length > 0 && <> · {t('app.analysisRun.inputs.testCases', { count: inputs.testCaseIds.length })}</>}
      </p>
      {inputs.files.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('app.analysisRun.inputs.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-xs">
            <caption className="sr-only">{t('app.analysisRun.inputs.caption')}</caption>
            <thead className="border-b border-border text-[11px] uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.inputs.file')}</th>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.inputs.type')}</th>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.inputs.sha')}</th>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.inputs.size')}</th>
                <th scope="col" className="py-1.5">{t('app.analysisRun.inputs.current')}</th>
              </tr>
            </thead>
            <tbody>
              {inputs.files.map((f) => (
                <tr key={f.fileId} className="border-b border-border last:border-0" data-testid="analysis-input-row">
                  <td className="max-w-[200px] truncate py-1.5 pr-3 font-medium text-foreground" title={f.fileName} translate="no">
                    {f.fileName || f.fileId.slice(0, 8)}
                  </td>
                  <td className="py-1.5 pr-3 font-mono" translate="no">
                    {f.artifactType || t('app.analysisRun.notAvailable')}
                  </td>
                  <td className="py-1.5 pr-3">
                    {f.sha256 ? (
                      <span className="inline-flex items-center gap-1">
                        <code className="font-mono text-[11px]" title={f.sha256} data-testid="analysis-input-sha">
                          {f.sha256.slice(0, 16)}…
                        </code>
                        <CopyHash value={f.sha256} name={f.fileName || f.fileId} />
                      </span>
                    ) : (
                      t('app.analysisRun.notAvailable')
                    )}
                  </td>
                  <td className="py-1.5 pr-3">{f.sizeBytes === null ? t('app.analysisRun.notAvailable') : fmt.bytes(f.sizeBytes)}</td>
                  <td className="py-1.5">
                    {f.currentStatus === null ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {t('app.analysisRun.inputs.deleted')}
                      </span>
                    ) : f.changed ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {t('app.analysisRun.inputs.changed')}
                      </span>
                    ) : (
                      <span className="font-mono" translate="no">
                        {f.currentStatus}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function KnowledgeSection({ detail }: { detail: AnalysisDetail }) {
  const t = useT();
  const fmt = useFmt();
  const k = detail.knowledgeSnapshot;
  return (
    <Section id="run-knowledge" title={t('app.analysisRun.sections.knowledge')} icon={Database} testId="analysis-knowledge">
      {!k ? (
        <p className="text-xs text-muted-foreground">{t('app.analysisRun.knowledge.none')}</p>
      ) : (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label={t('app.analysisRun.knowledge.id')}>
            <code className="break-all font-mono text-xs" translate="no">
              {k.id}
            </code>
          </Fact>
          <Fact label={t('app.analysisRun.knowledge.seq')}>
            <span className="font-mono">{k.seq ?? t('app.analysisRun.notAvailable')}</span>{' '}
            <span className="text-xs text-muted-foreground">
              ({k.superseded ? t('app.analysisRun.knowledge.superseded') : t('app.analysisRun.knowledge.current')})
            </span>
          </Fact>
          <Fact label={t('app.analysisRun.knowledge.adapter')}>
            <span className="font-mono text-xs" translate="no">
              {k.adapterId ?? t('app.analysisRun.notAvailable')}
            </span>
          </Fact>
          <Fact label={t('app.analysisRun.knowledge.published')}>{k.publishedAt ? fmt.dateTime(k.publishedAt) : t('app.analysisRun.notAvailable')}</Fact>
          {k.contentSha256 && (
            <div className="sm:col-span-2">
              <Fact label={t('app.analysisRun.knowledge.hash')}>
                <code className="break-all font-mono text-xs" translate="no">
                  {k.contentSha256}
                </code>
              </Fact>
            </div>
          )}
        </dl>
      )}
    </Section>
  );
}

function OrchestrationSection({ detail }: { detail: AnalysisDetail }) {
  const t = useT();
  const fmt = useFmt();
  const duration = useDuration();
  const tel = detail.telemetry;
  const tiles: Array<[string, string]> = [
    [t('app.analysisRun.telemetry.calls'), fmt.number(tel.engineCalls)],
    [t('app.analysisRun.telemetry.completed'), fmt.number(tel.completedCalls)],
    [t('app.analysisRun.telemetry.partial'), fmt.number(tel.partialCalls)],
    [t('app.analysisRun.telemetry.failed'), fmt.number(tel.failedCalls)],
    [t('app.analysisRun.telemetry.rules'), fmt.number(tel.rulesEvaluated)],
    [t('app.analysisRun.telemetry.engineTime'), duration(tel.totalEngineMs)],
    [t('app.analysisRun.facts.queueWait'), duration(tel.queueWaitMs)],
  ];
  return (
    <Section id="run-orchestration" title={t('app.analysisRun.sections.orchestration')} icon={Cpu} testId="analysis-orchestration">
      <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label={t('app.analysisRun.sections.telemetry')}>
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border p-2">
            <dt className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</dt>
            <dd className="font-mono text-sm font-bold text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {detail.inputs.stages.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
            <ListTree className="size-3.5" aria-hidden="true" />
            {t('app.analysisRun.calls.stages')}
          </p>
          <ol className="flex flex-wrap gap-2 text-[10px]">
            {detail.inputs.stages.map((stage, i) => (
              <li key={i} className="rounded border border-border px-2 py-1">
                <span className="font-semibold">{t('app.analysisRun.calls.stage', { n: i + 1 })}</span>{' '}
                <span className="font-mono" translate="no">
                  {stage.join(', ')}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {detail.calls.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {detail.analysis.status === 'CANCELLED' ? t('app.analysisRun.calls.emptyCancelled') : t('app.analysisRun.calls.empty')}
        </p>
      ) : (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full min-w-[720px] text-left text-xs">
            <caption className="sr-only">{t('app.analysisRun.calls.caption')}</caption>
            <thead className="sticky top-0 border-b border-border bg-card text-[11px] uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.calls.engine')}</th>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.calls.artifact')}</th>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.calls.outcome')}</th>
                <th scope="col" className="py-1.5 pr-3 text-right">{t('app.analysisRun.calls.findings')}</th>
                <th scope="col" className="py-1.5 pr-3 text-right">{t('app.analysisRun.calls.rules')}</th>
                <th scope="col" className="py-1.5 pr-3 text-right">{t('app.analysisRun.calls.duration')}</th>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.calls.version')}</th>
                <th scope="col" className="py-1.5">{t('app.analysisRun.calls.error')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.calls.map((c, i) => (
                <tr key={`${c.engine}-${c.fileId}-${i}`} className="border-b border-border last:border-0 align-top" data-testid="analysis-call-row">
                  <td className="py-1.5 pr-3 font-mono" translate="no">
                    {c.engine}
                  </td>
                  <td className="max-w-[180px] truncate py-1.5 pr-3" title={c.fileName ?? ''} translate="no">
                    {c.fileName ?? t('app.analysisRun.notAvailable')}
                  </td>
                  <td className="py-1.5 pr-3">
                    <CallOutcome outcome={c.outcome} />
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono">{fmt.number(c.findings ?? 0)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{fmt.number(c.rulesEvaluated ?? 0)}</td>
                  <td className="py-1.5 pr-3 text-right font-mono">{duration(c.durationMs ?? null)}</td>
                  <td className="py-1.5 pr-3 font-mono" translate="no">
                    {c.engineVersion ?? t('app.analysisRun.notAvailable')}
                  </td>
                  <td className="max-w-[260px] break-words py-1.5 text-muted-foreground" translate="no">
                    {c.error ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function LabSection({ detail }: { detail: AnalysisDetail }) {
  const t = useT();
  const duration = useDuration();
  const lab = detail.lab;
  return (
    <Section id="run-lab" title={t('app.analysisRun.sections.labResults')} icon={FlaskConical} testId="analysis-lab-results">
      <p className="mb-2 text-xs text-muted-foreground">{t('app.analysisRun.findings.labNote')}</p>
      {lab && (
        <p className="mb-2 text-xs font-semibold text-foreground" data-testid="analysis-lab-summary">
          {t('app.analysisRun.lab.summary', { total: lab.total, passed: lab.passed, failed: lab.failed, errored: lab.errored })}
        </p>
      )}
      {lab?.scenario && (
        <p className="mb-2 break-words text-xs text-muted-foreground">
          {t('app.analysisRun.lab.scenario', {
            domain: lab.scenario.domain,
            verdict: lab.scenario.verdict,
            passed: lab.scenario.passedAssertions,
            assertions: lab.scenario.assertions,
            sha: lab.scenario.payloadSha256.slice(0, 12),
          })}
        </p>
      )}
      {detail.labResults.length === 0 ? (
        !lab?.scenario && <p className="text-xs text-muted-foreground">{t('app.analysisRun.lab.none')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <caption className="sr-only">{t('app.analysisRun.lab.caption')}</caption>
            <thead className="border-b border-border text-[11px] uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.lab.test')}</th>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.lab.engineRule')}</th>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.lab.expected')}</th>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.lab.result')}</th>
                <th scope="col" className="py-1.5 pr-3">{t('app.analysisRun.lab.fixture')}</th>
                <th scope="col" className="py-1.5">{t('app.analysisRun.lab.time')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.labResults.map((r) => (
                <tr key={r.runId} className="border-b border-border last:border-0 align-top" data-testid="analysis-lab-row">
                  <td className="max-w-[240px] break-words py-1.5 pr-3 font-medium text-foreground" translate="no">
                    {r.title}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-[11px]" translate="no">
                    {r.engine} / {r.ruleId}
                  </td>
                  <td className="py-1.5 pr-3">{t(`app.analysisRun.lab.expectedOutcome.${r.expectedOutcome}` as MessageKey)}</td>
                  <td className="py-1.5 pr-3">
                    <LabVerdict status={r.status} />
                    {r.findingPresent !== null && (
                      <span className="block text-[11px] text-muted-foreground">
                        {r.findingPresent ? t('app.analysisRun.lab.present') : t('app.analysisRun.lab.absent')}
                      </span>
                    )}
                    {r.errorMessage && <span className="block break-words text-[11px] text-destructive">{r.errorMessage}</span>}
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-[11px]" title={r.artifactSha256 ?? ''}>
                    {r.artifactSha256 ? `${r.artifactSha256.slice(0, 12)}…` : t('app.analysisRun.notAvailable')}
                  </td>
                  <td className="py-1.5 font-mono">{duration(r.executionTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Link href={`/projects/${encodeURIComponent(detail.analysis.projectId)}/lab`} className="mt-3 inline-flex text-xs font-semibold text-primary underline">
        {t('app.analysisRun.actions.openTestLab')}
      </Link>
    </Section>
  );
}
