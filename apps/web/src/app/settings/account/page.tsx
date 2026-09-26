'use client';

import * as React from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Download, FileArchive, KeyRound, Lock, Trash2, UserCircle2 } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormCheckbox, FormInput } from '@/components/form/form-inputs';
import { SettingsNav } from '@/components/settings/settings-nav';
import { Notice, Pending, SectionSkeleton, SettingsSection, buttonClass } from '@/components/account/ui';
import { ResendVerificationButton } from '@/components/account/resend-verification-button';
import { toFactor } from '@/components/account/two-factor-panel';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useLogout } from '@/lib/query/query-provider';
import {
  accountKeys,
  deleteAccount,
  downloadAccountExport,
  downloadOrganizationExport,
  fetchDeletionImpact,
  fetchMe,
  type DeletionImpact,
} from '@/lib/account-api';
import { useErrorText, useFmt, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';
import { useRoleLabel } from '@/components/account/role-label';

const CONFIRMATION = 'DELETE MY ACCOUNT';

function ProfileSection() {
  const t = useT();
  const fmt = useFmt();
  const errText = useErrorText();
  const roleLabel = useRoleLabel();
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, retry: false });
  return (
    <SettingsSection id="profile" title={t('app.account.profile.title')} icon={UserCircle2}>
      {me.isPending ? (
        <SectionSkeleton rows={2} label={t('app.account.profile.loading')} />
      ) : me.isError ? (
        <Notice tone="error" title={t('app.account.profile.loadFailed')}>{errText(me.error)}</Notice>
      ) : (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{t('app.account.profile.name')}</dt>
            <dd className="font-semibold break-all">{me.data.fullName || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('app.account.profile.email')}</dt>
            <dd className="font-semibold break-all">{me.data.email}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('app.account.profile.role')}</dt>
            <dd className="font-semibold">{me.data.role ? roleLabel(me.data.role) : '—'}</dd>
          </div>
          <div className="sm:col-span-3">
            <dt className="text-muted-foreground">{t('app.account.profile.verification')}</dt>
            <dd className="mt-1">
              {me.data.emailVerified ? (
                <span className="font-semibold">
                  {me.data.emailVerifiedAt ? t('app.account.profile.verifiedOn', { date: fmt.date(me.data.emailVerifiedAt) }) : t('app.account.profile.verified')}
                </span>
              ) : (
                <div className="space-y-2">
                  <p className="font-semibold">{t('app.account.profile.notVerified')}</p>
                  <ResendVerificationButton compact />
                </div>
              )}
            </dd>
          </div>
        </dl>
      )}
    </SettingsSection>
  );
}

function DataExportSection() {
  const t = useT();
  const errText = useErrorText();
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, retry: false });
  const account = useMutation({ mutationFn: downloadAccountExport });
  const org = useMutation({ mutationFn: downloadOrganizationExport });
  const canExportOrg = ['ORGANIZATION_OWNER', 'SECURITY_ADMIN'].includes(me.data?.role || '') || me.data?.systemRole === 'SUPER_ADMIN';
  return (
    <SettingsSection
      id="export"
      title={t('app.account.export.title')}
      icon={Download}
      description={t('app.account.export.hint')}
    >
      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonClass.secondary} disabled={account.isPending} onClick={() => account.mutate()}>
          <Pending busy={account.isPending} busyLabel={t('app.account.export.preparing')} idle={<><Download className="size-3.5" aria-hidden="true" /> {t('app.account.export.personal')}</>} />
        </button>
        {canExportOrg && (
          <button type="button" className={buttonClass.secondary} disabled={org.isPending} onClick={() => org.mutate()}>
            <Pending busy={org.isPending} busyLabel={t('app.account.export.preparing')} idle={<><FileArchive className="size-3.5" aria-hidden="true" /> {t('app.account.export.organization')}</>} />
          </button>
        )}
      </div>
      {account.isSuccess && <Notice tone="success">{t('app.account.export.downloaded', { file: account.data.fileName })}</Notice>}
      {org.isSuccess && <Notice tone="success">{t('app.account.export.downloaded', { file: org.data.fileName })}</Notice>}
      {account.isError && <Notice tone="error" title={t('app.account.export.failed')}>{errText(account.error)}</Notice>}
      {org.isError && <Notice tone="error" title={t('app.account.export.orgFailed')}>{errText(org.error)}</Notice>}
      <p className="text-xs text-muted-foreground">{t('app.account.export.contents')}</p>
    </SettingsSection>
  );
}

