'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AlertTriangle,
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileCode2,
  FlaskConical,
  Loader2,
  Play,
  PlayCircle,
  XCircle,
} from 'lucide-react';
import { ScheduleRegressionTestsSchema, type FindingStatus } from '@erppreflight/schemas';
import { useFormatter, useT } from '@/i18n/client';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect } from '@/components/form/form-inputs';
import { ErrorState, SkeletonBlock, useCommercialErrorText } from '@/components/commercial/states';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { queryKeys } from '@/lib/query/query-keys';
import {
  archiveRegressionTest,
  batchRunRegressionTests,
  cancelRegressionSchedule,
  createRegressionSchedule,
  exportRegressionFixture,
  fetchCleanProjectArtifacts,
  fetchRegressionSchedules,
  fetchRegressionTest,
  fetchRegressionTests,
  findingLifecycleKeys,
  runRegressionTest,
  updateRegressionFixture,
  type RegressionRun,
  type RegressionTest,
} from '@/lib/api/findings-lifecycle';
import { FindingStatusBadge } from './finding-status-badge';

type RunStatus = 'PASSED' | 'FAILED' | 'ERROR';

/** Run verdict: icon + text, never colour alone. */
export function RunStatusBadge({ status }: { status: RunStatus | string | null | undefined }) {
  const t = useT();
  if (!status) return <span className="text-xs text-muted-foreground">{t('findingLifecycle.lab.neverRun')}</span>;
  const s = status as RunStatus;
  const Icon = s === 'PASSED' ? CheckCircle2 : s === 'FAILED' ? XCircle : AlertTriangle;
  const cls =
    s === 'PASSED'
      ? 'border-emerald-400 text-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800'
      : s === 'FAILED'
      ? 'border-red-400 text-red-800 bg-red-50 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800'
      : 'border-amber-400 text-amber-900 bg-amber-50 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800';
  return (
    <span role="status" data-run-status={s} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      <Icon className="size-3" aria-hidden="true" />
      {t(`findingLifecycle.lab.runStatus.${s}`)}
    </span>
  );
}

function useFmt() {
  const format = useFormatter();
  return (iso: string | null | undefined) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function RegressionTestsPanel({ projectId }: { projectId: string }) {
  // Localized API error text (codes → EN/DE dictionary).
  const errorMessage = useCommercialErrorText();
  const t = useT();
  const queryClient = useQueryClient();
  const tests = useQuery({
    queryKey: findingLifecycleKeys.regressionTests(projectId),
    queryFn: () => fetchRegressionTests(projectId),
    enabled: Boolean(projectId),
    retry: 1,
  });
  const batch = useMutation({
    mutationFn: () => batchRunRegressionTests(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: findingLifecycleKeys.regressionTests(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.findings.all });
    },
  });
  const active = (tests.data ?? []).filter((x) => x.status === 'ACTIVE');

  return (
    <section aria-labelledby="regression-tests-heading" className="rounded-xl border border-border bg-card p-5 space-y-4" data-testid="regression-tests-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="regression-tests-heading" className="flex items-center gap-2 text-base font-bold text-foreground">
            <FlaskConical className="size-5 text-primary" aria-hidden="true" />
            {t('findingLifecycle.lab.heading')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('findingLifecycle.lab.intro')}</p>
        </div>
        <button
          type="button"
          disabled={active.length === 0 || batch.isPending}
          onClick={() => batch.mutate()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {batch.isPending ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <PlayCircle className="size-3.5" aria-hidden="true" />}
          {batch.isPending ? t('findingLifecycle.lab.running') : t('findingLifecycle.lab.runAll')}
        </button>
      </div>
      {batch.isSuccess && (
        <p role="status" className="text-xs text-foreground">
          {t('findingLifecycle.lab.batchResult', { passed: batch.data.passed, failed: batch.data.failed, errored: batch.data.errored })}
        </p>
      )}
      {batch.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(batch.error)}</p>}

      {tests.isLoading ? (
        <div className="space-y-2" role="status" aria-label={t('findingLifecycle.lab.loading')}>
          <SkeletonBlock className="h-16 w-full" />
          <SkeletonBlock className="h-16 w-full" />
        </div>
      ) : tests.isError ? (
        <ErrorState title={t('findingLifecycle.lab.error')} error={tests.error} onRetry={() => tests.refetch()} />
      ) : (tests.data ?? []).length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{t('findingLifecycle.lab.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {(tests.data ?? []).map((test) => (
            <RegressionTestItem key={test.id} test={test} projectId={projectId} />
          ))}
        </ul>
      )}

      <SchedulesSection projectId={projectId} />
    </section>
  );
}

