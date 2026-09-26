'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useStore } from '@tanstack/react-form';
import { z } from 'zod';
import { CheckCircle2, Clock, Globe, KeyRound, Trash2, XCircle } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormCheckbox, FormInput, FormSelect } from '@/components/form/form-inputs';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
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
import { Button, Card, ConfirmButton, OneTimeSecret, PanelError, PanelLoading, StatusBadge, errorMessage, formatDate } from './ui';

const keys = {
  config: ['integrations', 'sso', 'config'] as const,
  domains: ['integrations', 'sso', 'domains'] as const,
  scim: ['integrations', 'sso', 'scim-tokens'] as const,
};

const IdpSchema = z.object({
  issuer: z.string().trim().url('Issuer must be the https URL of your IdP'),
  clientId: z.string().trim().min(1, 'Client ID is required'),
  clientSecret: z.string(),
  scopes: z.string().trim().refine((s) => s.split(/\s+/).includes('openid'), 'Scopes must include openid'),
  defaultRole: z.enum(['VIEWER', 'AUDITOR', 'MIGRATION_CONSULTANT', 'LEAD_ARCHITECT']),
  jitProvisioning: z.boolean(),
  status: z.enum(['ACTIVE', 'DISABLED']),
});

function IdpForm({ config }: { config: SsoConfig }) {
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
    onError: (e) => setServerError(errorMessage(e)),
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
      aria-label="OpenID Connect identity provider"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <form.Field name="issuer" children={(f) => (
          <FormField id="idp-issuer" name="issuer" label="Issuer URL" required error={f.state.meta.errors as any} description="Discovery (/.well-known/openid-configuration) is fetched and validated on save.">
            <FormInput isMono value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} placeholder="https://login.example.com/realms/acme" />
          </FormField>
        )} />
        <form.Field name="clientId" children={(f) => (
          <FormField id="idp-client" name="clientId" label="Client ID" required error={f.state.meta.errors as any}>
            <FormInput isMono value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} />
          </FormField>
        )} />
        <form.Field name="clientSecret" children={(f) => (
          <FormField id="idp-secret" name="clientSecret" label="Client secret" description={p?.hasClientSecret ? 'A secret is stored (encrypted). Leave empty to keep it.' : 'Stored encrypted; never displayed again.'}>
            <FormInput type="password" autoComplete="new-password" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
          </FormField>
        )} />
        <form.Field name="scopes" children={(f) => (
          <FormField id="idp-scopes" name="scopes" label="Scopes" error={f.state.meta.errors as any}>
            <FormInput isMono value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} />
          </FormField>
        )} />
        <form.Field name="defaultRole" children={(f) => (
          <FormField id="idp-role" name="defaultRole" label="Role for just-in-time provisioned users" description="Owner and security-admin roles are never granted automatically.">
            <FormSelect value={f.state.value} onChange={(e) => f.handleChange(e.target.value as any)} options={['VIEWER', 'AUDITOR', 'MIGRATION_CONSULTANT', 'LEAD_ARCHITECT'].map((r) => ({ value: r, label: r }))} />
          </FormField>
        )} />
        <form.Field name="status" children={(f) => (
          <FormField id="idp-status" name="status" label="Status">
            <FormSelect value={f.state.value} onChange={(e) => f.handleChange(e.target.value as any)} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled' }]} />
          </FormField>
        )} />
      </div>
      <form.Field name="jitProvisioning" children={(f) => (
        <FormCheckbox
          id="idp-jit"
          checked={f.state.value}
          onChange={(e) => f.handleChange(e.target.checked)}
          label="Create accounts on first SSO login (only for e-mails of verified domains)"
        />
      )} />
      <p className="text-xs text-muted-foreground">
        Redirect URI to register at your IdP: <code className="font-mono">{config.redirectUri}</code>
      </p>
      {serverError && <p role="alert" className="text-xs text-destructive">{serverError}</p>}
      {saved && !isDirty && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">Saved — discovery validated ({p?.discovery?.tokenEndpoint}).</p>}
      <Button type="submit" busy={isSubmitting}>Save identity provider</Button>
    </form>
  );
}

