'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BellRing, CheckCircle2, Clock, Database, RotateCw, ShieldAlert, XCircle } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { ErrorState, Notice, SkeletonBlock, useCommercialErrorText } from '@/components/commercial/states';
import { useFmt, useLabel, useT } from '@/i18n/client';
import {
  SourceSettingsFormSchema,
  fetchSourceRuns,
  fetchSourcesOverview,
  retrySource,
  runFreshnessCheck,
  saveSourceSettings,
  sourceKeys,
  type SourceAdapter,
  type SourceAlert,
  type SourceSettingsForm,
} from '@/lib/api/governance';
import { FormGuard, GovernanceHeader, Pill, btn, btnPrimary, card, td, th } from './shared';

function FreshnessPill({ state }: { state: SourceAdapter['freshness'] }) {
  const t = useT();
  if (state === 'FRESH') return <Pill tone="good" icon={CheckCircle2}>{t('app.governance.sources.freshness.FRESH')}</Pill>;
  if (state === 'STALE') return <Pill tone="bad" icon={Clock}>{t('app.governance.sources.freshness.STALE')}</Pill>;
  return <Pill tone="warn" icon={AlertTriangle}>{t('app.governance.sources.freshness.NEVER_SYNCED')}</Pill>;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function SourceAdmin() {
  const t = useT();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: sourceKeys.overview, queryFn: fetchSourcesOverview });
  const check = useMutation({
    mutationFn: runFreshnessCheck,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sourceKeys.overview }),
  });
  const errText = useCommercialErrorText();
  const d = q.data;
  return (
    <div className="space-y-6" data-testid="source-admin">
      <GovernanceHeader
        title={t('app.governance.sources.title')}
        intro={t('app.governance.sources.intro')}
        onRefresh={() => q.refetch()}
        refreshing={q.isFetching}
        actions={
          <button type="button" className={btnPrimary} onClick={() => check.mutate()} disabled={check.isPending} data-testid="freshness-check">
            <BellRing className="size-3.5" aria-hidden="true" /> {check.isPending ? t('app.governance.sources.checking') : t('app.governance.sources.checkNow')}
          </button>
        }
      />
      {check.isSuccess && (
        <p role="status" className="text-sm">
          {t('app.governance.sources.checkResult', { opened: check.data.opened.length, resolved: check.data.resolved.length })}
        </p>
      )}
      {check.isError && <p role="alert" className="text-sm text-destructive">{errText(check.error)}</p>}
      {q.isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label={t('app.governance.common.loading')}>
          <SkeletonBlock className="h-56" />
          <SkeletonBlock className="h-56" />
        </div>
      ) : q.isError ? (
        <ErrorState title={t('app.governance.sources.loadFailed')} error={q.error} onRetry={() => q.refetch()} />
      ) : d ? (
        <>
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="size-4" aria-hidden="true" /> {t('app.governance.sources.objects', d.knowledgeObjects)}
          </p>
          {d.adapters.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('app.governance.sources.empty')}</p>
          ) : (
            d.adapters.map((a) => <AdapterCard key={a.adapterId} adapter={a} />)
          )}
          <AlertsPanel alerts={d.alerts} />
        </>
      ) : null}
    </div>
  );
}

