'use client';

import * as React from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Crown, LogOut, Mail, MailPlus, RotateCw, ShieldCheck, ShieldOff, Trash2, Users, XCircle } from 'lucide-react';
import { InvitableRoleEnum } from '@erppreflight/schemas';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect } from '@/components/form/form-inputs';
import { SettingsNav } from '@/components/settings/settings-nav';
import { Notice, Pending, SectionSkeleton, SettingsSection, buttonClass } from '@/components/account/ui';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useLogout } from '@/lib/query/query-provider';
import {
  accountKeys,
  createInvitation,
  fetchInvitations,
  fetchMe,
  fetchMembers,
  leaveOrganization,
  removeMember,
  resendInvitation,
  revokeInvitation,
  transferOwnership,
  updateMemberRole,
  type Invitation,
  type Member,
} from '@/lib/account-api';
import { useErrorText, useFmt, useLabel, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';
import { useRoleLabel } from '@/components/account/role-label';

const ADMIN_ROLES = new Set(['ORGANIZATION_OWNER', 'SECURITY_ADMIN']);

const inviteSchema = z.object({
  email: z.string().trim().min(1, vmsg('app.validation.emailRequired')).email(vmsg('app.validation.emailInvalid')),
  role: InvitableRoleEnum,
});

/** Text + icon status (never color alone). */
function StatusBadge({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  const Icon = ok ? ShieldCheck : ShieldOff;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
      <Icon className="size-3" aria-hidden="true" />
      {ok ? okLabel : badLabel}
    </span>
  );
}

/** Role options for selects, labelled in the active language. */
function useRoleOptions() {
  const roleLabel = useRoleLabel();
  return InvitableRoleEnum.options.map((r) => ({ value: r, label: roleLabel(r) }));
}

function InviteForm({ canInviteOwner }: { canInviteOwner: boolean }) {
  const t = useT();
  const errText = useErrorText();
  const roleOptions = useRoleOptions();
  const queryClient = useQueryClient();
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof inviteSchema>) => createInvitation(v.email.trim(), v.role),
    onSuccess: (inv) => {
      setSentTo(inv.email);
      queryClient.invalidateQueries({ queryKey: accountKeys.invitations });
    },
  });
  const form = useForm({
    defaultValues: { email: '', role: 'VIEWER' as z.infer<typeof InvitableRoleEnum> },
    validators: { onChange: inviteSchema, onSubmit: inviteSchema },
    onSubmit: async ({ value }) => {
      setSentTo(null);
      await mutation.mutateAsync(value).then(() => form.reset()).catch(() => undefined);
    },
  });
  const isDirty = useStore(form.store, (s) => s.isDirty);
  useUnsavedChangesGuard({ isDirty, isSubmitting: mutation.isPending });

  return (
    <div className="space-y-3">
      {sentTo && <Notice tone="success">{t('app.members.inviteSent', { email: sentTo })}</Notice>}
      {mutation.isError && <Notice tone="error" title={t('app.members.inviteFailed')}>{errText(mutation.error)}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        noValidate
        className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] items-end"
      >
        <form.Field
          name="email"
          children={(f) => (
            <FormField id="invite-email" name={f.name} label={t('app.members.emailLabel')} required error={f.state.meta.isTouched ? (f.state.meta.errors as any) : undefined}>
              <FormInput type="email" autoComplete="off" placeholder={t('app.members.emailPlaceholder')} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Mail className="size-4" />} />
            </FormField>
          )}
        />
        <form.Field
          name="role"
          children={(f) => (
            <FormField id="invite-role" name={f.name} label={t('app.members.roleLabel')} required error={f.state.meta.errors as any}>
              <FormSelect
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value as any)}
                options={roleOptions.filter((o) => canInviteOwner || o.value !== 'ORGANIZATION_OWNER')}
              />
            </FormField>
          )}
        />
        <button type="submit" disabled={mutation.isPending} className={buttonClass.primary}>
          <Pending busy={mutation.isPending} busyLabel={t('app.members.sending')} idle={<><MailPlus className="size-3.5" aria-hidden="true" /> {t('app.members.sendInvite')}</>} />
        </button>
      </form>
    </div>
  );
}

