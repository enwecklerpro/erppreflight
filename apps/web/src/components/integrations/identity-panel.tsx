'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useStore } from '@tanstack/react-form';
import { z } from 'zod';
import { CheckCircle2, Clock, Globe, KeyRound, Trash2, XCircle } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormCheckbox, FormInput, FormSelect } from '@/components/form/form-inputs';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { vmsg } from '@/i18n/validation';
import {
  SsoConfig,
  addSsoDomain,
  createScimToken,
  fetchScimTokens,
  fetchSsoConfig,
  fetchSsoDomains,
  removeSsoDomain,
  revokeScimToken,
  saveSsoConfig,
  verifySsoDomain,
} from '@/lib/api/integrations';
import { Button, Card, ConfirmButton, OneTimeSecret, PanelError, PanelLoading, StatusBadge, useIntegrationText } from './ui';

const keys = {
  config: ['integrations', 'sso', 'config'] as const,
  domains: ['integrations', 'sso', 'domains'] as const,
  scim: ['integrations', 'sso', 'scim-tokens'] as const,
};

const JIT_ROLES = ['VIEWER', 'AUDITOR', 'MIGRATION_CONSULTANT', 'LEAD_ARCHITECT'] as const;

const IdpSchema = z.object({
  issuer: z.string().trim().url(vmsg('app.integrations.identity.issuerInvalid')),
  clientId: z.string().trim().min(1, vmsg('app.integrations.identity.clientIdRequired')),
  clientSecret: z.string(),
  scopes: z.string().trim().refine((s) => s.split(/\s+/).includes('openid'), vmsg('app.integrations.identity.scopesOpenid')),
  defaultRole: z.enum(JIT_ROLES),
  jitProvisioning: z.boolean(),
  status: z.enum(['ACTIVE', 'DISABLED']),
});

function IdpForm({ config }: { config: SsoConfig }) {
  const { t, errorText } = useIntegrationText();
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const p = config.provider;
  const save = useMutation({
    mutationFn: saveSsoConfig,
    onSuccess: (r) => {
      qc.setQueryData(keys.config, r);
      setSaved(true);
    },
    onError: (e) => setServerError(errorText(e)),
  });
  const form = useForm({
    defaultValues: {
      issuer: p?.issuer ?? '',
      clientId: p?.clientId ?? '',
      clientSecret: '',
      scopes: p?.scopes ?? 'openid email profile',
      defaultRole: (p?.defaultRole ?? 'VIEWER') as z.infer<typeof IdpSchema>['defaultRole'],
      jitProvisioning: p?.jitProvisioning ?? true,
      status: (p?.status ?? 'ACTIVE') as 'ACTIVE' | 'DISABLED',
    },
    validators: { onChange: IdpSchema, onSubmit: IdpSchema },
    onSubmit: async ({ value, formApi }) => {
      setServerError(null);
      setSaved(false);
      await save.mutateAsync({ ...value, clientSecret: value.clientSecret || undefined });
      formApi.reset({ ...value, clientSecret: '' });
    },
  });
  const isDirty = useStore(form.store, (s) => s.isDirty);
  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  useUnsavedChangesGuard({ isDirty, isSubmitting });

  return (
    <form
      noValidate
      aria-label={t('app.integrations.identity.formLabel')}
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <form.Field name="issuer" children={(f) => (
          <FormField id="idp-issuer" name="issuer" label={t('app.integrations.identity.issuer')} required error={f.state.meta.errors as any} description={t('app.integrations.identity.issuerHint')}>
            <FormInput isMono value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} placeholder="https://login.example.com/realms/acme" />
          </FormField>
        )} />
        <form.Field name="clientId" children={(f) => (
          <FormField id="idp-client" name="clientId" label={t('app.integrations.identity.clientId')} required error={f.state.meta.errors as any}>
            <FormInput isMono value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} />
          </FormField>
        )} />
        <form.Field name="clientSecret" children={(f) => (
          <FormField
            id="idp-secret"
            name="clientSecret"
            label={t('app.integrations.identity.clientSecret')}
            description={p?.hasClientSecret ? t('app.integrations.identity.secretStored') : t('app.integrations.identity.secretNew')}
          >
            <FormInput type="password" autoComplete="new-password" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
          </FormField>
        )} />
        <form.Field name="scopes" children={(f) => (
          <FormField id="idp-scopes" name="scopes" label={t('app.integrations.identity.scopes')} error={f.state.meta.errors as any}>
            <FormInput isMono value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} />
          </FormField>
        )} />
        <form.Field name="defaultRole" children={(f) => (
          <FormField id="idp-role" name="defaultRole" label={t('app.integrations.identity.defaultRole')} description={t('app.integrations.identity.defaultRoleHint')}>
            <FormSelect
              value={f.state.value}
              onChange={(e) => f.handleChange(e.target.value as any)}
              options={JIT_ROLES.map((r) => ({ value: r, label: t(`app.ui.orgRole.${r}`) }))}
            />
          </FormField>
        )} />
        <form.Field name="status" children={(f) => (
          <FormField id="idp-status" name="status" label={t('app.integrations.identity.status')}>
            <FormSelect
              value={f.state.value}
              onChange={(e) => f.handleChange(e.target.value as any)}
              options={[
                { value: 'ACTIVE', label: t('app.integrations.common.active') },
                { value: 'DISABLED', label: t('app.integrations.common.disabled') },
              ]}
            />
          </FormField>
        )} />
      </div>
      <form.Field name="jitProvisioning" children={(f) => (
        <FormCheckbox
          id="idp-jit"
          checked={f.state.value}
          onChange={(e) => f.handleChange(e.target.checked)}
          label={t('app.integrations.identity.jit')}
        />
      )} />
      <p className="text-xs text-muted-foreground">
        {t('app.integrations.identity.redirectUri')} <code className="font-mono">{config.redirectUri}</code>
      </p>
      {serverError && <p role="alert" className="text-xs text-destructive">{serverError}</p>}
      {saved && !isDirty && (
        <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">
          {t('app.integrations.identity.saved', { endpoint: p?.discovery?.tokenEndpoint ?? '' })}
        </p>
      )}
      <Button type="submit" busy={isSubmitting}>{t('app.integrations.identity.save')}</Button>
    </form>
  );
}