function AdapterCard({ adapter: a }: { adapter: SourceAdapter }) {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useCommercialErrorText();
  const queryClient = useQueryClient();
  const [showRuns, setShowRuns] = React.useState(false);
  const retry = useMutation({
    mutationFn: () => retrySource(a.adapterId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sourceKeys.overview });
      queryClient.invalidateQueries({ queryKey: sourceKeys.runs(a.adapterId) });
    },
  });
  const changes = a.latestSnapshot?.changes ?? {};
  return (
    <article className={`${card} space-y-4`} data-adapter={a.adapterId} aria-labelledby={`src-${a.adapterId}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={`src-${a.adapterId}`} className="text-lg font-bold">{a.title}</h2>
          <p className="font-mono text-xs text-muted-foreground">{a.adapterId}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <FreshnessPill state={a.freshness} />
          {a.settings.critical ? (
            <Pill tone="info" icon={ShieldAlert}>{t('app.governance.sources.critical')}</Pill>
          ) : (
            <Pill tone="neutral" icon={ShieldAlert}>{t('app.governance.sources.notCritical')}</Pill>
          )}
          {a.openAlert && <Pill tone="bad" icon={BellRing}>{t('app.governance.sources.alerts.open')}</Pill>}
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t('app.governance.sources.lastRun')}</dt>
          <dd>
            {a.lastRun
              ? t('app.governance.sources.lastRunValue', {
                  status: label('app.governance.sources.runStatusValues', a.lastRun.status),
                  trigger: a.lastRun.trigger,
                  date: a.lastRun.startedAt ? fmt.dateTime(a.lastRun.startedAt) : '—',
                })
              : t('app.governance.sources.noRuns')}
          </dd>
          <dd className="text-xs text-muted-foreground">
            {a.ageHours !== null && t('app.governance.sources.age', { age: t('app.governance.sources.ageHours', { hours: fmt.number(a.ageHours) }) })}
            {a.ageHours !== null && ' · '}
            {t('app.governance.sources.threshold', { hours: a.settings.freshnessThresholdHours })}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('app.governance.sources.errors')}</dt>
          <dd className="inline-flex items-center gap-1">
            {a.errors.failedLast30Days > 0 ? <XCircle className="size-3.5" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" />}
            {t('app.governance.sources.errorsValue', { count: a.errors.failedLast30Days })}
          </dd>
          {a.lastRun?.error && (
            <dd className="text-xs text-destructive break-words">
              {t('app.governance.sources.lastError')}: {a.lastRun.error}
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('app.governance.sources.items')}</dt>
          <dd>{t('app.governance.sources.itemsValue', { records: fmt.number(a.items.records), documents: a.items.documents, rejected: fmt.number(a.items.rejected) })}</dd>
          <dt className="mt-2 text-xs text-muted-foreground">{t('app.governance.sources.changes')}</dt>
          <dd>
            {a.latestSnapshot
              ? t('app.governance.sources.changesValue', {
                  added: fmt.number(num(changes.statesAdded)),
                  changed: fmt.number(num(changes.statesChanged)),
                  removed: fmt.number(num(changes.statesRemoved)),
                  created: fmt.number(num(changes.objectsCreated)),
                })
              : t('app.governance.sources.noChanges')}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        {a.retriable ? (
          <button type="button" className={btnPrimary} onClick={() => retry.mutate()} disabled={retry.isPending} data-testid={`retry-${a.adapterId}`}>
            <RotateCw className="size-3.5" aria-hidden="true" /> {retry.isPending ? t('app.governance.sources.retrying') : t('app.governance.sources.retry')}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">{t('app.governance.sources.notRetriable')}</span>
        )}
        <button type="button" className={btn} aria-expanded={showRuns} onClick={() => setShowRuns((v) => !v)}>
          {showRuns ? t('app.governance.sources.hideRuns') : t('app.governance.sources.showRuns')}
        </button>
      </div>
      {retry.isSuccess && <p role="status" className="text-xs">{t('app.governance.sources.retryQueued', { job: retry.data.jobId ?? '—' })}</p>}
      {retry.isError && <p role="alert" className="text-xs text-destructive">{errText(retry.error)}</p>}
      {showRuns && <RunsTable adapter={a} />}
      <SettingsForm adapter={a} />
    </article>
  );
}

function RunsTable({ adapter }: { adapter: SourceAdapter }) {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const q = useQuery({ queryKey: sourceKeys.runs(adapter.adapterId), queryFn: () => fetchSourceRuns(adapter.adapterId) });
  if (q.isLoading) return <SkeletonBlock className="h-32" />;
  if (q.isError) return <ErrorState title={t('app.governance.sources.loadFailed')} error={q.error} onRetry={() => q.refetch()} />;
  const runs = q.data ?? [];
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">{t('app.governance.sources.noRuns')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-xs">
        <caption className="sr-only">{t('app.governance.sources.runsCaption', { adapter: adapter.title })}</caption>
        <thead className="border-b border-border">
          <tr>
            <th scope="col" className={th}>{t('app.governance.sources.runStarted')}</th>
            <th scope="col" className={th}>{t('app.governance.sources.runStatus')}</th>
            <th scope="col" className={th}>{t('app.governance.sources.runTrigger')}</th>
            <th scope="col" className={th}>{t('app.governance.sources.runRecords')}</th>
            <th scope="col" className={th}>{t('app.governance.sources.runError')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {runs.map((r) => (
            <tr key={r.id}>
              <td className={td}>{r.startedAt ? fmt.dateTime(r.startedAt) : '—'}</td>
              <td className={td}>
                <span className="inline-flex items-center gap-1">
                  {r.status === 'FAILED' ? <XCircle className="size-3.5" aria-hidden="true" /> : r.status === 'RUNNING' ? <Clock className="size-3.5" aria-hidden="true" /> : <CheckCircle2 className="size-3.5" aria-hidden="true" />}
                  {label('app.governance.sources.runStatusValues', r.status)}
                </span>
              </td>
              <td className={td}>{r.trigger}{r.triggeredBy ? ` · ${r.triggeredBy}` : ''}</td>
              <td className={td}>{fmt.number(r.records)}</td>
              <td className={`${td} break-words text-destructive`}>{r.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsForm({ adapter }: { adapter: SourceAdapter }) {
  const t = useT();
  const errText = useCommercialErrorText();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (v: SourceSettingsForm) => saveSourceSettings(adapter.adapterId, v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sourceKeys.overview }),
  });
  const initial: SourceSettingsForm = {
    critical: adapter.settings.critical,
    freshnessThresholdHours: adapter.settings.freshnessThresholdHours,
    alertsEnabled: adapter.settings.alertsEnabled,
  };
  const form = useForm({
    defaultValues: initial,
    validators: { onChange: SourceSettingsFormSchema, onSubmit: SourceSettingsFormSchema },
    onSubmit: async ({ value, formApi }) => {
      await save.mutateAsync(value);
      formApi.reset(value);
    },
  });
  const id = `src-${adapter.adapterId}-threshold`;
  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <FormGuard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            noValidate
            aria-label={t('app.governance.sources.settings.label', { adapter: adapter.title })}
            className="space-y-3 rounded-lg border border-border bg-muted/20 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <h3 className="text-sm font-semibold">{t('app.governance.sources.settings.title')}</h3>
            <div className="flex flex-wrap items-end gap-4">
              <form.Field name="critical" children={(field) => (
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={field.state.value} onChange={(e) => field.handleChange(e.target.checked)} /> {t('app.governance.sources.settings.critical')}
                </label>
              )} />
              <form.Field name="alertsEnabled" children={(field) => (
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={field.state.value} onChange={(e) => field.handleChange(e.target.checked)} /> {t('app.governance.sources.settings.alertsEnabled')}
                </label>
              )} />
              <form.Field name="freshnessThresholdHours" children={(field) => (
                <FormField id={id} name={field.name} label={t('app.governance.sources.settings.threshold')} error={field.state.meta.errors as any}>
                  <FormInput type="number" min={1} max={8760} value={String(field.state.value)} onChange={(e) => field.handleChange(Number(e.target.value))} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <button type="submit" className={btnPrimary} disabled={!isDirty || !canSubmit || isSubmitting}>
                {isSubmitting ? t('app.governance.common.saving') : t('app.governance.common.save')}
              </button>
            </div>
            {save.isError && <p role="alert" className="text-xs text-destructive">{errText(save.error)}</p>}
          </form>
        </FormGuard>
      )}
    />
  );
}

function AlertsPanel({ alerts }: { alerts: SourceAlert[] }) {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  return (
    <section aria-labelledby="source-alerts-title" className={`${card} space-y-3`} data-testid="source-alerts">
      <h2 id="source-alerts-title" className="text-lg font-bold inline-flex items-center gap-2">
        <BellRing className="size-4" aria-hidden="true" /> {t('app.governance.sources.alerts.title')}
      </h2>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('app.governance.sources.alerts.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) =>
            a.status === 'OPEN' ? (
              <li key={a.id} data-alert-status="OPEN">
                <Notice tone="warning" title={`${t('app.governance.sources.alerts.open')}: ${a.adapterId}`}>
                  <span className="block">{a.message}</span>
                  <span className="block text-xs">
                    {t('app.governance.sources.alerts.openedAt', { date: a.openedAt ? fmt.dateTime(a.openedAt) : '—' })} ·{' '}
                    {t('app.governance.sources.alerts.notified', { count: a.notifiedUsers })}
                  </span>
                </Notice>
              </li>
            ) : (
              <li key={a.id} data-alert-status="RESOLVED" className="flex flex-wrap items-center gap-2 text-sm">
                <Pill tone="good" icon={CheckCircle2}>{t('app.governance.sources.alerts.resolved')}</Pill>
                <span className="font-mono text-xs">{a.adapterId}</span>
                <span className="text-xs text-muted-foreground">
                  {t('app.governance.sources.alerts.resolvedAt', {
                    date: a.resolvedAt ? fmt.dateTime(a.resolvedAt) : '—',
                    reason: label('app.governance.sources.alerts.reasons', a.resolvedReason),
                  })}
                </span>
              </li>
            )
          )}
        </ul>
      )}
    </section>
  );
}
