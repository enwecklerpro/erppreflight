'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useStore } from '@tanstack/react-form';
import { z } from 'zod';
import { ArrowRightLeft, Ban, Building2, CheckCircle2, Clock, Handshake } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect, FormTextarea } from '@/components/form/form-inputs';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useLabel } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';
import { useTenantSwitch } from '@/lib/query/query-provider';
import { PartnerGrant, createGrant, fetchCurrentOrganization, fetchGrantsGiven, fetchPartnerClients, revokeGrant } from '@/lib/api/integrations';
import { Button, Card, ConfirmButton, PanelEmpty, PanelError, PanelLoading, StatusBadge, useIntegrationText } from './ui';

const keys = {
  given: ['integrations', 'partners', 'given'] as const,
  clients: ['integrations', 'partners', 'clients'] as const,
};

const ACCESS_ROLES = ['VIEWER', 'ANALYST', 'PROJECT_ADMIN'] as const;

const GrantSchema = z.object({
  partnerOrganizationSlug: z.string().trim().min(1, vmsg('app.integrations.partners.partnerRequired')),
  accessRole: z.enum(ACCESS_ROLES),
  expiresInDays: z.coerce
    .number()
    .int()
    .min(1, vmsg('app.integrations.partners.minDays'))
    .max(365, vmsg('app.integrations.partners.maxDays')),
  reason: z.string().trim().min(3, vmsg('app.integrations.partners.reasonRequired')),
});

function GrantStatus({ g }: { g: PartnerGrant }) {
  const { t, formatDate } = useIntegrationText();
  if (g.status === 'ACTIVE') {
    return <StatusBadge tone="ok" icon={CheckCircle2} label={t('app.integrations.partners.activeUntil', { when: formatDate(g.expiresAt) })} />;
  }
  if (g.status === 'EXPIRED') return <StatusBadge tone="neutral" icon={Clock} label={t('app.integrations.common.expired')} />;
  return <StatusBadge tone="bad" icon={Ban} label={t('app.integrations.common.revoked')} />;
}

function GrantForm() {
  const { t, errorText } = useIntegrationText();
  const qc = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const create = useMutation({ mutationFn: createGrant, onSuccess: () => qc.invalidateQueries({ queryKey: keys.given }), onError: (e) => setServerError(errorText(e)) });
  const form = useForm({
    defaultValues: { partnerOrganizationSlug: '', accessRole: 'VIEWER' as 'VIEWER' | 'ANALYST' | 'PROJECT_ADMIN', expiresInDays: 30, reason: '' },
    validators: { onSubmit: GrantSchema as any },
    onSubmit: async ({ value, formApi }) => {
      setServerError(null);
      await create.mutateAsync({ ...value, expiresInDays: Number(value.expiresInDays) });
      formApi.reset();
    },
  });
  const isDirty = useStore(form.store, (s) => s.isDirty);
  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  useUnsavedChangesGuard({ isDirty, isSubmitting });
  return (
    <form
      noValidate
      aria-label={t('app.integrations.partners.formLabel')}
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
      className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start"
    >
      <form.Field name="partnerOrganizationSlug" children={(f) => (
        <FormField id="grant-partner" name="partnerOrganizationSlug" label={t('app.integrations.partners.partnerOrg')} required error={f.state.meta.errors as any}>
          <FormInput isMono value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} placeholder="partner-consulting-1234" />
        </FormField>
      )} />
      <form.Field name="accessRole" children={(f) => (
        <FormField id="grant-role" name="accessRole" label={t('app.integrations.partners.access')}>
          <FormSelect
            value={f.state.value}
            onChange={(e) => f.handleChange(e.target.value as any)}
            options={ACCESS_ROLES.map((r) => ({ value: r, label: t(`app.integrations.partners.role.${r}`) }))}
          />
        </FormField>
      )} />
      <form.Field name="expiresInDays" children={(f) => (
        <FormField id="grant-days" name="expiresInDays" label={t('app.integrations.partners.expiresDays')} error={f.state.meta.errors as any}>
          <FormInput type="number" min={1} max={365} value={String(f.state.value)} onChange={(e) => f.handleChange(Number(e.target.value))} />
        </FormField>
      )} />
      <form.Field name="reason" children={(f) => (
        <FormField id="grant-reason" name="reason" label={t('app.integrations.partners.reason')} required error={f.state.meta.errors as any}>
          <FormTextarea rows={1} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
        </FormField>
      )} />
      {serverError && <p role="alert" className="md:col-span-4 text-xs text-destructive">{serverError}</p>}
      <div className="md:col-span-4">
        <Button type="submit" busy={isSubmitting}>
          <Handshake className="size-3.5" aria-hidden="true" /> {t('app.integrations.partners.grant')}
        </Button>
      </div>
    </form>
  );
}