function Domains() {
  const { t, errorText, formatDate } = useIntegrationText();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.domains, queryFn: fetchSsoDomains });
  const [domain, setDomain] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.domains });
  const add = useMutation({ mutationFn: addSsoDomain, onSuccess: () => { setDomain(''); invalidate(); }, onError: (e) => setError(errorText(e)) });
  const verify = useMutation({ mutationFn: verifySsoDomain, onSuccess: invalidate, onError: (e) => setError(errorText(e)) });
  const remove = useMutation({ mutationFn: removeSsoDomain, onSuccess: invalidate });
  const valid = /^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain.trim().toLowerCase());
  return (
    <div className="space-y-2">
      <form
        className="flex flex-col sm:flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (valid) add.mutate(domain.trim().toLowerCase());
        }}
      >
        <label htmlFor="sso-domain" className="sr-only">{t('app.integrations.identity.emailDomain')}</label>
        <FormInput id="sso-domain" isMono value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" aria-invalid={domain.length > 0 && !valid} />
        <Button type="submit" busy={add.isPending} disabled={!valid}>
          <Globe className="size-3.5" aria-hidden="true" /> {t('app.integrations.identity.addDomain')}
        </Button>
      </form>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {q.isLoading ? (
        <PanelLoading rows={1} label={t('app.integrations.identity.domainsLoading')} />
      ) : q.isError ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} what={t('app.integrations.identity.domainsWhat')} />
      ) : !q.data?.length ? (
        <p className="text-xs text-muted-foreground">{t('app.integrations.identity.domainsEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((d) => (
            <li key={d.id} className="rounded-md border border-border p-2 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <span className="font-mono font-semibold">{d.domain}</span>
                <div className="flex gap-1.5 items-center">
                  {d.status === 'VERIFIED' ? (
                    <StatusBadge tone="ok" icon={CheckCircle2} label={t('app.integrations.common.verified')} />
                  ) : d.status === 'FAILED' ? (
                    <StatusBadge tone="bad" icon={XCircle} label={t('app.integrations.identity.txtNotFound')} />
                  ) : (
                    <StatusBadge tone="info" icon={Clock} label={t('app.integrations.common.pending')} />
                  )}
                  {d.status !== 'VERIFIED' && (
                    <Button variant="secondary" onClick={() => verify.mutate(d.id)} busy={verify.isPending && verify.variables === d.id}>
                      {t('app.integrations.identity.verifyDns')}
                    </Button>
                  )}
                  <ConfirmButton
                    label={<Trash2 className="size-3.5" aria-label={t('app.integrations.identity.removeDomain')} />}
                    confirmLabel={t('app.integrations.common.remove')}
                    onConfirm={() => remove.mutate(d.id)}
                  />
                </div>
              </div>
              {d.status !== 'VERIFIED' && (
                <p className="text-muted-foreground break-all">
                  {t('app.integrations.identity.dnsRecord', { name: `TXT ${d.dnsRecord.name}`, value: d.dnsRecord.value })}
                </p>
              )}
              {d.lastCheckedAt && <p className="text-muted-foreground">{t('app.integrations.identity.lastChecked', { when: formatDate(d.lastCheckedAt) })}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScimTokens() {
  const { t, formatDate } = useIntegrationText();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.scim, queryFn: fetchScimTokens });
  const [secret, setSecret] = React.useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => createScimToken(t('app.integrations.identity.scimTokenName')),
    onSuccess: (r) => { setSecret(r.token); qc.invalidateQueries({ queryKey: keys.scim }); },
  });
  const revoke = useMutation({ mutationFn: revokeScimToken, onSuccess: () => qc.invalidateQueries({ queryKey: keys.scim }) });
  const base = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t('app.integrations.identity.scimBase')} <code className="font-mono">{base || '<api>'}/api/v1/scim/v2</code>{' '}
        {t('app.integrations.identity.scimBaseHint')}
      </p>
      <Button onClick={() => create.mutate()} busy={create.isPending}>
        <KeyRound className="size-3.5" aria-hidden="true" /> {t('app.integrations.identity.createScim')}
      </Button>
      {secret && <OneTimeSecret label={t('app.integrations.identity.scimSecret')} value={secret} onDismiss={() => setSecret(null)} />}
      {q.isLoading ? (
        <PanelLoading rows={1} label={t('app.integrations.identity.scimLoading')} />
      ) : q.isError ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} what={t('app.integrations.identity.scimWhat')} />
      ) : (
        <ul className="space-y-1 text-xs">
          {q.data?.map((tok) => (
            <li key={tok.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-1">
              <span className="font-mono">{tok.prefix}…</span>
              {tok.status === 'ACTIVE' ? (
                <StatusBadge tone="ok" icon={CheckCircle2} label={t('app.integrations.common.active')} />
              ) : (
                <StatusBadge tone="neutral" icon={XCircle} label={t('app.integrations.common.revoked')} />
              )}
              <span className="text-muted-foreground">{t('app.integrations.identity.lastUsed', { when: formatDate(tok.last_used_at) })}</span>
              {tok.status === 'ACTIVE' && (
                <ConfirmButton label={t('app.integrations.common.revoke')} confirmLabel={t('app.integrations.identity.revokeToken')} onConfirm={() => revoke.mutate(tok.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IdentityPanel() {
  const { t } = useIntegrationText();
  const config = useQuery({ queryKey: keys.config, queryFn: fetchSsoConfig });
  return (
    <div className="space-y-4">
      <Card title={t('app.integrations.identity.ssoTitle')} description={t('app.integrations.identity.ssoDescription')}>
        {config.isLoading ? (
          <PanelLoading label={t('app.integrations.identity.ssoLoading')} />
        ) : config.isError ? (
          <PanelError error={config.error} onRetry={() => config.refetch()} what={t('app.integrations.identity.ssoWhat')} />
        ) : (
          <IdpForm config={config.data!} />
        )}
      </Card>
      <Card title={t('app.integrations.identity.domainsTitle')} description={t('app.integrations.identity.domainsDescription')}>
        <Domains />
      </Card>
      <Card title={t('app.integrations.identity.scimTitle')} description={t('app.integrations.identity.scimDescription')}>
        <ScimTokens />
      </Card>
    </div>
  );
}
