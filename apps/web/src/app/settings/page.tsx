'use client';

import React, { useId, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  Key,
  Webhook,
  Plus,
  Copy,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Bot,
  Sparkles,
  Cpu,
  Lock,
  Scale,
  Check,
  Loader2,
  Sliders,
  ShieldAlert,
  Route,
} from 'lucide-react';
import {
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  fetchWebhooks,
  createWebhook,
  removeWebhook,
  testWebhook,
  fetchCurrentOrganization,
  updateCurrentOrganization,
  fetchTelemetrySummary,
} from '@/lib/api-client';
import { SettingsNav } from '@/components/settings/settings-nav';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { Notice, buttonClass } from '@/components/account/ui';
import { useErrorText, useFmt, useLabel, useRichT, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

type Tab = 'keys' | 'webhooks' | 'ai-governance';
const TABS: Tab[] = ['keys', 'webhooks', 'ai-governance'];

const keySchema = z.object({ name: z.string().trim().min(1, vmsg('app.validation.required')).max(120) });
const webhookSchema = z.object({
  url: z.string().trim().min(1, vmsg('app.validation.required')).url(vmsg('app.validation.urlInvalid')),
});

const card = 'bg-card border border-border rounded-2xl p-5 sm:p-6 shadow-xs';
const th = 'p-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const iconButton =
  'text-sm font-semibold rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-50';

function ApiKeysTab() {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const [createdKeySecret, setCreatedKeySecret] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const keys = useQuery({ queryKey: ['settings', 'api-keys'], queryFn: fetchApiKeys });

  const createKey = useMutation({
    mutationFn: (name: string) => createApiKey({ name }),
    onSuccess: (res) => {
      setCreatedKeySecret(res.apiKey);
      queryClient.invalidateQueries({ queryKey: ['settings', 'api-keys'] });
    },
  });
  const revokeKey = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'api-keys'] }),
  });

  const form = useForm({
    defaultValues: { name: '' },
    validators: { onSubmit: keySchema },
    onSubmit: async ({ value, formApi }) => {
      await createKey
        .mutateAsync(value.name.trim())
        .then(() => formApi.reset())
        .catch(() => undefined);
    },
  });

  return (
    <div className="space-y-6">
      {createdKeySecret && (
        <div role="status" className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              {t('app.settings.keys.createdTitle')}
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(createdKeySecret).catch(() => undefined);
                setCopiedKey(true);
                setTimeout(() => setCopiedKey(false), 2000);
              }}
              className={buttonClass.secondary}
            >
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              {copiedKey ? t('app.settings.keys.copied') : t('app.settings.keys.copy')}
            </button>
          </div>
          <p className="text-sm text-muted-foreground mb-2">{t('app.settings.keys.copyHint')}</p>
          <div className="p-3 bg-background border border-border rounded-lg font-mono text-xs break-all select-all">{createdKeySecret}</div>
        </div>
      )}

      <section className={card} aria-labelledby="create-key-heading">
        <h2 id="create-key-heading" className="text-base font-bold text-foreground mb-1">
          {t('app.settings.keys.formTitle')}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">{t('app.settings.keys.formHint')}</p>
        {createKey.isError && (
          <Notice tone="error" title={t('app.settings.keys.createFailed')} className="mb-4">
            {errText(createKey.error)}
          </Notice>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          noValidate
          className="flex flex-col sm:flex-row sm:items-end gap-3"
        >
          <form.Field
            name="name"
            children={(field) => (
              <FormField id="api-key-name" name={field.name} label={t('app.settings.keys.nameLabel')} required className="flex-1" error={field.state.meta.errors as any}>
                <FormInput
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder={t('app.settings.keys.namePlaceholder')}
                />
              </FormField>
            )}
          />
          <button type="submit" disabled={createKey.isPending} className={`${buttonClass.primary} sm:mb-0.5`}>
            {createKey.isPending ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
            {createKey.isPending ? t('app.settings.keys.creating') : t('app.settings.keys.create')}
          </button>
        </form>
      </section>

      <div className="bg-card border border-border rounded-2xl overflow-x-auto shadow-xs">
        <table className="w-full text-left text-sm border-collapse min-w-[640px]" aria-label={t('app.settings.keys.tableLabel')}>
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th scope="col" className={th}>{t('app.settings.keys.colName')}</th>
              <th scope="col" className={th}>{t('app.settings.keys.colPrefix')}</th>
              <th scope="col" className={th}>{t('app.settings.keys.colScopes')}</th>
              <th scope="col" className={th}>{t('app.settings.keys.colStatus')}</th>
              <th scope="col" className={th}>{t('app.settings.keys.colLastUsed')}</th>
              <th scope="col" className={`${th} text-right`}>{t('app.settings.keys.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {keys.isLoading ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">{t('app.settings.keys.loading')}</td>
              </tr>
            ) : keys.isError ? (
              <tr>
                <td colSpan={6} className="p-6 text-center">
                  <span role="alert" className="inline-flex items-center gap-2 text-destructive">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    {t('app.settings.keys.loadError')}
                  </span>{' '}
                  <button type="button" className="underline text-sm" onClick={() => keys.refetch()}>
                    {t('app.ui.retry')}
                  </button>
                </td>
              </tr>
            ) : (keys.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground">{t('app.settings.keys.empty')}</td>
              </tr>
            ) : (
              (keys.data ?? []).map((k) => (
                <tr key={k.id} className="hover:bg-muted/40">
                  <td className="p-3 font-semibold text-foreground break-words">{k.name}</td>
                  <td className="p-3 font-mono text-muted-foreground">{k.prefix}…</td>
                  <td className="p-3">
                    <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">{t('app.settings.keys.scopes', { count: k.scopes?.length ?? 0 })}</span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded border ${
                        k.status === 'ACTIVE'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20'
                      }`}
                    >
                      {k.status === 'ACTIVE' ? <CheckCircle2 className="size-3" aria-hidden="true" /> : <AlertCircle className="size-3" aria-hidden="true" />}
                      {label('app.settings.keys.status', k.status)}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">{k.last_used_at ? fmt.date(k.last_used_at) : t('app.settings.keys.never')}</td>
                  <td className="p-3 text-right">
                    {k.status === 'ACTIVE' && (
                      <button
                        type="button"
                        onClick={() => revokeKey.mutate(k.id)}
                        disabled={revokeKey.isPending}
                        aria-label={t('app.settings.keys.revokeLabel', { name: k.name })}
                        className={`${iconButton} text-rose-700 hover:text-rose-600 dark:text-rose-400`}
                      >
                        {t('app.settings.keys.revoke')}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {revokeKey.isError && <Notice tone="error">{errText(revokeKey.error)}</Notice>}
    </div>
  );
}

function WebhooksTab() {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<{ deliveredTo?: string; signatureHeader?: string } | null>(null);
  const webhooks = useQuery({ queryKey: ['settings', 'webhooks'], queryFn: fetchWebhooks });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['settings', 'webhooks'] });

  const create = useMutation({ mutationFn: (url: string) => createWebhook({ url }), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: removeWebhook, onSuccess: invalidate });
  const test = useMutation({
    mutationFn: testWebhook,
    onSuccess: (res) => {
      setTestResult(res);
      invalidate();
    },
  });

  const form = useForm({
    defaultValues: { url: '' },
    validators: { onSubmit: webhookSchema },
    onSubmit: async ({ value, formApi }) => {
      await create
        .mutateAsync(value.url.trim())
        .then(() => formApi.reset())
        .catch(() => undefined);
    },
  });

  const actionError = remove.error ?? test.error;

  return (
    <div className="space-y-6">
      {testResult && (
        <Notice tone="success" title={t('app.settings.webhooks.testTitle')}>
          <span className="break-all">
            {t('app.settings.webhooks.testTarget')}: <strong>{testResult.deliveredTo}</strong> · {t('app.settings.webhooks.testSignature')}:{' '}
            <code className="font-mono">{testResult.signatureHeader}</code>
          </span>
        </Notice>
      )}
      {actionError && <Notice tone="error" title={t('app.settings.webhooks.actionFailed')}>{errText(actionError)}</Notice>}

      <section className={card} aria-labelledby="create-webhook-heading">
        <h2 id="create-webhook-heading" className="text-base font-bold text-foreground mb-1">
          {t('app.settings.webhooks.formTitle')}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">{t('app.settings.webhooks.formHint')}</p>
        {create.isError && (
          <Notice tone="error" title={t('app.settings.webhooks.createFailed')} className="mb-4">
            {errText(create.error)}
          </Notice>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          noValidate
          className="flex flex-col sm:flex-row sm:items-end gap-3"
        >
          <form.Field
            name="url"
            children={(field) => (
              <FormField id="webhook-url" name={field.name} label={t('app.settings.webhooks.urlLabel')} required className="flex-1" error={field.state.meta.errors as any}>
                <FormInput
                  type="url"
                  inputMode="url"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  placeholder={t('app.settings.webhooks.urlPlaceholder')}
                />
              </FormField>
            )}
          />
          <button type="submit" disabled={create.isPending} className={buttonClass.primary}>
            {create.isPending ? <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
            {create.isPending ? t('app.settings.webhooks.registering') : t('app.settings.webhooks.register')}
          </button>
        </form>
      </section>

      <div className="bg-card border border-border rounded-2xl overflow-x-auto shadow-xs">
        <table className="w-full text-left text-sm border-collapse min-w-[640px]" aria-label={t('app.settings.webhooks.tableLabel')}>
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th scope="col" className={th}>{t('app.settings.webhooks.colUrl')}</th>
              <th scope="col" className={th}>{t('app.settings.webhooks.colEvents')}</th>
              <th scope="col" className={th}>{t('app.settings.webhooks.colStatus')}</th>
              <th scope="col" className={th}>{t('app.settings.webhooks.colLastTriggered')}</th>
              <th scope="col" className={`${th} text-right`}>{t('app.settings.webhooks.colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {webhooks.isLoading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">{t('app.settings.webhooks.loading')}</td>
              </tr>
            ) : webhooks.isError ? (
              <tr>
                <td colSpan={5} className="p-6 text-center">
                  <span role="alert" className="inline-flex items-center gap-2 text-destructive">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    {t('app.settings.webhooks.loadError')}
                  </span>{' '}
                  <button type="button" className="underline text-sm" onClick={() => webhooks.refetch()}>
                    {t('app.ui.retry')}
                  </button>
                </td>
              </tr>
            ) : (webhooks.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">{t('app.settings.webhooks.empty')}</td>
              </tr>
            ) : (
              (webhooks.data ?? []).map((wh) => (
                <tr key={wh.id} className="hover:bg-muted/40">
                  <td className="p-3 font-mono text-xs break-all">{wh.url}</td>
                  <td className="p-3">
                    <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                      {wh.events?.length ? t('app.settings.webhooks.events', { count: wh.events.length }) : t('app.settings.webhooks.allEvents')}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded border bg-muted border-border">
                      {wh.status === 'ACTIVE' ? <CheckCircle2 className="size-3 text-emerald-600" aria-hidden="true" /> : <AlertCircle className="size-3 text-amber-600" aria-hidden="true" />}
                      {label('app.settings.webhooks.status', wh.status)}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">{wh.last_triggered_at ? fmt.dateTime(wh.last_triggered_at) : t('app.settings.webhooks.never')}</td>
                  <td className="p-3 text-right whitespace-nowrap space-x-3">
                    <button
                      type="button"
                      onClick={() => test.mutate(wh.id)}
                      disabled={test.isPending}
                      aria-label={t('app.settings.webhooks.pingLabel', { url: wh.url })}
                      className={`${iconButton} text-primary hover:underline`}
                    >
                      {t('app.settings.webhooks.ping')}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(wh.id)}
                      disabled={remove.isPending}
                      aria-label={t('app.settings.webhooks.removeLabel', { url: wh.url })}
                      className={`${iconButton} text-rose-700 hover:text-rose-600 dark:text-rose-400`}
                    >
                      {t('app.settings.webhooks.remove')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Accessible on/off policy switch (button with role="switch"; state shown as text, not color only). */
function PolicySwitch({
  icon: Icon,
  title,
  body,
  checked,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useT();
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onClick={() => onChange(!checked)}
      className={`text-left p-4 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
        checked ? 'bg-primary/5 border-primary/40' : 'bg-background border-border hover:border-primary/30'
      }`}
    >
      <span className="flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
          <span id={`${id}-title`} className="text-sm font-bold text-foreground">
            {title}
          </span>
        </span>
        <span
          className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
            checked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          {checked && <Check className="size-3" aria-hidden="true" />}
          {checked ? t('app.settings.ai.on') : t('app.settings.ai.off')}
        </span>
      </span>
      <span id={`${id}-body`} className="block text-sm text-muted-foreground leading-relaxed">
        {body}
      </span>
    </button>
  );
}

function AiPolicyTab() {
  const t = useT();
  const rt = useRichT();
  const fmt = useFmt();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const org = useQuery({ queryKey: ['settings', 'organization'], queryFn: fetchCurrentOrganization });
  const telemetry = useQuery({ queryKey: ['settings', 'telemetry'], queryFn: fetchTelemetrySummary });
  const [deterministicOnly, setDeterministicOnly] = useState(false);
  const [requireDualReview, setRequireDualReview] = useState(false);
  const [aiAuditLogging, setAiAuditLogging] = useState(true);
  const [saved, setSaved] = useState(false);
  const initialised = useRef(false);

  React.useEffect(() => {
    if (org.data && !initialised.current) {
      initialised.current = true;
      const policy = org.data.data_policy ?? {};
      setDeterministicOnly(!!policy.deterministicOnly);
      setRequireDualReview(!!policy.requireDualReviewForInferred);
      setAiAuditLogging(policy.aiAuditLoggingEnabled !== false);
    }
  }, [org.data]);

  const save = useMutation({
    // Keeps every other policy field of the organization unchanged.
    mutationFn: () =>
      updateCurrentOrganization({
        dataPolicy: {
          ...(org.data?.data_policy ?? {}),
          deterministicOnly,
          requireDualReviewForInferred: requireDualReview,
          aiAuditLoggingEnabled: aiAuditLogging,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'organization'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const tokens = telemetry.data?.monthlyAdvisoryTokens;
  const tokenRatio = tokens && tokens.limit > 0 ? tokens.consumed / tokens.limit : null;
  const determinism = telemetry.data?.engineDeterminismRatio;
  const bold = (c: React.ReactNode) => <strong className="font-semibold">{c}</strong>;

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-primary/10 to-transparent border border-primary/30 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-primary/10 text-primary mt-1 shrink-0">
              <Scale className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">{t('app.settings.ai.boundaryTitle')}</h2>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-3xl">{rt('app.settings.ai.boundaryBodyRich', { b: bold })}</p>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl px-4 py-3 shrink-0 text-center">
            <div className="text-xs text-muted-foreground font-semibold">{t('app.settings.ai.ceiling')}</div>
            <div className="text-2xl font-black text-primary font-mono">{fmt.number(0.6, { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-muted-foreground font-mono">{t('app.settings.ai.ceilingClass')}</div>
          </div>
        </div>
      </div>

      <section className={`${card} space-y-5`} aria-labelledby="ai-policy-heading">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
          <div>
            <h2 id="ai-policy-heading" className="text-base font-bold text-foreground flex items-center gap-2">
              <Sliders className="w-4 h-4 text-primary" aria-hidden="true" />
              {t('app.settings.ai.policyTitle')}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">{t('app.settings.ai.policyHint')}</p>
          </div>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !org.data} className={buttonClass.primary}>
            {save.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                {t('app.settings.ai.saving')}
              </>
            ) : saved ? (
              <>
                <Check className="w-4 h-4" aria-hidden="true" />
                {t('app.settings.ai.saved')}
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                {t('app.settings.ai.save')}
              </>
            )}
          </button>
        </div>
        {org.isError && (
          <Notice tone="error" title={t('app.settings.ai.loadError')}>
            {errText(org.error)}
          </Notice>
        )}
        {save.isError && <Notice tone="error" title={t('app.settings.ai.saveFailed')}>{errText(save.error)}</Notice>}
        <span role="status" aria-live="polite" className="sr-only">
          {saved ? t('app.settings.ai.saved') : ''}
        </span>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PolicySwitch icon={Lock} title={t('app.settings.ai.deterministicTitle')} body={t('app.settings.ai.deterministicBody')} checked={deterministicOnly} onChange={setDeterministicOnly} />
          <PolicySwitch icon={ShieldAlert} title={t('app.settings.ai.dualReviewTitle')} body={t('app.settings.ai.dualReviewBody')} checked={requireDualReview} onChange={setRequireDualReview} />
          <PolicySwitch icon={ShieldCheck} title={t('app.settings.ai.auditTitle')} body={t('app.settings.ai.auditBody')} checked={aiAuditLogging} onChange={setAiAuditLogging} />
          <div className="p-4 rounded-xl bg-background border border-border">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-primary" aria-hidden="true" />
                <span className="text-sm font-bold text-foreground">{t('app.settings.ai.scrubbingTitle')}</span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-muted text-foreground">
                <Check className="size-3" aria-hidden="true" />
                {t('app.settings.ai.always')}
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{t('app.settings.ai.scrubbingBody')}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="ai-functions-heading">
        <div>
          <h2 id="ai-functions-heading" className="text-base font-bold text-foreground flex items-center gap-2">
            <Bot className="w-4 h-4 text-primary" aria-hidden="true" />
            {t('app.settings.ai.functionsTitle')}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">{t('app.settings.ai.functionsHint')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { icon: Sparkles, title: t('app.settings.ai.explainTitle'), body: t('app.settings.ai.explainBody'), input: t('app.settings.ai.explainInput') },
            { icon: Route, title: t('app.settings.ai.routerTitle'), body: t('app.settings.ai.routerBody'), input: t('app.settings.ai.routerInput') },
          ].map((fn) => (
            <div key={fn.title} className={`${card} space-y-3`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <fn.icon className="w-4 h-4 text-primary" aria-hidden="true" />
                  {fn.title}
                </h3>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted border border-border">
                  {t('app.settings.ai.cap', { value: fmt.number(0.6, { minimumFractionDigits: 2 }) })}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{fn.body}</p>
              <p className="text-xs pt-2 border-t border-border">
                <span className="text-muted-foreground">{t('app.settings.ai.inputScope')}: </span>
                <span className="text-foreground">{fn.input}</span>
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className={`${card} space-y-4`} aria-labelledby="ai-usage-heading">
        <h2 id="ai-usage-heading" className="text-base font-bold text-foreground flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" aria-hidden="true" />
          {t('app.settings.ai.telemetryTitle')}
        </h2>
        {telemetry.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-busy="true" aria-label={t('app.ui.loading')}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="p-4 bg-muted/40 border border-border rounded-xl animate-pulse motion-reduce:animate-none h-24" />
            ))}
          </div>
        ) : telemetry.isError ? (
          <Notice tone="error" title={t('app.ui.loadFailed')}>
            {errText(telemetry.error)}
          </Notice>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 bg-background border border-border rounded-xl">
              <span className="text-sm text-muted-foreground">{t('app.settings.ai.tokens')}</span>
              <div className="text-xl font-bold text-foreground mt-1">
                {tokens ? `${fmt.number(tokens.consumed)} / ${fmt.number(tokens.limit)}` : t('app.settings.ai.noData')}
              </div>
              <div
                className="w-full bg-muted h-1.5 rounded-full mt-2 overflow-hidden"
                role="progressbar"
                aria-label={t('app.settings.ai.tokens')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={tokenRatio === null ? 0 : Math.round(tokenRatio * 100)}
              >
                <div className="bg-primary h-full rounded-full" style={{ width: `${Math.min(100, (tokenRatio ?? 0) * 100)}%` }} />
              </div>
              <span className="text-xs text-muted-foreground mt-1 block">
                {tokenRatio === null ? t('app.settings.ai.noData') : t('app.settings.ai.tokensUsed', { percent: fmt.percent(tokenRatio, 1) })}
              </span>
            </div>
            <div className="p-4 bg-background border border-border rounded-xl">
              <span className="text-sm text-muted-foreground">{t('app.settings.ai.latency')}</span>
              <div className="text-xl font-bold text-foreground mt-1">
                {telemetry.data?.meanAdvisoryLatencyMs
                  ? t('app.settings.ai.latencyValue', { ms: fmt.number(telemetry.data.meanAdvisoryLatencyMs) })
                  : t('app.settings.ai.noData')}
              </div>
            </div>
            <div className="p-4 bg-background border border-border rounded-xl">
              <span className="text-sm text-muted-foreground">{t('app.settings.ai.determinism')}</span>
              <div className="text-xl font-bold text-foreground mt-1">
                {typeof determinism === 'number' ? fmt.percent(determinism, 1) : t('app.settings.ai.noData')}
              </div>
              {typeof determinism === 'number' && (
                <span className="text-xs text-muted-foreground mt-1 block">
                  {t('app.settings.ai.determinismHint', { percent: fmt.percent(1 - determinism, 1) })}
                </span>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function SettingsPage() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<Tab>('keys');
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ keys: null, webhooks: null, 'ai-governance': null });
  const tabMeta: Record<Tab, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
    keys: { label: t('app.settings.workspace.tabKeys'), icon: Key },
    webhooks: { label: t('app.settings.workspace.tabWebhooks'), icon: Webhook },
    'ai-governance': { label: t('app.settings.workspace.tabAi'), icon: Bot },
  };

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TABS[(index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="max-w-5xl mx-auto">
      <SettingsNav />
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground">{t('app.settings.workspace.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('app.settings.workspace.subtitle')}</p>
      </div>

      <div role="tablist" aria-label={t('app.settings.workspace.tabsLabel')} className="flex border-b border-border mb-6 overflow-x-auto">
        {TABS.map((tab, index) => {
          const { label, icon: Icon } = tabMeta[tab];
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              ref={(el) => {
                tabRefs.current[tab] = el;
              }}
              type="button"
              role="tab"
              id={`settings-tab-${tab}`}
              aria-selected={selected}
              aria-controls={`settings-panel-${tab}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(e) => onTabKey(e, index)}
              className={`flex items-center gap-2 pb-3 px-4 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-t ${
                selected ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={`settings-panel-${activeTab}`} aria-labelledby={`settings-tab-${activeTab}`}>
        {activeTab === 'keys' && <ApiKeysTab />}
        {activeTab === 'webhooks' && <WebhooksTab />}
        {activeTab === 'ai-governance' && <AiPolicyTab />}
      </div>
    </div>
  );
}
