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
  ROLE_LABELS,
  accountKeys,
  deleteAccount,
  downloadAccountExport,
  downloadOrganizationExport,
  errorMessage,
  fetchDeletionImpact,
  fetchMe,
  type DeletionImpact,
} from '@/lib/account-api';

const CONFIRMATION = 'DELETE MY ACCOUNT';

function ProfileSection() {
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, retry: false });
  return (
    <SettingsSection id="profile" title="Profile" icon={UserCircle2}>
      {me.isPending ? (
        <SectionSkeleton rows={2} label="Loading profile" />
      ) : me.isError ? (
        <Notice tone="error" title="Could not load your profile">{errorMessage(me.error)}</Notice>
      ) : (
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-semibold break-all">{me.data.fullName || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">E-mail</dt>
            <dd className="font-semibold break-all">{me.data.email}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Role in this organization</dt>
            <dd className="font-semibold">{ROLE_LABELS[me.data.role || ''] ?? me.data.role}</dd>
          </div>
          <div className="sm:col-span-3">
            <dt className="text-muted-foreground">E-mail verification</dt>
            <dd className="mt-1">
              {me.data.emailVerified ? (
                <span className="font-semibold">Verified{me.data.emailVerifiedAt ? ` on ${new Date(me.data.emailVerifiedAt).toLocaleDateString()}` : ''}</span>
              ) : (
                <div className="space-y-2">
                  <p className="font-semibold">Not verified — analyses and report exports are locked until you verify.</p>
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
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, retry: false });
  const account = useMutation({ mutationFn: downloadAccountExport });
  const org = useMutation({ mutationFn: downloadOrganizationExport });
  const canExportOrg = ['ORGANIZATION_OWNER', 'SECURITY_ADMIN'].includes(me.data?.role || '') || me.data?.systemRole === 'SUPER_ADMIN';
  return (
    <SettingsSection
      id="export"
      title="Export your data"
      icon={Download}
      description="GDPR Art. 15/20: download a machine-readable copy of your data."
    >
      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonClass.secondary} disabled={account.isPending} onClick={() => account.mutate()}>
          <Pending busy={account.isPending} busyLabel="Preparing..." idle={<><Download className="size-3.5" aria-hidden="true" /> Personal data (JSON)</>} />
        </button>
        {canExportOrg && (
          <button type="button" className={buttonClass.secondary} disabled={org.isPending} onClick={() => org.mutate()}>
            <Pending busy={org.isPending} busyLabel="Preparing..." idle={<><FileArchive className="size-3.5" aria-hidden="true" /> Organization data (ZIP)</>} />
          </button>
        )}
      </div>
      {account.isSuccess && <Notice tone="success">Downloaded {account.data.fileName}.</Notice>}
      {org.isSuccess && <Notice tone="success">Downloaded {org.data.fileName}.</Notice>}
      {account.isError && <Notice tone="error" title="Export failed">{errorMessage(account.error)}</Notice>}
      {org.isError && <Notice tone="error" title="Organization export failed">{errorMessage(org.error)}</Notice>}
      <p className="text-[11px] text-muted-foreground">
        The personal export contains your profile, security settings (no secrets), memberships, invitations, projects you
        created and your audit activity. The organization export contains members, invitations, projects, file metadata,
        analyses, findings metadata, report metadata and the audit ledger.
      </p>
    </SettingsSection>
  );
}

function DeleteAccountForm({ impact, mfaEnabled }: { impact: DeletionImpact; mfaEnabled: boolean }) {
  const logout = useLogout();
  const schema = z.object({
    password: z.string().min(1, 'Enter your password'),
    code: mfaEnabled
      ? z.string().trim().regex(/^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, 'Enter a 6-digit code or a recovery code')
      : z.string(),
    confirmation: z.literal(CONFIRMATION, { errorMap: () => ({ message: `Type ${CONFIRMATION} to confirm` }) }),
    acknowledgeOrgDeletion: impact.soleOwnerOrganizations.length > 0 ? z.literal(true, { errorMap: () => ({ message: 'Confirm that these organizations will be deleted' }) }) : z.boolean(),
  });
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof schema>) =>
      deleteAccount({
        password: v.password,
        ...(mfaEnabled ? toFactor(v.code) : {}),
        confirmation: v.confirmation,
        confirmOrganizationDeletion: impact.soleOwnerOrganizations.map((o) => o.id),
      }),
    onSuccess: () => logout('/login'),
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
      {mutation.isError && <Notice tone="error" title="Account not deleted">{errorMessage(mutation.error)}</Notice>}
      {impact.soleOwnerOrganizations.length > 0 && (
        <form.Field
          name="acknowledgeOrgDeletion"
          children={(f) => (
            <FormField id="delete-ack" name={f.name} label="Organizations deleted with your account" error={f.state.meta.errors as any}>
              <div className="space-y-2">
                <ul className="list-disc pl-5 text-xs">
                  {impact.soleOwnerOrganizations.map((o) => (
                    <li key={o.id}>
                      <strong>{o.name}</strong> — {o.memberCount} member{o.memberCount === 1 ? '' : 's'}, all projects, files, findings and reports
                    </li>
                  ))}
                </ul>
                <FormCheckbox
                  checked={f.state.value}
                  onChange={(e) => f.handleChange(e.target.checked)}
                  label="I understand these organizations and all their data are permanently deleted"
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
            <FormField id="delete-password" name={f.name} label="Password" required error={f.state.meta.errors as any}>
              <FormInput type="password" autoComplete="current-password" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Lock className="size-4" />} />
            </FormField>
          )}
        />
        {mfaEnabled && (
          <form.Field
            name="code"
            children={(f) => (
              <FormField id="delete-code" name={f.name} label="Authenticator or recovery code" required error={f.state.meta.errors as any}>
                <FormInput autoComplete="one-time-code" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<KeyRound className="size-4" />} />
              </FormField>
            )}
          />
        )}
      </div>
      <form.Field
        name="confirmation"
        children={(f) => (
          <FormField id="delete-confirmation" name={f.name} label={`Type ${CONFIRMATION} to confirm`} required error={f.state.meta.errors as any}>
            <FormInput autoComplete="off" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} />
          </FormField>
        )}
      />
      <button type="submit" disabled={mutation.isPending} className={buttonClass.danger}>
        <Pending busy={mutation.isPending} busyLabel="Deleting..." idle={<><Trash2 className="size-3.5" aria-hidden="true" /> Permanently delete my account</>} />
      </button>
    </form>
  );
}

