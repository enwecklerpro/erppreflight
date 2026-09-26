'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, CheckCircle2, CircleDashed, FlaskConical, GitPullRequest, History, Loader2, Search, ShieldCheck, XCircle } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { ErrorState, Notice, SkeletonBlock, useCommercialErrorText } from '@/components/commercial/states';
import { useFmt, useLabel, useT } from '@/i18n/client';
import {
  RULE_STATUSES,
  RuleGovernanceFormSchema,
  fetchRuleDetail,
  fetchRuleInventory,
  ruleKeys,
  runRuleSelfTest,
  transitionRule,
  updateRuleGovernance,
  type RuleDetail,
  type RuleItem,
  type RuleStatus,
} from '@/lib/api/governance';
import { FormGuard, GovernanceHeader, Kpi, Pager, Pill, btn, btnPrimary, card, selectCls, td, th, type Tone } from './shared';

const PAGE = 50;

const STATUS_TONE: Record<RuleStatus, { tone: Tone; icon: React.ComponentType<{ className?: string }> }> = {
  DRAFT: { tone: 'neutral', icon: CircleDashed },
  IN_REVIEW: { tone: 'info', icon: GitPullRequest },
  PUBLISHED: { tone: 'good', icon: ShieldCheck },
  DEPRECATED: { tone: 'warn', icon: Ban },
};

function RuleStatusPill({ status }: { status: RuleStatus }) {
  const t = useT();
  const s = STATUS_TONE[status];
  return (
    <Pill tone={s.tone} icon={s.icon}>
      {t(`app.governance.rules.status.${status}`)}
    </Pill>
  );
}

function SelfTestPill({ status, outdated }: { status: string | null; outdated?: boolean }) {
  const t = useT();
  if (!status) return <Pill tone="neutral" icon={CircleDashed}>{t('app.governance.rules.selfTestStatus.NONE')}</Pill>;
  const pill =
    status === 'PASSED' ? (
      <Pill tone="good" icon={CheckCircle2}>{t('app.governance.rules.selfTestStatus.PASSED')}</Pill>
    ) : status === 'NO_FIXTURES' ? (
      <Pill tone="warn" icon={AlertTriangle}>{t('app.governance.rules.selfTestStatus.NO_FIXTURES')}</Pill>
    ) : (
      <Pill tone="bad" icon={XCircle}>{t(`app.governance.rules.selfTestStatus.${status === 'ERROR' ? 'ERROR' : 'FAILED'}`)}</Pill>
    );
  return (
    <span className="inline-flex flex-col gap-1">
      {pill}
      {outdated && (
        <span className="inline-flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-3" aria-hidden="true" /> {t('app.governance.rules.outdated')}
        </span>
      )}
    </span>
  );
}

function CoverageCell({ rule }: { rule: RuleItem }) {
  const t = useT();
  const label = useLabel();
  return rule.coverage.covered ? (
    <Pill tone="good" icon={CheckCircle2}>
      {t('app.governance.rules.coverage.covered', { positive: rule.coverage.positiveCases, negative: rule.coverage.negativeCases })}
    </Pill>
  ) : (
    <Pill tone="warn" icon={AlertTriangle}>{label('app.governance.rules.coverage', rule.coverage.gap ?? 'NO_FIXTURES')}</Pill>
  );
}