function MemberRow({
  member,
  meId,
  myRole,
  ownerCount,
}: {
  member: Member;
  meId: string;
  myRole: string;
  ownerCount: number;
}) {
  const t = useT();
  const errText = useErrorText();
  const roleLabel = useRoleLabel();
  const roleOptions = useRoleOptions();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: accountKeys.members });
  const roleMutation = useMutation({ mutationFn: (role: string) => updateMemberRole(member.id, role), onSuccess: invalidate });
  const removeMutation = useMutation({ mutationFn: () => removeMember(member.id), onSuccess: invalidate });
  const transferMutation = useMutation({
    mutationFn: () => transferOwnership(member.id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: accountKeys.me });
    },
  });
  const isSelf = member.userId === meId;
  const isOwner = member.role === 'ORGANIZATION_OWNER';
  const iAmOwner = myRole === 'ORGANIZATION_OWNER';
  const canManage = ADMIN_ROLES.has(myRole) && !isSelf && (!isOwner || iAmOwner);
  const lastOwner = isOwner && ownerCount <= 1;
  const error = roleMutation.error || removeMutation.error || transferMutation.error;

  return (
    <tr className="border-t border-border align-top">
      <td className="py-3 pr-3">
        <p className="text-sm font-semibold text-foreground break-all">
          {member.fullName || member.email} {isSelf && <span className="text-muted-foreground font-normal">{t('app.members.you')}</span>}
        </p>
        <p className="text-xs text-muted-foreground break-all">{member.email}</p>
        {error && <p role="alert" className="mt-1 text-xs text-destructive">{errText(error)}</p>}
      </td>
      <td className="py-3 pr-3">
        {canManage ? (
          <label className="sr-only" htmlFor={`role-${member.id}`}>
            {t('app.members.roleOf', { email: member.email })}
          </label>
        ) : null}
        {canManage ? (
          <select
            id={`role-${member.id}`}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            value={member.role}
            disabled={roleMutation.isPending || lastOwner}
            onChange={(e) => roleMutation.mutate(e.target.value)}
          >
            {roleOptions.filter((o) => iAmOwner || o.value !== 'ORGANIZATION_OWNER').map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="inline-flex items-center gap-1 text-sm">
            {isOwner && <Crown className="size-3" aria-hidden="true" />}
            {roleLabel(member.role)}
          </span>
        )}
      </td>
      <td className="py-3 pr-3 space-y-1">
        <StatusBadge ok={member.mfaEnabled} okLabel={t('app.members.mfaOn')} badLabel={t('app.members.mfaOff')} />
        <br />
        <StatusBadge ok={member.emailVerified} okLabel={t('app.members.verified')} badLabel={t('app.members.unverified')} />
      </td>
      <td className="py-3 text-right space-x-2 whitespace-nowrap">
        {iAmOwner && !isSelf && (
          <button
            type="button"
            className={buttonClass.secondary}
            disabled={transferMutation.isPending}
            onClick={() => {
              if (window.confirm(t('app.members.makeOwnerConfirm', { email: member.email }))) transferMutation.mutate();
            }}
          >
            <Crown className="size-3.5" aria-hidden="true" /> {t('app.members.makeOwner')}
          </button>
        )}
        {canManage && !lastOwner && (
          <button
            type="button"
            className={buttonClass.danger}
            disabled={removeMutation.isPending}
            aria-label={t('app.members.remove', { email: member.email })}
            onClick={() => {
              if (window.confirm(t('app.members.removeConfirm', { email: member.email }))) removeMutation.mutate();
            }}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </td>
    </tr>
  );
}

export default function MembersPage() {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useErrorText();
  const roleLabel = useRoleLabel();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, retry: false });
  const members = useQuery({ queryKey: accountKeys.members, queryFn: fetchMembers, retry: 1 });
  const myRole = me.data?.role || '';
  const isAdmin = ADMIN_ROLES.has(myRole) || me.data?.systemRole === 'SUPER_ADMIN';
  const invitations = useQuery({ queryKey: accountKeys.invitations, queryFn: fetchInvitations, enabled: isAdmin, retry: 1 });
  const invalidateInvites = () => queryClient.invalidateQueries({ queryKey: accountKeys.invitations });
  const resend = useMutation({ mutationFn: resendInvitation, onSuccess: invalidateInvites });
  const revoke = useMutation({ mutationFn: revokeInvitation, onSuccess: invalidateInvites });
  const leave = useMutation({
    mutationFn: leaveOrganization,
    onSuccess: () => logout('/login'),
  });

  const ownerCount = (members.data || []).filter((m) => m.role === 'ORGANIZATION_OWNER').length;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold tracking-tight mb-1">{t('app.members.title')}</h1>
      <p className="text-sm text-muted-foreground mb-4">{t('app.members.subtitle')}</p>
      <SettingsNav />
      <div className="space-y-6">
        {isAdmin && (
          <SettingsSection id="invite" title={t('app.members.inviteTitle')} icon={MailPlus} description={t('app.members.inviteHint')}>
            <InviteForm canInviteOwner={myRole === 'ORGANIZATION_OWNER' || me.data?.systemRole === 'SUPER_ADMIN'} />
          </SettingsSection>
        )}

        <SettingsSection
          id="members"
          title={t('app.members.membersTitle')}
          icon={Users}
          actions={
            me.data && (
              <button
                type="button"
                className={buttonClass.secondary}
                disabled={leave.isPending}
                onClick={() => {
                  if (window.confirm(t('app.members.leaveConfirm'))) leave.mutate();
                }}
              >
                <LogOut className="size-3.5" aria-hidden="true" /> {t('app.members.leave')}
              </button>
            )
          }
        >
          {leave.isError && <Notice tone="error" title={t('app.members.leaveFailed')}>{errText(leave.error)}</Notice>}
          {members.isPending || me.isPending ? (
            <SectionSkeleton rows={3} label={t('app.members.loading')} />
          ) : members.isError ? (
            <div className="space-y-3">
              <Notice tone="error" title={t('app.members.loadFailed')}>{errText(members.error)}</Notice>
              <button type="button" className={buttonClass.secondary} onClick={() => members.refetch()}>{t('app.ui.retry')}</button>
            </div>
          ) : members.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('app.members.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <caption className="sr-only">{t('app.members.tableCaption')}</caption>
                <thead>
                  <tr className="text-xs uppercase text-muted-foreground">
                    <th scope="col" className="pb-2 pr-3 font-semibold">{t('app.members.colMember')}</th>
                    <th scope="col" className="pb-2 pr-3 font-semibold">{t('app.members.colRole')}</th>
                    <th scope="col" className="pb-2 pr-3 font-semibold">{t('app.members.colSecurity')}</th>
                    <th scope="col" className="pb-2 font-semibold text-right">{t('app.members.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {members.data.map((m) => (
                    <MemberRow key={m.id} member={m} meId={me.data?.id || ''} myRole={myRole} ownerCount={ownerCount} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingsSection>

        {isAdmin && (
          <SettingsSection id="invitations" title={t('app.members.invitationsTitle')} icon={Mail}>
            {(resend.isError || revoke.isError) && <Notice tone="error">{errText(resend.error || revoke.error)}</Notice>}
            {invitations.isPending ? (
              <SectionSkeleton rows={2} label={t('app.members.invitationsLoading')} />
            ) : invitations.isError ? (
              <div className="space-y-3">
                <Notice tone="error" title={t('app.members.invitationsFailed')}>{errText(invitations.error)}</Notice>
                <button type="button" className={buttonClass.secondary} onClick={() => invitations.refetch()}>{t('app.ui.retry')}</button>
              </div>
            ) : invitations.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('app.members.invitationsEmpty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {invitations.data.map((inv) => (
                  <li key={inv.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold break-all">{inv.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {roleLabel(inv.role)} · <strong>{label('app.members.invitationStatus', inv.status)}</strong> ·{' '}
                        {t('app.members.expires', { date: fmt.date(inv.expiresAt) })}
                        {inv.invitedBy ? ` · ${t('app.members.invitedBy', { name: inv.invitedBy.fullName || inv.invitedBy.email })}` : ''}
                      </p>
                    </div>
                    {inv.status !== 'ACCEPTED' && (
                      <div className="flex gap-2">
                        <button type="button" className={buttonClass.secondary} disabled={resend.isPending} onClick={() => resend.mutate(inv.id)}>
                          <RotateCw className="size-3.5" aria-hidden="true" /> {t('app.members.resend')}
                        </button>
                        {inv.status === 'PENDING' && (
                          <button type="button" className={buttonClass.danger} disabled={revoke.isPending} onClick={() => revoke.mutate(inv.id)}>
                            <XCircle className="size-3.5" aria-hidden="true" /> {t('app.members.revoke')}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
        )}
        {!isAdmin && me.data && (
          <Notice tone="info">{t('app.members.adminOnly')}</Notice>
        )}
      </div>
    </div>
  );
}