function DeleteAccountSection() {
  const [open, setOpen] = React.useState(false);
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, retry: false });
  const impact = useQuery({ queryKey: accountKeys.deletionImpact, queryFn: fetchDeletionImpact, enabled: open, retry: 1 });
  return (
    <SettingsSection
      id="delete"
      title="Delete account"
      icon={Trash2}
      description="GDPR Art. 17: your personal data is erased and you are removed from every organization."
    >
      {!open ? (
        <button type="button" className={buttonClass.danger} onClick={() => setOpen(true)}>
          Start account deletion
        </button>
      ) : impact.isPending || me.isPending ? (
        <SectionSkeleton rows={3} label="Checking what will be deleted" />
      ) : impact.isError || me.isError ? (
        <Notice tone="error" title="Could not prepare the deletion">{errorMessage(impact.error || me.error)}</Notice>
      ) : (
        <div className="space-y-4">
          <Notice tone="warning" title="This cannot be undone">
            Your name and e-mail are anonymised, all sessions are signed out and API keys you created are revoked.
            {impact.data.memberships.length > 0 &&
              ` You will leave: ${impact.data.memberships.map((m) => m.name).join(', ')}.`}{' '}
            To keep an organization you own, make another member an owner first (Settings › Members).
          </Notice>
          <DeleteAccountForm impact={impact.data} mfaEnabled={!!me.data.mfaEnabled} />
        </div>
      )}
    </SettingsSection>
  );
}

export default function AccountSettingsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold tracking-tight mb-1">Account &amp; privacy</h1>
      <p className="text-xs text-muted-foreground mb-4">Your profile, data export and account deletion.</p>
      <SettingsNav />
      <div className="space-y-6">
        <ProfileSection />
        <DataExportSection />
        <DeleteAccountSection />
      </div>
    </div>
  );
}