export function PartnersPanel() {
  const { t, errorText, formatDate, relative } = useIntegrationText();
  const label = useLabel();
  const qc = useQueryClient();
  const switchTenant = useTenantSwitch();
  const given = useQuery({ queryKey: keys.given, queryFn: fetchGrantsGiven, retry: (n, e: any) => e?.statusCode !== 403 && n < 2 });
  const clients = useQuery({ queryKey: keys.clients, queryFn: fetchPartnerClients });
  const org = useQuery({ queryKey: ['integrations', 'current-organization'], queryFn: fetchCurrentOrganization, staleTime: 5 * 60_000 });
  const revoke = useMutation({ mutationFn: revokeGrant, onSuccess: () => qc.invalidateQueries({ queryKey: keys.given }) });
  const forbidden = (given.error as any)?.statusCode === 403;
  const roleLabel = (role: string) => label('app.integrations.partners.role', role);

  return (
    <div className="space-y-4">
      <Card title={t('app.integrations.partners.givenTitle')} description={t('app.integrations.partners.givenDescription')}>
        {forbidden ? (
          <p className="text-xs text-muted-foreground">{t('app.integrations.partners.forbidden')}</p>
        ) : (
          <>
            <GrantForm />
            <div className="mt-4">
              {given.isLoading ? (
                <PanelLoading rows={2} label={t('app.integrations.partners.grantsLoading')} />
              ) : given.isError ? (
                <PanelError error={given.error} onRetry={() => given.refetch()} what={t('app.integrations.partners.grantsWhat')} />
              ) : !given.data?.length ? (
                <PanelEmpty icon={Handshake} title={t('app.integrations.partners.emptyTitle')} body={t('app.integrations.partners.emptyBody')} />
              ) : (
                <ul className="space-y-2">
                  {given.data.map((g) => (
                    <li key={g.id} className="rounded-md border border-border p-2 text-xs flex flex-col md:flex-row md:items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{g.partnerOrganizationName}</p>
                        <p className="text-muted-foreground">
                          {t('app.integrations.partners.grantLine', {
                            role: roleLabel(g.accessRole),
                            tenantRole: label('app.ui.orgRole', g.effectiveTenantRole),
                            when: relative(g.lastUsedAt),
                            reason: g.reason ?? '',
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <GrantStatus g={g} />
                        {g.status === 'ACTIVE' && (
                          <ConfirmButton
                            label={t('app.integrations.common.revoke')}
                            confirmLabel={t('app.integrations.partners.revokeNow')}
                            onConfirm={() => revoke.mutate(g.id)}
                            busy={revoke.isPending}
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {revoke.isError && <p role="alert" className="mt-1 text-xs text-destructive">{errorText(revoke.error)}</p>}
            </div>
          </>
        )}
      </Card>
      <Card
        title={t('app.integrations.partners.clientsTitle')}
        description={
          <>
            {t('app.integrations.partners.clientsDescription')} <code className="font-mono">{org.data?.slug ?? '…'}</code>
          </>
        }
      >
        {clients.isLoading ? (
          <PanelLoading rows={2} label={t('app.integrations.partners.clientsLoading')} />
        ) : clients.isError ? (
          <PanelError error={clients.error} onRetry={() => clients.refetch()} what={t('app.integrations.partners.clientsWhat')} />
        ) : !clients.data?.length ? (
          <PanelEmpty icon={Building2} title={t('app.integrations.partners.clientsEmptyTitle')} body={t('app.integrations.partners.clientsEmptyBody')} />
        ) : (
          <ul className="space-y-2">
            {clients.data.map((g) => (
              <li key={g.id} className="rounded-md border border-border p-2 text-xs flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{g.customerOrganizationName}</p>
                  <p className="text-muted-foreground">
                    {t('app.integrations.partners.clientLine', { role: roleLabel(g.accessRole), when: formatDate(g.expiresAt) })}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <GrantStatus g={g} />
                  {g.status === 'ACTIVE' && (
                    <Button variant="secondary" onClick={() => switchTenant(g.customerOrganizationId, '/projects')}>
                      <ArrowRightLeft className="size-3.5" aria-hidden="true" /> {t('app.integrations.partners.workInClient')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