function RegressionTestItem({ test, projectId }: { test: RegressionTest; projectId: string }) {
  // Localized API error text (codes → EN/DE dictionary).
  const errorMessage = useCommercialErrorText();
  const t = useT();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = React.useState(false);
  const [fixtureFileId, setFixtureFileId] = React.useState('');
  const [lastRun, setLastRun] = React.useState<RegressionRun | null>(null);
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: findingLifecycleKeys.regressionTests(projectId) });
    queryClient.invalidateQueries({ queryKey: findingLifecycleKeys.regressionTest(test.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.findings.all });
    queryClient.invalidateQueries({ queryKey: findingLifecycleKeys.all });
  };
  const detail = useQuery({
    queryKey: findingLifecycleKeys.regressionTest(test.id),
    queryFn: () => fetchRegressionTest(test.id),
    enabled: expanded,
  });
  const files = useQuery({
    queryKey: findingLifecycleKeys.projectFiles(projectId),
    queryFn: () => fetchCleanProjectArtifacts(projectId),
    enabled: expanded,
    staleTime: 30_000,
  });
  const run = useMutation({
    mutationFn: () => runRegressionTest(test.id),
    onSuccess: (r) => {
      setLastRun(r);
      invalidate();
    },
  });
  const fixture = useMutation({
    mutationFn: () => updateRegressionFixture(test.id, fixtureFileId),
    onSuccess: () => {
      setFixtureFileId('');
      invalidate();
    },
  });
  const archive = useMutation({ mutationFn: () => archiveRegressionTest(test.id), onSuccess: invalidate });
  const exporter = useMutation({
    mutationFn: () => exportRegressionFixture(test.id),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `regression-fixture-${test.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const isActive = test.status === 'ACTIVE';

  return (
    <li className="rounded-lg border border-border bg-background p-3 text-xs space-y-2" data-regression-test-id={test.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-foreground">{test.title}</p>
          <p className="font-mono text-[11px] text-muted-foreground">
            {t('findingLifecycle.lab.engineRule', { engine: test.engine, rule: test.ruleId })} · {test.testType} ·{' '}
            {t('findingLifecycle.lab.targetRelease', { release: test.targetRelease })} · {t('findingLifecycle.lab.fixture', { version: test.fixtureVersion })}
          </p>
          <p className="text-[11px] text-foreground">
            {t('findingLifecycle.lab.expected')}: {t(`findingLifecycle.tests.${test.expectedOutcome}`)}
            {test.artifact.name && (
              <span className="ml-2 inline-flex items-center gap-1 font-mono text-muted-foreground">
                <FileCode2 className="size-3" aria-hidden="true" />
                {test.artifact.name}
              </span>
            )}
          </p>
          {!test.artifact.available && isActive && (
            <p role="alert" className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
              {t('findingLifecycle.lab.artifactMissing')}
            </p>
          )}
          {test.findingStatus && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {t('findingLifecycle.lab.sourceFinding')}:
              <FindingStatusBadge status={test.findingStatus as FindingStatus} size="sm" />
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">{t('findingLifecycle.lab.lastRun')}:</span>
            <RunStatusBadge status={test.lastRun?.status} />
          </div>
          {test.lastRun?.at && <span className="text-[10px] text-muted-foreground">{fmt(test.lastRun.at)}</span>}
          {!isActive && <span className="text-[10px] font-semibold text-muted-foreground">{t('findingLifecycle.lab.archived')}</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {isActive && (
          <button
            type="button"
            disabled={run.isPending}
            onClick={() => run.mutate()}
            data-action="run-regression-test"
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {run.isPending ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play className="size-3" aria-hidden="true" />}
            {run.isPending ? t('findingLifecycle.lab.running') : t('findingLifecycle.lab.run')}
          </button>
        )}
        <button
          type="button"
          disabled={exporter.isPending}
          onClick={() => exporter.mutate()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
        >
          <Download className="size-3" aria-hidden="true" />
          {t('findingLifecycle.lab.exportFixture')}
        </button>
        {isActive && (
          <button
            type="button"
            disabled={archive.isPending}
            onClick={() => archive.mutate()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
          >
            <Archive className="size-3" aria-hidden="true" />
            {t('findingLifecycle.lab.archive')}
          </button>
        )}
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {expanded ? <ChevronUp className="size-3" aria-hidden="true" /> : <ChevronDown className="size-3" aria-hidden="true" />}
          {t('findingLifecycle.lab.runs')}
        </button>
      </div>

      {lastRun && <RunSummary run={lastRun} />}
      {(run.isError || fixture.isError || archive.isError || exporter.isError) && (
        <p role="alert" className="text-[11px] text-destructive">
          {errorMessage(run.error ?? fixture.error ?? archive.error ?? exporter.error)}
        </p>
      )}

      {expanded && (
        <div className="space-y-3 border-t border-border pt-2">
          {test.preconditions.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-foreground">{t('findingLifecycle.lab.preconditions')}</p>
              <ul className="ml-4 list-disc text-[11px] text-muted-foreground">
                {test.preconditions.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {test.matchObjects.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t('findingLifecycle.lab.matchObjects')}: <span className="font-mono text-foreground">{test.matchObjects.join(', ')}</span>
            </p>
          )}
          {isActive && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <FormField id={`fixture-${test.id}`} label={t('findingLifecycle.lab.updateFixture')} description={t('findingLifecycle.lab.updateFixtureHint')}>
                  <FormSelect
                    value={fixtureFileId}
                    onChange={(e) => setFixtureFileId(e.target.value)}
                    disabled={files.isLoading}
                    options={[
                      { value: '', label: t('findingLifecycle.attachments.choose') },
                      ...(files.data ?? [])
                        .filter((f) => f.id !== test.artifact.fileId)
                        .map((f) => ({ value: f.id, label: f.fileName })),
                    ]}
                  />
                </FormField>
              </div>
              <button
                type="button"
                disabled={!fixtureFileId || fixture.isPending}
                onClick={() => fixture.mutate()}
                data-action="update-fixture"
                className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-[11px] font-semibold hover:bg-muted disabled:opacity-50"
              >
                {t('findingLifecycle.lab.saveFixture')}
              </button>
            </div>
          )}
          {detail.isLoading ? (
            <SkeletonBlock className="h-12 w-full" />
          ) : detail.isError ? (
            <ErrorState title={t('findingLifecycle.lab.error')} error={detail.error} onRetry={() => detail.refetch()} />
          ) : (
            <ol className="space-y-1.5">
              {(detail.data?.runs ?? []).map((r) => (
                <li key={r.id} className="rounded-md border border-border/70 p-2">
                  <RunSummary run={r} isBaseline={r.id === detail.data?.baselineRunId} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </li>
  );
}

function RunSummary({ run, isBaseline }: { run: RegressionRun; isBaseline?: boolean }) {
  const t = useT();
  const fmt = useFmt();
  return (
    <div className="space-y-1 text-[11px]" data-run-id={run.id}>
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={run.status} />
        <span className="text-foreground">
          {run.findingPresent === null ? '—' : run.findingPresent ? t('findingLifecycle.lab.findingPresent') : t('findingLifecycle.lab.findingAbsent')}
        </span>
        <span className="text-muted-foreground">
          {t('findingLifecycle.lab.fixture', { version: run.fixtureVersion })} · {t(`findingLifecycle.lab.trigger.${run.trigger}`)} · {fmt(run.completedAt ?? run.startedAt)}
          {run.engineVersion && ` · v${run.engineVersion}`}
        </span>
        {(isBaseline || run.isBaseline) && (
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-foreground">{t('findingLifecycle.lab.baseline')}</span>
        )}
        {run.baselineComparison && (
          <span className="text-muted-foreground">
            {t('findingLifecycle.lab.baselineVerdict', { verdict: t(`findingLifecycle.lab.verdicts.${run.baselineComparison.verdict}`) })}
          </span>
        )}
      </div>
      {run.errorMessage && <p className="text-destructive break-words">{run.errorMessage}</p>}
      {run.findingResolved && (
        <p role="status" className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-3" aria-hidden="true" />
          {t('findingLifecycle.lab.resolvedNotice')}
        </p>
      )}
      {run.matchedFindings.length > 0 && (
        <ul className="ml-4 list-disc text-muted-foreground">
          {run.matchedFindings.map((f, i) => (
            <li key={i} className="font-mono">
              {f.ruleId} {f.affectedObjects.join(', ')}
              {f.evidence?.lineNumber != null && ` @ ${f.evidence.artifactPath ?? ''}:${f.evidence.lineNumber}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- schedules

function ScheduleGuard({ dirty, submitting }: { dirty: boolean; submitting: boolean }) {
  useUnsavedChangesGuard({ isDirty: dirty, isSubmitting: submitting });
  return null;
}

function SchedulesSection({ projectId }: { projectId: string }) {
  // Localized API error text (codes → EN/DE dictionary).
  const errorMessage = useCommercialErrorText();
  const t = useT();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const schedules = useQuery({
    queryKey: findingLifecycleKeys.regressionSchedules(projectId),
    queryFn: () => fetchRegressionSchedules(projectId),
    enabled: Boolean(projectId),
    retry: 1,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: findingLifecycleKeys.regressionSchedules(projectId) });
  const create = useMutation({
    mutationFn: (cronExpression: string) => createRegressionSchedule({ projectId, cronExpression }),
    onSuccess: () => {
      invalidate();
      form.reset();
    },
  });
  const cancel = useMutation({ mutationFn: cancelRegressionSchedule, onSuccess: invalidate });
  const form = useForm({
    defaultValues: { cronExpression: '0 2 * * *' },
    validators: {
      onChange: z.object({
        cronExpression: z
          .string()
          .refine((c) => ScheduleRegressionTestsSchema.safeParse({ projectId, cronExpression: c }).success, t('findingLifecycle.lab.cronInvalid')),
      }),
    },
    onSubmit: async ({ value }) => {
      await create.mutateAsync(value.cronExpression.trim());
    },
  });
  const active = (schedules.data ?? []).filter((s) => s.status === 'ACTIVE');

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="flex items-center gap-1.5 text-xs font-bold text-foreground">
        <CalendarClock className="size-4 text-primary" aria-hidden="true" />
        {t('findingLifecycle.lab.schedules')}
      </h3>
      {schedules.isError ? (
        <ErrorState title={t('findingLifecycle.lab.error')} error={schedules.error} onRetry={() => schedules.refetch()} />
      ) : active.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t('findingLifecycle.lab.scheduleNone')}</p>
      ) : (
        <ul className="space-y-1 text-[11px]">
          {active.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2">
              <span className="font-mono text-foreground">
                {s.cronExpression}
                {s.lastRunAt && <span className="ml-2 font-sans text-muted-foreground">{t('findingLifecycle.lab.scheduleLast', { date: fmt(s.lastRunAt) })}</span>}
              </span>
              <button
                type="button"
                onClick={() => cancel.mutate(s.id)}
                disabled={cancel.isPending}
                className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-muted disabled:opacity-50"
              >
                {t('findingLifecycle.lab.scheduleCancel')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form.Subscribe
        selector={(s) => ({ dirty: s.isDirty, submitting: s.isSubmitting, canSubmit: s.canSubmit })}
        children={({ dirty, submitting, canSubmit }) => (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <ScheduleGuard dirty={dirty} submitting={submitting} />
            <form.Field
              name="cronExpression"
              children={(field) => (
                <FormField
                  id="regression-cron"
                  name={field.name}
                  label={t('findingLifecycle.lab.scheduleCron')}
                  description={t('findingLifecycle.lab.scheduleCronHint')}
                  error={field.state.meta.errors as never}
                  className="min-w-[240px] flex-1"
                >
                  <FormInput isMono value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )}
            />
            <button
              type="submit"
              disabled={!canSubmit || submitting}
              className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              {submitting && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {t('findingLifecycle.lab.scheduleAdd')}
            </button>
          </form>
        )}
      />
      {(create.isError || cancel.isError) && (
        <p role="alert" className="text-[11px] text-destructive">
          {errorMessage(create.error ?? cancel.error)}
        </p>
      )}
    </div>
  );
}
