'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Bot, CheckCircle2, Power, PowerOff, Server, XCircle } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { ErrorState, SkeletonBlock, useCommercialErrorText } from '@/components/commercial/states';
import { useFmt, useT } from '@/i18n/client';
import {
  AI_PRIVACY_MODES,
  AI_PROVIDERS,
  AiTaskFormSchema,
  aiKeys,
  aiTaskToForm,
  fetchAiOverview,
  resetAiTask,
  saveAiTask,
  setAiProviderKillSwitch,
  type AiProviderControl,
  type AiTask,
  type AiTaskForm,
} from '@/lib/api/governance';
import { FormGuard, GovernanceHeader, Pill, btn, btnPrimary, card, selectCls, td, th } from './shared';

export function AiAdmin() {
  const t = useT();
  const q = useQuery({ queryKey: aiKeys.overview, queryFn: fetchAiOverview });
  const d = q.data;
  return (
    <div className="space-y-6" data-testid="ai-admin">
      <GovernanceHeader
        title={t('app.governance.ai.title')}
        intro={t('app.governance.ai.intro', { cap: d?.confidenceCap ?? 0.6 })}
        onRefresh={() => q.refetch()}
        refreshing={q.isFetching}
      />
      {q.isLoading ? (
        <div className="space-y-4" aria-busy="true" aria-label={t('app.governance.common.loading')}>
          <SkeletonBlock className="h-40" />
          <SkeletonBlock className="h-64" />
        </div>
      ) : q.isError ? (
        <ErrorState title={t('app.governance.ai.loadFailed')} error={q.error} onRetry={() => q.refetch()} />
      ) : d ? (
        <>
          <p className="text-sm">
            {d.defaultProvider ? t('app.governance.ai.defaultProvider', { provider: d.defaultProvider }) : t('app.governance.ai.noDefaultProvider')}
          </p>
          <ProvidersPanel providers={d.providers} />
          <section aria-labelledby="ai-tasks-title" className="space-y-4">
            <h2 id="ai-tasks-title" className="text-lg font-bold">{t('app.governance.ai.tasks.title')}</h2>
            {d.tasks.map((task) => (
              <TaskCard key={task.task} task={task} />
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}

function ProvidersPanel({ providers }: { providers: AiProviderControl[] }) {
  const t = useT();
  const fmt = useFmt();
  return (
    <section aria-labelledby="ai-providers-title" className={`${card} space-y-3`}>
      <h2 id="ai-providers-title" className="text-lg font-bold">{t('app.governance.ai.providers.title')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <caption className="sr-only">{t('app.governance.ai.providers.title')}</caption>
          <thead className="border-b border-border">
            <tr>
              <th scope="col" className={th}>{t('app.governance.ai.providers.provider')}</th>
              <th scope="col" className={th}>{t('app.governance.ai.providers.state')}</th>
              <th scope="col" className={th}>{t('app.governance.ai.providers.credentials')}</th>
              <th scope="col" className={th}>{t('app.governance.ai.providers.defaultModel')}</th>
              <th scope="col" className={th}>{t('app.governance.ai.providers.endpoint')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {providers.map((p) => (
              <tr key={p.provider} data-provider={p.provider}>
                <td className={`${td} font-mono text-xs font-semibold`}>
                  {p.provider}
                  {p.selfHosted && <span className="ml-1 font-sans font-normal text-muted-foreground">({t('app.governance.ai.providers.selfHosted')})</span>}
                </td>
                <td className={td}>
                  {p.killSwitch ? (
                    <span className="flex flex-col gap-1">
                      <Pill tone="bad" icon={PowerOff}>{t('app.governance.ai.providers.killed')}</Pill>
                      <span className="text-xs text-muted-foreground">
                        {t('app.governance.ai.providers.killedSince', { date: p.killedAt ? fmt.dateTime(p.killedAt) : '—', reason: p.killReason ?? '—' })}
                      </span>
                    </span>
                  ) : (
                    <Pill tone="good" icon={Power}>{t('app.governance.ai.providers.active')}</Pill>
                  )}
                  <KillSwitchControl provider={p} />
                </td>
                <td className={td}>
                  {p.credentialsConfigured ? (
                    <Pill tone="good" icon={CheckCircle2}>{t('app.governance.ai.providers.credentialsOk')}</Pill>
                  ) : (
                    <Pill tone="warn" icon={AlertTriangle}>{t('app.governance.ai.providers.credentialsMissing')}</Pill>
                  )}
                </td>
                <td className={`${td} font-mono text-xs`}>{p.defaultModel}</td>
                <td className={`${td} font-mono text-xs break-all`}>{p.endpointUrl ?? p.environmentEndpoint ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function KillSwitchControl({ provider }: { provider: AiProviderControl }) {
  const t = useT();
  const errText = useCommercialErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const mutation = useMutation({
    mutationFn: (v: { kill: boolean; reason: string | null }) => setAiProviderKillSwitch(provider.provider, v.kill, v.reason),
    onSuccess: () => {
      setOpen(false);
      setReason('');
      queryClient.invalidateQueries({ queryKey: aiKeys.overview });
    },
  });
  const reasonValid = reason.trim().length >= 5;
  if (provider.killSwitch) {
    return (
      <div className="mt-2">
        <button
          type="button"
          className={btn}
          disabled={mutation.isPending}
          data-testid={`release-${provider.provider}`}
          onClick={() => {
            if (window.confirm(t('app.governance.ai.providers.confirmRelease', { provider: provider.provider }))) mutation.mutate({ kill: false, reason: null });
          }}
        >
          <Power className="size-3.5" aria-hidden="true" /> {t('app.governance.ai.providers.release')}
        </button>
        {mutation.isError && <p role="alert" className="text-xs text-destructive">{errText(mutation.error)}</p>}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      {!open ? (
        <button type="button" className={btn} onClick={() => setOpen(true)} data-testid={`kill-${provider.provider}`}>
          <PowerOff className="size-3.5" aria-hidden="true" /> {t('app.governance.ai.providers.activate')}
        </button>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reasonValid) mutation.mutate({ kill: true, reason: reason.trim() });
          }}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        >
          <label className="flex flex-col gap-1 text-xs font-medium">
            {t('app.governance.ai.providers.reason')}
            <FormInput
              autoFocus
              value={reason}
              maxLength={500}
              placeholder={t('app.governance.ai.providers.reasonPlaceholder')}
              aria-invalid={reason.length > 0 && !reasonValid}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button type="submit" className={btnPrimary} disabled={!reasonValid || mutation.isPending}>
            {t('app.governance.ai.providers.activate')}
          </button>
          <button type="button" className={btn} onClick={() => setOpen(false)}>{t('app.governance.common.cancel')}</button>
          {reason.length > 0 && !reasonValid && <p className="w-full text-xs text-destructive">{t('app.governance.validation.reasonRequired')}</p>}
        </form>
      )}
      {mutation.isError && <p role="alert" className="text-xs text-destructive">{errText(mutation.error)}</p>}
    </div>
  );
}

function TaskCard({ task }: { task: AiTask }) {
  const t = useT();
  const fmt = useFmt();
  const errText = useCommercialErrorText();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const reset = useMutation({
    mutationFn: () => resetAiTask(task.task),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiKeys.overview }),
  });
  const name = t(`app.governance.ai.tasks.names.${task.task as 'problem_routing'}`);
  const c = task.config;
  const eur = (v: number) => fmt.number(v, { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 });
  return (
    <article className={`${card} space-y-3`} data-task={task.task} aria-labelledby={`task-${task.task}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`task-${task.task}`} className="inline-flex items-center gap-2 font-semibold">
            <Bot className="size-4" aria-hidden="true" /> {name} <span className="font-mono text-xs text-muted-foreground">{task.task}</span>
          </h3>
          <p className="text-xs text-muted-foreground">{t('app.governance.ai.tasks.usedBy')}: {task.usedBy}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {task.configured ? <Pill tone="info" icon={Server}>{t('app.governance.ai.tasks.configured')}</Pill> : <Pill tone="neutral" icon={Server}>{t('app.governance.ai.tasks.defaults')}</Pill>}
          {!c.enabled && <Pill tone="bad" icon={Ban}>{t('app.governance.ai.tasks.disabled')}</Pill>}
          {task.ceilingReached && <Pill tone="bad" icon={XCircle}>{t('app.governance.ai.tasks.ceilingReached')}</Pill>}
        </div>
      </div>
      <p className="text-sm">
        {c.effectiveProvider
          ? t('app.governance.ai.tasks.effective', { provider: c.effectiveProvider, model: c.effectiveModel ?? '—' })
          : t('app.governance.ai.tasks.noProvider')}
      </p>
      <p className="text-xs text-muted-foreground">
        {t('app.governance.ai.tasks.spend', { month: task.spend.periodMonth })}:{' '}
        {t('app.governance.ai.tasks.spendValue', { cost: eur(task.spend.costEur), requests: task.spend.requests, blocked: task.spend.blockedRequests })}
        {c.costCeilingEurMonthly !== null && ` / ${eur(c.costCeilingEurMonthly)}`}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => setEditing((v) => !v)} aria-expanded={editing} data-testid={`edit-${task.task}`}>
          {t('app.governance.ai.tasks.edit')}
        </button>
        {task.configured && (
          <button
            type="button"
            className={btn}
            disabled={reset.isPending}
            onClick={() => window.confirm(t('app.governance.ai.tasks.resetConfirm', { task: name })) && reset.mutate()}
          >
            {t('app.governance.ai.tasks.reset')}
          </button>
        )}
      </div>
      {reset.isError && <p role="alert" className="text-xs text-destructive">{errText(reset.error)}</p>}
      {editing && <TaskForm task={task} name={name} onDone={() => setEditing(false)} />}
    </article>
  );
}

function TaskForm({ task, name, onDone }: { task: AiTask; name: string; onDone: () => void }) {
  const t = useT();
  const errText = useCommercialErrorText();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (v: AiTaskForm) => saveAiTask(task.task, v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiKeys.overview }),
  });
  const form = useForm({
    defaultValues: aiTaskToForm(task),
    validators: { onChange: AiTaskFormSchema, onSubmit: AiTaskFormSchema },
    onSubmit: async ({ value, formApi }) => {
      await save.mutateAsync(value);
      formApi.reset(value);
      onDone();
    },
  });
  const id = (f: string) => `ai-${task.task}-${f}`;
  const providerOptions = (emptyLabel: string) => (
    <>
      <option value="">{emptyLabel}</option>
      {AI_PROVIDERS.map((p) => (
        <option key={p} value={p}>{p}</option>
      ))}
    </>
  );
  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <FormGuard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            noValidate
            aria-label={t('app.governance.ai.form.label', { task: name })}
            className="space-y-3 rounded-lg border border-border bg-muted/20 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            onKeyDown={(e) => e.key === 'Escape' && !isDirty && onDone()}
          >
            <form.Field name="enabled" children={(field) => (
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={field.state.value} onChange={(e) => field.handleChange(e.target.checked)} /> {t('app.governance.ai.form.enabled')}
              </label>
            )} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <form.Field name="provider" children={(field) => (
                <FormField id={id('provider')} name={field.name} label={t('app.governance.ai.form.provider')} error={field.state.meta.errors as any}>
                  <select id={id('provider')} className={selectCls} value={field.state.value} onChange={(e) => field.handleChange(e.target.value as AiTaskForm['provider'])}>
                    {providerOptions(t('app.governance.ai.form.platformDefault'))}
                  </select>
                </FormField>
              )} />
              <form.Field name="primaryModel" children={(field) => (
                <FormField id={id('primary')} name={field.name} label={t('app.governance.ai.form.primaryModel')} error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} placeholder={t('app.governance.ai.form.modelPlaceholder')} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="privacyMode" children={(field) => (
                <FormField id={id('privacy')} name={field.name} label={t('app.governance.ai.form.privacyMode')} error={field.state.meta.errors as any}>
                  <select id={id('privacy')} className={selectCls} value={field.state.value} onChange={(e) => field.handleChange(e.target.value as AiTaskForm['privacyMode'])}>
                    {AI_PRIVACY_MODES.map((m) => (
                      <option key={m} value={m}>{t(`app.governance.ai.form.privacy.${m}`)}</option>
                    ))}
                  </select>
                </FormField>
              )} />
              <form.Field name="fallbackProvider" children={(field) => (
                <FormField id={id('fbprovider')} name={field.name} label={t('app.governance.ai.form.fallbackProvider')} error={field.state.meta.errors as any}>
                  <select id={id('fbprovider')} className={selectCls} value={field.state.value} onChange={(e) => field.handleChange(e.target.value as AiTaskForm['fallbackProvider'])}>
                    {providerOptions(t('app.governance.ai.form.noFallback'))}
                  </select>
                </FormField>
              )} />
              <form.Field name="fallbackModel" children={(field) => (
                <FormField id={id('fbmodel')} name={field.name} label={t('app.governance.ai.form.fallbackModel')} error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} placeholder={t('app.governance.ai.form.modelPlaceholder')} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="maxTokens" children={(field) => (
                <FormField id={id('max')} name={field.name} label={t('app.governance.ai.form.maxTokens')} error={field.state.meta.errors as any}>
                  <FormInput type="number" min={64} max={4096} value={String(field.state.value)} onChange={(e) => field.handleChange(Number(e.target.value))} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="temperature" children={(field) => (
                <FormField id={id('temp')} name={field.name} label={t('app.governance.ai.form.temperature')} error={field.state.meta.errors as any}>
                  <FormInput inputMode="decimal" value={field.state.value} placeholder={t('app.governance.ai.form.temperaturePlaceholder')} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="costCeilingEurMonthly" children={(field) => (
                <FormField id={id('ceiling')} name={field.name} label={t('app.governance.ai.form.costCeiling')} error={field.state.meta.errors as any}>
                  <FormInput inputMode="decimal" value={field.state.value} placeholder={t('app.governance.ai.form.costCeilingPlaceholder')} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="inputPriceEurPer1k" children={(field) => (
                <FormField id={id('inprice')} name={field.name} label={t('app.governance.ai.form.inputPrice')} error={field.state.meta.errors as any}>
                  <FormInput type="number" min={0} step="0.0001" value={String(field.state.value)} onChange={(e) => field.handleChange(Number(e.target.value))} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="outputPriceEurPer1k" children={(field) => (
                <FormField id={id('outprice')} name={field.name} label={t('app.governance.ai.form.outputPrice')} error={field.state.meta.errors as any}>
                  <FormInput type="number" min={0} step="0.0001" value={String(field.state.value)} onChange={(e) => field.handleChange(Number(e.target.value))} onBlur={field.handleBlur} />
                </FormField>
              )} />
            </div>
            <p className="text-xs text-muted-foreground">{t('app.governance.ai.form.hint')}</p>
            {save.isError && <p role="alert" className="text-xs text-destructive">{errText(save.error)}</p>}
            <div className="flex gap-2">
              <button type="submit" className={btnPrimary} disabled={!isDirty || !canSubmit || isSubmitting} data-testid={`save-${task.task}`}>
                {isSubmitting ? t('app.governance.common.saving') : t('app.governance.common.save')}
              </button>
              <button type="button" className={btn} onClick={onDone}>{t('app.governance.common.cancel')}</button>
            </div>
          </form>
        </FormGuard>
      )}
    />
  );
}