function DeleteAccountForm({ impact, mfaEnabled }: { impact: DeletionImpact; mfaEnabled: boolean }) {
  const t = useT();
  const errText = useErrorText();
  const logout = useLogout();
  const schema = z.object({
    password: z.string().min(1, vmsg('app.validation.passwordRequired')),
    code: mfaEnabled
      ? z.string().trim().regex(/^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, vmsg('app.validation.totpOrRecovery'))
      : z.string(),
    confirmation: z.literal(CONFIRMATION, { errorMap: () => ({ message: vmsg('app.validation.typeToConfirm', { word: CONFIRMATION }) }) }),
    acknowledgeOrgDeletion: impact.soleOwnerOrganizations.length > 0 ? z.literal(true, { errorMap: () => ({ message: vmsg('app.validation.confirmOrgDeletion') }) }) : z.boolean(),
  });
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof schema>) =>
      deleteAccount({
        password: v.password,
        ...(mfaEnabled ? toFactor(v.code) : {}),
        confirmation: v.confirmation,
        confirmOrganizationDeletion: impact.soleOwnerOrganizations.map((o) => o.id),
      }),
    // Account deletion ends every session server-side and clears the cookie.
    onSuccess: () => logout('/login', { revokeServerSession: false }),
  });
  const form = useForm({
    defaultValues: { password: '', code: '', confirmation: '', acknowledgeOrgDeletion: false },
    validators: { onSubmit: schema as any },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value as z.infer<typeof schema>).catch(() => undefined);
    },
  });
  const isDirty = useStore(form.store, (s) => s.isDirty);
  useUnsavedChangesGuard({ isDirty, isSubmitting: mutation.isPending });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      noValidate
      className="space-y-4"
    >
      {mutation.isError && <Notice tone="error" title={t('app.account.delete.failed')}>{errText(mutation.error)}</Notice>}
      {impact.soleOwnerOrganizations.length > 0 && (
        <form.Field
          name="acknowledgeOrgDeletion"
          children={(f) => (
            <FormField id="delete-ack" name={f.name} label={t('app.account.delete.orgsLabel')} error={f.state.meta.errors as any}>
              <div className="space-y-2">
                <ul className="list-disc pl-5 text-sm">
                  {impact.soleOwnerOrganizations.map((o) => (
                    <li key={o.id}>
                      <strong>{o.name}</strong> — {t('app.account.delete.orgImpact', { count: o.memberCount })}
                    </li>
                  ))}
                </ul>
                <FormCheckbox
                  checked={f.state.value}
                  onChange={(e) => f.handleChange(e.target.checked)}
                  label={t('app.account.delete.acknowledge')}
                />
              </div>
            </FormField>
          )}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field
          name="password"
          children={(f) => (
            <FormField id="delete-password" name={f.name} label={t('app.account.delete.password')} required error={f.state.meta.errors as any}>
              <FormInput type="password" autoComplete="current-password" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Lock className="size-4" />} />
            </FormField>
          )}
        />
        {mfaEnabled && (
          <form.Field
            name="code"
            children={(f) => (
              <FormField id="delete-code" name={f.name} label={t('app.account.delete.code')} required error={f.state.meta.errors as any}>
                <FormInput autoComplete="one-time-code" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<KeyRound className="size-4" />} />
              </FormField>
            )}
          />
        )}
      </div>
      <form.Field
        name="confirmation"
        children={(f) => (
          <FormField id="delete-confirmation" name={f.name} label={t('app.account.delete.confirmLabel', { phrase: CONFIRMATION })} required error={f.state.meta.errors as any}>
            <FormInput autoComplete="off" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} />
          </FormField>
        )}
      />
      <button type="submit" disabled={mutation.isPending} className={buttonClass.danger}>
        <Pending busy={mutation.isPending} busyLabel={t('app.account.delete.deleting')} idle={<><Trash2 className="size-3.5" aria-hidden="true" /> {t('app.account.delete.submit')}</>} />
      </button>
    </form>
  );
}

function DeleteAccountSection() {
  const t = useT();
  const errText = useErrorText();
  const [open, setOpen] = React.useState(false);
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, retry: false });
  const impact = useQuery({ queryKey: accountKeys.deletionImpact, queryFn: fetchDeletionImpact, enabled: open, retry: 1 });
  return (
    <SettingsSection
      id="delete"
      title={t('app.account.delete.title')}
      icon={Trash2}
      description={t('app.account.delete.hint')}
    >
      {!open ? (
        <button type="button" className={buttonClass.danger} onClick={() => setOpen(true)}>
          {t('app.account.delete.start')}
        </button>
      ) : impact.isPending || me.isPending ? (
        <SectionSkeleton rows={3} label={t('app.account.delete.checking')} />
      ) : impact.isError || me.isError ? (
        <Notice tone="error" title={t('app.account.delete.prepareFailed')}>{errText(impact.error || me.error)}</Notice>
      ) : (
        <div className="space-y-4">
          <Notice tone="warning" title={t('app.account.delete.warningTitle')}>
            {t('app.account.delete.warningBody')}
            {impact.data.memberships.length > 0 &&
              ` ${t('app.account.delete.leaving', { organizations: impact.data.memberships.map((m) => m.name).join(', ') })}`}{' '}
            {t('app.account.delete.keepOrg')}
          </Notice>
          <DeleteAccountForm impact={impact.data} mfaEnabled={!!me.data.mfaEnabled} />
        </div>
      )}
    </SettingsSection>
  );
}

export default function AccountSettingsPage() {
  const t = useT();
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight mb-1">{t('app.account.title')}</h1>
      <p className="text-sm text-muted-foreground mb-4">{t('app.account.subtitle')}</p>
      <SettingsNav />
      <div className="space-y-6">
        <ProfileSection />
        <DataExportSection />
        <DeleteAccountSection />
      </div>
    </div>
  );
}