function Domains() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.domains, queryFn: fetchSsoDomains });
  const [domain, setDomain] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: keys.domains });
  const add = useMutation({ mutationFn: addSsoDomain, onSuccess: () => { setDomain(''); invalidate(); }, onError: (e) => setError(errorMessage(e)) });
  const verify = useMutation({ mutationFn: verifySsoDomain, onSuccess: invalidate, onError: (e) => setError(errorMessage(e)) });
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
        <label htmlFor="sso-domain" className="sr-only">E-mail domain</label>
        <FormInput id="sso-domain" isMono value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" aria-invalid={domain.length > 0 && !valid} />
        <Button type="submit" busy={add.isPending} disabled={!valid}>
          <Globe className="size-3.5" aria-hidden="true" /> Add domain
        </Button>
      </form>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {q.isLoading ? (
        <PanelLoading rows={1} label="Loading domains" />
      ) : q.isError ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} what="domains" />
      ) : !q.data?.length ? (
        <p className="text-xs text-muted-foreground">No domains yet. SSO logins are only accepted for e-mail addresses of verified domains.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((d) => (
            <li key={d.id} className="rounded-md border border-border p-2 text-xs space-y-1">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <span className="font-mono font-semibold">{d.domain}</span>
                <div className="flex gap-1.5 items-center">
                  {d.status === 'VERIFIED' ? <StatusBadge tone="ok" icon={CheckCircle2} label="Verified" /> : d.status === 'FAILED' ? <StatusBadge tone="bad" icon={XCircle} label="TXT record not found" /> : <StatusBadge tone="info" icon={Clock} label="Pending" />}
                  {d.status !== 'VERIFIED' && (
                    <Button variant="secondary" onClick={() => verify.mutate(d.id)} busy={verify.isPending && verify.variables === d.id}>Verify DNS</Button>
                  )}
                  <ConfirmButton label={<Trash2 className="size-3.5" aria-label="Remove domain" />} confirmLabel="Remove" onConfirm={() => remove.mutate(d.id)} />
                </div>
              </div>
              {d.status !== 'VERIFIED' && (
                <p className="text-muted-foreground break-all">
                  Create DNS record <code className="font-mono">TXT {d.dnsRecord.name}</code> with value <code className="font-mono">{d.dnsRecord.value}</code>
                </p>
              )}
              {d.lastCheckedAt && <p className="text-muted-foreground">Last checked {formatDate(d.lastCheckedAt)}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScimTokens() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.scim, queryFn: fetchScimTokens });
  const [secret, setSecret] = React.useState<string | null>(null);
  const create = useMutation({ mutationFn: () => createScimToken('SCIM provisioning'), onSuccess: (r) => { setSecret(r.token); qc.invalidateQueries({ queryKey: keys.scim }); } });
  const revoke = useMutation({ mutationFn: revokeScimToken, onSuccess: () => qc.invalidateQueries({ queryKey: keys.scim }) });
  const base = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        SCIM 2.0 base URL: <code className="font-mono">{base || '<api>'}/api/v1/scim/v2</code> (Users, Groups). Deprovisioning removes organization access immediately.
      </p>
      <Button onClick={() => create.mutate()} busy={create.isPending}>
        <KeyRound className="size-3.5" aria-hidden="true" /> Create SCIM token
      </Button>
      {secret && <OneTimeSecret label="SCIM bearer token" value={secret} onDismiss={() => setSecret(null)} />}
      {q.isLoading ? (
        <PanelLoading rows={1} label="Loading SCIM tokens" />
      ) : q.isError ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} what="SCIM tokens" />
      ) : (
        <ul className="space-y-1 text-xs">
          {q.data?.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-1">
              <span className="font-mono">{t.prefix}…</span>
              {t.status === 'ACTIVE' ? <StatusBadge tone="ok" icon={CheckCircle2} label="Active" /> : <StatusBadge tone="neutral" icon={XCircle} label="Revoked" />}
              <span className="text-muted-foreground">last used {formatDate(t.last_used_at)}</span>
              {t.status === 'ACTIVE' && <ConfirmButton label="Revoke" confirmLabel="Revoke token" onConfirm={() => revoke.mutate(t.id)} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function IdentityPanel() {
  const config = useQuery({ queryKey: keys.config, queryFn: fetchSsoConfig });
  return (
    <div className="space-y-4">
      <Card title="Single sign-on (OpenID Connect)" description="Authorization code flow with PKCE. SSO users receive the same session as password users; roles are still enforced per organization.">
        {config.isLoading ? (
          <PanelLoading label="Loading SSO configuration" />
        ) : config.isError ? (
          <PanelError error={config.error} onRetry={() => config.refetch()} what="SSO configuration" />
        ) : (
          <IdpForm config={config.data!} />
        )}
      </Card>
      <Card title="Verified domains" description="Prove domain ownership with a DNS TXT record. A verified domain belongs to exactly one organization.">
        <Domains />
      </Card>
      <Card title="SCIM provisioning" description="Let your IdP create, update and deactivate members and groups.">
        <ScimTokens />
      </Card>
    </div>
  );
}

