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
  ROLE_LABELS,
  accountKeys,
  createInvitation,
  errorMessage,
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

const ADMIN_ROLES = new Set(['ORGANIZATION_OWNER', 'SECURITY_ADMIN']);
const ROLE_OPTIONS = InvitableRoleEnum.options.map((r) => ({ value: r, label: ROLE_LABELS[r] ?? r }));

const inviteSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid e-mail address'),
  role: InvitableRoleEnum,
});

/** Text + icon status (never color alone). */
function StatusBadge({ ok, okLabel, badLabel }: { ok: boolean; okLabel: string; badLabel: string }) {
  const Icon = ok ? ShieldCheck : ShieldOff;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
      <Icon className="size-3" aria-hidden="true" />
      {ok ? okLabel : badLabel}
    </span>
  );
}

function invitationStatusLabel(status: Invitation['status']) {
  return { PENDING: 'Pending', ACCEPTED: 'Accepted', REVOKED: 'Revoked', EXPIRED: 'Expired' }[status];
}

function InviteForm({ canInviteOwner }: { canInviteOwner: boolean }) {
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
      {sentTo && <Notice tone="success">Invitation sent to {sentTo}. It expires in 7 days.</Notice>}
      {mutation.isError && <Notice tone="error" title="Invitation not sent">{errorMessage(mutation.error)}</Notice>}
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
            <FormField id="invite-email" name={f.name} label="E-mail address" required error={f.state.meta.isTouched ? (f.state.meta.errors as any) : undefined}>
              <FormInput type="email" autoComplete="off" placeholder="colleague@company.com" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Mail className="size-4" />} />
            </FormField>
          )}
        />
        <form.Field
          name="role"
          children={(f) => (
            <FormField id="invite-role" name={f.name} label="Role" required error={f.state.meta.errors as any}>
              <FormSelect
                value={f.state.value}
                onChange={(e) => f.handleChange(e.target.value as any)}
                options={ROLE_OPTIONS.filter((o) => canInviteOwner || o.value !== 'ORGANIZATION_OWNER')}
              />
            </FormField>
          )}
        />
        <button type="submit" disabled={mutation.isPending} className={buttonClass.primary}>
          <Pending busy={mutation.isPending} busyLabel="Sending..." idle={<><MailPlus className="size-3.5" aria-hidden="true" /> Send invitation</>} />
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
        <p className="text-xs font-semibold text-foreground break-all">
          {member.fullName || member.email} {isSelf && <span className="text-muted-foreground font-normal">(you)</span>}
        </p>
        <p className="text-[11px] text-muted-foreground break-all">{member.email}</p>
        {error && <p role="alert" className="mt-1 text-[11px] text-destructive">{errorMessage(error)}</p>}
      </td>
      <td className="py-3 pr-3">
        {canManage ? (
          <label className="sr-only" htmlFor={`role-${member.id}`}>
            Role of {member.email}
          </label>
        ) : null}
        {canManage ? (
          <select
            id={`role-${member.id}`}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            value={member.role}
            disabled={roleMutation.isPending || lastOwner}
            onChange={(e) => roleMutation.mutate(e.target.value)}
          >
            {ROLE_OPTIONS.filter((o) => iAmOwner || o.value !== 'ORGANIZATION_OWNER').map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs">
            {isOwner && <Crown className="size-3" aria-hidden="true" />}
            {ROLE_LABELS[member.role] ?? member.role}
          </span>
        )}
      </td>
      <td className="py-3 pr-3 space-y-1">
        <StatusBadge ok={member.mfaEnabled} okLabel="2FA on" badLabel="2FA off" />
        <br />
        <StatusBadge ok={member.emailVerified} okLabel="Verified" badLabel="Unverified" />
      </td>
      <td className="py-3 text-right space-x-2 whitespace-nowrap">
        {iAmOwner && !isSelf && (
          <button
            type="button"
            className={buttonClass.secondary}
            disabled={transferMutation.isPending}
            onClick={() => {
              if (window.confirm(`Make ${member.email} the owner? You will become a security admin.`)) transferMutation.mutate();
            }}
          >
            <Crown className="size-3.5" aria-hidden="true" /> Make owner
          </button>
        )}
        {canManage && !lastOwner && (
          <button
            type="button"
            className={buttonClass.danger}
            disabled={removeMutation.isPending}
            aria-label={`Remove ${member.email}`}
            onClick={() => {
              if (window.confirm(`Remove ${member.email} from the organization?`)) removeMutation.mutate();
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
      <h1 className="text-xl font-bold tracking-tight mb-1">Members</h1>
      <p className="text-xs text-muted-foreground mb-4">People with access to this organization and their roles.</p>
      <SettingsNav />
      <div className="space-y-6">
        {isAdmin && (
          <SettingsSection id="invite" title="Invite a member" icon={MailPlus} description="Invitations are single-use links that expire after 7 days.">
            <InviteForm canInviteOwner={myRole === 'ORGANIZATION_OWNER' || me.data?.systemRole === 'SUPER_ADMIN'} />
          </SettingsSection>
        )}

        <SettingsSection
          id="members"
          title="Members"
          icon={Users}
          actions={
            me.data && (
              <button
                type="button"
                className={buttonClass.secondary}
                disabled={leave.isPending}
                onClick={() => {
                  if (window.confirm('Leave this organization? You will lose access to its projects.')) leave.mutate();
                }}
              >
                <LogOut className="size-3.5" aria-hidden="true" /> Leave organization
              </button>
            )
          }
        >
          {leave.isError && <Notice tone="error" title="Could not leave">{errorMessage(leave.error)}</Notice>}
          {members.isPending || me.isPending ? (
            <SectionSkeleton rows={3} label="Loading members" />
          ) : members.isError ? (
            <div className="space-y-3">
              <Notice tone="error" title="Could not load members">{errorMessage(members.error)}</Notice>
              <button type="button" className={buttonClass.secondary} onClick={() => members.refetch()}>Retry</button>
            </div>
          ) : members.data.length === 0 ? (
            <p className="text-xs text-muted-foreground">No members found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <caption className="sr-only">Organization members</caption>
                <thead>
                  <tr className="text-[11px] uppercase text-muted-foreground">
                    <th scope="col" className="pb-2 pr-3 font-semibold">Member</th>
                    <th scope="col" className="pb-2 pr-3 font-semibold">Role</th>
                    <th scope="col" className="pb-2 pr-3 font-semibold">Security</th>
                    <th scope="col" className="pb-2 font-semibold text-right">Actions</th>
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
          <SettingsSection id="invitations" title="Invitations" icon={Mail}>
            {(resend.isError || revoke.isError) && <Notice tone="error">{errorMessage(resend.error || revoke.error)}</Notice>}
            {invitations.isPending ? (
              <SectionSkeleton rows={2} label="Loading invitations" />
            ) : invitations.isError ? (
              <div className="space-y-3">
                <Notice tone="error" title="Could not load invitations">{errorMessage(invitations.error)}</Notice>
                <button type="button" className={buttonClass.secondary} onClick={() => invitations.refetch()}>Retry</button>
              </div>
            ) : invitations.data.length === 0 ? (
              <p className="text-xs text-muted-foreground">No invitations yet. Invite a colleague above.</p>
            ) : (
              <ul className="divide-y divide-border">
                {invitations.data.map((inv) => (
                  <li key={inv.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold break-all">{inv.email}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {ROLE_LABELS[inv.role] ?? inv.role} · <strong>{invitationStatusLabel(inv.status)}</strong> · expires{' '}
                        {new Date(inv.expiresAt).toLocaleDateString()}
                        {inv.invitedBy ? ` · by ${inv.invitedBy.fullName || inv.invitedBy.email}` : ''}
                      </p>
                    </div>
                    {inv.status !== 'ACCEPTED' && (
                      <div className="flex gap-2">
                        <button type="button" className={buttonClass.secondary} disabled={resend.isPending} onClick={() => resend.mutate(inv.id)}>
                          <RotateCw className="size-3.5" aria-hidden="true" /> Resend
                        </button>
                        {inv.status === 'PENDING' && (
                          <button type="button" className={buttonClass.danger} disabled={revoke.isPending} onClick={() => revoke.mutate(inv.id)}>
                            <XCircle className="size-3.5" aria-hidden="true" /> Revoke
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
          <Notice tone="info">Only owners and security admins can invite members or change roles.</Notice>
        )}
      </div>
    </div>
  );
}