export function RuleAdmin() {
  const t = useT();
  const q = useQuery({ queryKey: ruleKeys.all, queryFn: fetchRuleInventory, staleTime: 15_000 });
  const [search, setSearch] = React.useState('');
  const [engine, setEngine] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [gapsOnly, setGapsOnly] = React.useState(false);
  const [offset, setOffset] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);
  const detailRef = React.useRef<HTMLElement>(null);

  const items = React.useMemo(() => {
    const term = search.trim().toUpperCase();
    return (q.data?.items ?? []).filter(
      (r) =>
        (!term || r.ruleCode.includes(term) || r.title.toUpperCase().includes(term)) &&
        (!engine || r.engineType === engine) &&
        (!status || r.status === status) &&
        (!gapsOnly || !r.coverage.covered)
    );
  }, [q.data, search, engine, status, gapsOnly]);
  React.useEffect(() => setOffset(0), [search, engine, status, gapsOnly]);

  const open = (code: string) => {
    setSelected(code);
    requestAnimationFrame(() => detailRef.current?.focus());
  };

  const d = q.data;
  return (
    <div className="space-y-6" data-testid="rule-admin">
      <GovernanceHeader title={t('app.governance.rules.title')} intro={t('app.governance.rules.intro')} onRefresh={() => q.refetch()} refreshing={q.isFetching} />
      {q.isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label={t('app.governance.common.loading')}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[1, 2, 3, 4].map((i) => <SkeletonBlock key={i} className="h-24" />)}</div>
          <SkeletonBlock className="h-96" />
        </div>
      ) : q.isError ? (
        <ErrorState title={t('app.governance.rules.loadFailed')} error={q.error} onRetry={() => q.refetch()} />
      ) : d ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={t('app.governance.rules.kpi.rules')} value={d.summary.rules} hint={t('app.governance.rules.kpi.rulesHint', { engines: d.summary.engines })} />
            <Kpi label={t('app.governance.rules.kpi.covered')} value={d.summary.covered} hint={t('app.governance.rules.kpi.coveredHint', { gaps: d.summary.coverageGaps })} />
            <Kpi label={t('app.governance.rules.kpi.published')} value={d.summary.published} hint={t('app.governance.rules.kpi.publishedHint', { inReview: d.summary.inReview })} />
            <Kpi label={t('app.governance.rules.kpi.selfTests')} value={d.summary.selfTestsPassed} hint={t('app.governance.rules.kpi.selfTestsHint', { failing: d.summary.selfTestsFailing })} />
          </div>

          <div className={`${card} space-y-4`}>
            <div role="search" aria-label={t('app.governance.rules.filters.label')} className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-medium">
                {t('app.governance.rules.filters.search')}
                <FormInput value={search} onChange={(e) => setSearch(e.target.value)} leftIcon={<Search className="size-4" aria-hidden="true" />} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {t('app.governance.rules.filters.engine')}
                <select className={selectCls} value={engine} onChange={(e) => setEngine(e.target.value)}>
                  <option value="">{t('app.governance.rules.filters.allEngines')}</option>
                  {d.engines.map((e) => (
                    <option key={e.engineType} value={e.engineType}>{e.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {t('app.governance.rules.filters.status')}
                <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">{t('app.governance.rules.filters.allStatuses')}</option>
                  {RULE_STATUSES.map((s) => (
                    <option key={s} value={s}>{t(`app.governance.rules.status.${s}`)}</option>
                  ))}
                </select>
              </label>
              <label className="inline-flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} /> {t('app.governance.rules.filters.gapsOnly')}
              </label>
            </div>

            {items.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t('app.governance.rules.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem] text-sm">
                  <caption className="sr-only">{t('app.governance.rules.table.caption', { count: items.length })}</caption>
                  <thead className="border-b border-border">
                    <tr>
                      <th scope="col" className={th}>{t('app.governance.rules.table.rule')}</th>
                      <th scope="col" className={th}>{t('app.governance.rules.table.engine')}</th>
                      <th scope="col" className={th}>{t('app.governance.rules.table.status')}</th>
                      <th scope="col" className={th}>{t('app.governance.rules.table.coverage')}</th>
                      <th scope="col" className={th}>{t('app.governance.rules.table.selfTest')}</th>
                      <th scope="col" className={th}>{t('app.governance.rules.table.people')}</th>
                      <th scope="col" className={th}><span className="sr-only">{t('app.governance.rules.table.actions')}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.slice(offset, offset + PAGE).map((r) => (
                      <tr key={r.ruleCode} data-rule={r.ruleCode} className={selected === r.ruleCode ? 'bg-muted/50' : undefined}>
                        <td className={td}>
                          <span className="block font-mono text-xs font-semibold break-all">{r.ruleCode}</span>
                          <span className="block text-xs text-muted-foreground">{r.title}</span>
                          <span className="block font-mono text-[11px] text-muted-foreground">{r.version}</span>
                          {r.inputValidationRule && <span className="text-[11px] text-muted-foreground">{t('app.governance.rules.inputRule')}</span>}
                        </td>
                        <td className={`${td} text-xs`}>{r.engineName}</td>
                        <td className={td}>
                          <span className="inline-flex flex-col gap-1">
                            <RuleStatusPill status={r.status} />
                            {r.drifted && (
                              <span className="inline-flex items-center gap-1 text-xs text-amber-800 dark:text-amber-300">
                                <AlertTriangle className="size-3" aria-hidden="true" /> {t('app.governance.rules.drifted')}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className={td}><CoverageCell rule={r} /></td>
                        <td className={td}>
                          <SelfTestPill status={r.latestSelfTest?.status ?? null} outdated={Boolean(r.latestSelfTest) && !r.selfTestCurrent} />
                        </td>
                        <td className={`${td} text-xs`}>
                          <span className="block">{r.author ?? '—'}</span>
                          <span className="block text-muted-foreground">{r.reviewer ?? '—'}</span>
                        </td>
                        <td className={td}>
                          <button type="button" className={btn} onClick={() => open(r.ruleCode)} aria-label={t('app.governance.rules.table.manageLabel', { code: r.ruleCode })}>
                            {t('app.governance.rules.table.manage')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager offset={offset} limit={PAGE} total={items.length} onChange={setOffset} />
          </div>

          {selected && (
            <section ref={detailRef} tabIndex={-1} aria-labelledby="rule-detail-title" className="outline-none" onKeyDown={(e) => e.key === 'Escape' && setSelected(null)}>
              <RuleDetailPanel code={selected} onClose={() => setSelected(null)} />
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}

function RuleDetailPanel({ code, onClose }: { code: string; onClose: () => void }) {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useCommercialErrorText();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ruleKeys.detail(code), queryFn: () => fetchRuleDetail(code) });
  const [note, setNote] = React.useState('');
  const refresh = (detail?: RuleDetail) => {
    if (detail) queryClient.setQueryData(ruleKeys.detail(code), detail);
    queryClient.invalidateQueries({ queryKey: ruleKeys.all });
    queryClient.invalidateQueries({ queryKey: ruleKeys.detail(code) });
  };
  const selfTest = useMutation({ mutationFn: () => runRuleSelfTest(code), onSuccess: () => refresh() });
  const transition = useMutation({
    mutationFn: (to: RuleStatus) => transitionRule(code, to, note.trim() || undefined),
    onSuccess: (detail) => {
      setNote('');
      refresh(detail);
    },
    onError: () => refresh(),
  });

  if (q.isLoading) return <SkeletonBlock className="h-80" />;
  if (q.isError) return <ErrorState title={t('app.governance.rules.detail.loadFailed')} error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data!;
  const latestRun = r.selfTests[0];

  return (
    <div className={`${card} space-y-5`} data-testid="rule-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="rule-detail-title" className="text-lg font-bold break-all">{t('app.governance.rules.detail.title', { code: r.ruleCode })}</h2>
          <p className="text-sm text-muted-foreground">{r.title}</p>
        </div>
        <button type="button" className={btn} onClick={onClose}>{t('app.governance.common.close')}</button>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <div><dt className="text-xs text-muted-foreground">{t('app.governance.rules.detail.engine')}</dt><dd>{r.engineName}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t('app.governance.rules.detail.severity')}</dt><dd>{r.defaultSeverity}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t('app.governance.rules.detail.version')}</dt><dd className="font-mono text-xs break-all">{r.version}</dd></div>
        <div><dt className="text-xs text-muted-foreground">{t('app.governance.rules.detail.publishedVersion')}</dt><dd className="font-mono text-xs break-all">{r.publishedVersion ?? '—'}</dd></div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('app.governance.rules.detail.cases')}</dt>
          <dd>{t('app.governance.rules.detail.casesValue', { positive: r.coverage.positiveCases, negative: r.coverage.negativeCases })}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <RuleStatusPill status={r.status} />
        <CoverageCell rule={r} />
        <SelfTestPill status={r.latestSelfTest?.status ?? null} outdated={Boolean(r.latestSelfTest) && !r.selfTestCurrent} />
        <button type="button" className={btnPrimary} onClick={() => selfTest.mutate()} disabled={selfTest.isPending} data-testid="run-self-test">
          {selfTest.isPending ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FlaskConical className="size-3.5" aria-hidden="true" />}
          {selfTest.isPending ? t('app.governance.rules.detail.running') : t('app.governance.rules.detail.runSelfTest')}
        </button>
        {selfTest.isSuccess && (
          <span role="status" className="text-xs">{t('app.governance.rules.detail.selfTestDone', { status: t(`app.governance.rules.selfTestStatus.${selfTest.data.status}`) })}</span>
        )}
      </div>
      {selfTest.isError && <p role="alert" className="text-xs text-destructive">{errText(selfTest.error)}</p>}

      <section aria-labelledby="rule-transitions" className="space-y-2">
        <h3 id="rule-transitions" className="text-sm font-semibold">{t('app.governance.rules.detail.transitions')}</h3>
        {r.status === 'IN_REVIEW' &&
          (r.publishBlocker ? (
            <Notice tone="warning" title={t(`app.governance.rules.blocker.${r.publishBlocker as 'COVERAGE_GAP'}`)} />
          ) : (
            <Notice tone="success" title={t('app.governance.rules.detail.publishReady')} />
          ))}
        <label className="flex max-w-xl flex-col gap-1 text-xs font-medium">
          {t('app.governance.rules.detail.note')}
          <FormInput value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          {r.allowedTransitions.map((to) => (
            <button
              key={to}
              type="button"
              className={to === 'PUBLISHED' ? btnPrimary : btn}
              disabled={transition.isPending}
              onClick={() => transition.mutate(to)}
              data-testid={`transition-${to}`}
            >
              {t(`app.governance.rules.detail.transitionTo.${to}`)}
            </button>
          ))}
        </div>
        {transition.isError && <p role="alert" className="text-xs text-destructive">{errText(transition.error)}</p>}
      </section>

      <GovernanceForm rule={r} onSaved={(detail) => refresh(detail)} />

      <section aria-labelledby="rule-selftests" className="space-y-2">
        <h3 id="rule-selftests" className="text-sm font-semibold inline-flex items-center gap-2"><FlaskConical className="size-4" aria-hidden="true" /> {t('app.governance.rules.detail.selfTests')}</h3>
        {!latestRun ? (
          <p className="text-sm text-muted-foreground">{t('app.governance.rules.detail.noSelfTests')}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {fmt.dateTime(latestRun.createdAt)} · <span className="font-mono">{latestRun.ruleVersion}</span> · {t('app.governance.rules.detail.digest')}{' '}
              <span className="font-mono break-all">{latestRun.resultDigest?.slice(0, 16) ?? '—'}</span>
            </p>
            {latestRun.cases.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-xs">
                  <caption className="sr-only">{t('app.governance.rules.detail.selfTests')}</caption>
                  <thead className="border-b border-border">
                    <tr>
                      <th scope="col" className={th}>{t('app.governance.rules.detail.case')}</th>
                      <th scope="col" className={th}>{t('app.governance.rules.detail.kind')}</th>
                      <th scope="col" className={th}>{t('app.governance.rules.detail.emitted')}</th>
                      <th scope="col" className={th}>{t('app.governance.rules.detail.result')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {latestRun.cases.map((c) => (
                      <tr key={c.caseId}>
                        <td className={`${td} font-mono break-all`}>{c.fixture}</td>
                        <td className={td}>{t(`app.governance.rules.detail.kind${c.kind}`)}</td>
                        <td className={`${td} font-mono break-all`}>{c.emittedCodes.join(', ') || '—'}</td>
                        <td className={td}>
                          {c.passed ? (
                            <Pill tone="good" icon={CheckCircle2}>{t('app.governance.rules.detail.casePassed')}</Pill>
                          ) : (
                            <Pill tone="bad" icon={XCircle}>{t('app.governance.rules.detail.caseFailed')}</Pill>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="rule-history" className="space-y-2">
        <h3 id="rule-history" className="text-sm font-semibold inline-flex items-center gap-2"><History className="size-4" aria-hidden="true" /> {t('app.governance.rules.detail.history')}</h3>
        {r.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('app.governance.rules.detail.noHistory')}</p>
        ) : (
          <ol className="space-y-1 text-xs">
            {r.history.map((h) => (
              <li key={h.id} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{fmt.dateTime(h.createdAt)}</span>
                <span className="font-medium">
                  {h.eventType === 'TRANSITION'
                    ? t('app.governance.rules.detail.event.TRANSITION', { from: label('app.governance.rules.status', h.fromStatus), to: label('app.governance.rules.status', h.toStatus) })
                    : h.eventType === 'SELF_TEST'
                      ? t('app.governance.rules.detail.event.SELF_TEST', { status: String(h.details.status ?? '—') })
                      : h.eventType === 'PUBLISH_BLOCKED'
                        ? t('app.governance.rules.detail.event.PUBLISH_BLOCKED', { blocker: String(h.details.blocker ?? '—') })
                        : t('app.governance.rules.detail.event.UPDATED')}
                </span>
                {h.actorEmail && <span className="text-muted-foreground">{h.actorEmail}</span>}
                {h.note && <span className="italic">{h.note}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function GovernanceForm({ rule, onSaved }: { rule: RuleDetail; onSaved: (detail: RuleDetail) => void }) {
  const t = useT();
  const errText = useCommercialErrorText();
  const save = useMutation({ mutationFn: (v: { author: string; reviewer: string; notes: string }) => updateRuleGovernance(rule.ruleCode, v) });
  const form = useForm({
    defaultValues: { author: rule.author ?? '', reviewer: rule.reviewer ?? '', notes: rule.notes ?? '' },
    validators: { onChange: RuleGovernanceFormSchema, onSubmit: RuleGovernanceFormSchema },
    onSubmit: async ({ value, formApi }) => {
      const detail = await save.mutateAsync(value);
      formApi.reset({ author: detail.author ?? '', reviewer: detail.reviewer ?? '', notes: detail.notes ?? '' });
      onSaved(detail);
    },
  });
  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <FormGuard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            noValidate
            aria-labelledby="rule-governance-title"
            className="space-y-3 rounded-lg border border-border bg-muted/20 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <h3 id="rule-governance-title" className="text-sm font-semibold">{t('app.governance.rules.detail.governance')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="author" children={(field) => (
                <FormField id="rule-author" name={field.name} label={t('app.governance.rules.detail.author')} error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="reviewer" children={(field) => (
                <FormField id="rule-reviewer" name={field.name} label={t('app.governance.rules.detail.reviewer')} error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
            </div>
            <form.Field name="notes" children={(field) => (
              <FormField id="rule-notes" name={field.name} label={t('app.governance.rules.detail.notes')} error={field.state.meta.errors as any}>
                <textarea
                  id="rule-notes"
                  className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={field.state.value}
                  maxLength={4000}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )} />
            {save.isError && <p role="alert" className="text-xs text-destructive">{errText(save.error)}</p>}
            <button type="submit" className={btnPrimary} disabled={!isDirty || !canSubmit || isSubmitting}>
              {isSubmitting ? t('app.governance.common.saving') : t('app.governance.common.save')}
            </button>
          </form>
        </FormGuard>
      )}
    />
  );
}
