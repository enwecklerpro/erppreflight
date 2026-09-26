'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Lock, User, UserPlus } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, PasswordSchema } from '@erppreflight/schemas';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { AuthCard, Notice, Pending, SectionSkeleton, buttonClass } from '@/components/account/ui';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import {
  ROLE_LABELS,
  accountKeys,
  acceptInvitation,
  acceptInvitationWithNewAccount,
  errorMessage,
  fetchMe,
  previewInvitation,
  storeSession,
  type SessionResponse,
} from '@/lib/account-api';
import { getStoredAuthToken } from '@/lib/api/custom-instance';
import { evictTenantQueryCache } from '@/lib/query/query-provider';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const newAccountSchema = z
  .object({
    fullName: z.string().max(255),
    password: PasswordSchema,
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function AcceptInvite() {
  const token = useSearchParams().get('token') || '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const valid = TOKEN_RE.test(token);
  const [hasToken, setHasToken] = React.useState(false);
  React.useEffect(() => setHasToken(!!getStoredAuthToken()), []);

  const preview = useQuery({
    queryKey: ['invitation', 'preview', token],
    queryFn: () => previewInvitation(token),
    enabled: valid,
    retry: false,
  });
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, enabled: hasToken, retry: false });

  const onJoined = async (session: SessionResponse) => {
    // Joining switches into the new tenant: drop every cached query first.
    await evictTenantQueryCache(queryClient);
    storeSession(session);
    router.push('/projects');
  };

  const acceptExisting = useMutation({ mutationFn: () => acceptInvitation(token), onSuccess: onJoined });
  const acceptNew = useMutation({
    mutationFn: (v: z.infer<typeof newAccountSchema>) => acceptInvitationWithNewAccount(token, v.password, v.fullName.trim() || undefined),
    onSuccess: onJoined,
  });

  const form = useForm({
    defaultValues: { fullName: '', password: '', confirm: '' },
    validators: { onChange: newAccountSchema, onSubmit: newAccountSchema },
    onSubmit: async ({ value }) => {
      await acceptNew.mutateAsync(value).catch(() => undefined);
    },
  });
  const isDirty = useStore(form.store, (s) => s.isDirty);
  useUnsavedChangesGuard({ isDirty: isDirty && !acceptNew.isSuccess, isSubmitting: acceptNew.isPending });

  if (!valid) {
    return <Notice tone="error" title="Invalid invitation link">The link is incomplete. Ask the sender to resend the invitation.</Notice>;
  }
  if (preview.isPending) return <SectionSkeleton rows={3} label="Loading invitation" />;
  if (preview.isError) {
    return (
      <Notice tone="warning" title="Invitation unavailable">
        {errorMessage(preview.error)} Ask an administrator of the organization to send a new invitation.
      </Notice>
    );
  }

  const inv = preview.data;
  const signedInEmail = me.data?.email?.toLowerCase();
  const matches = signedInEmail === inv.email.toLowerCase();
  const nextUrl = `/accept-invite?token=${encodeURIComponent(token)}`;

  return (
    <div className="space-y-5">
      <Notice tone="info" title={`Join ${inv.organizationName}`}>
        {inv.invitedBy ? `${inv.invitedBy} invited ` : 'You were invited as '}
        <strong>{inv.email}</strong> as <strong>{ROLE_LABELS[inv.role] ?? inv.role}</strong>. The invitation expires on{' '}
        {new Date(inv.expiresAt).toLocaleDateString()}.
      </Notice>

      {hasToken && me.isPending && <SectionSkeleton rows={1} label="Checking your session" />}

      {hasToken && me.data && (
        matches ? (
          <>
            {acceptExisting.isError && <Notice tone="error" title="Could not join">{errorMessage(acceptExisting.error)}</Notice>}
            <button type="button" className={`${buttonClass.primary} w-full`} disabled={acceptExisting.isPending} onClick={() => acceptExisting.mutate()}>
              <Pending busy={acceptExisting.isPending} busyLabel="Joining..." idle={`Join ${inv.organizationName}`} />
            </button>
          </>
        ) : (
          <Notice tone="warning" title="Signed in with a different account">
            You are signed in as <strong>{me.data.email}</strong>. Sign out and sign in as <strong>{inv.email}</strong> to accept.
          </Notice>
        )
      )}

      {(!hasToken || me.isError) && inv.accountExists && (
        <Link href={`/login?next=${encodeURIComponent(nextUrl)}`} className={`${buttonClass.primary} w-full`}>
          Sign in as {inv.email} to accept
        </Link>
      )}

      {(!hasToken || me.isError) && !inv.accountExists && (
        <>
          {acceptNew.isError && <Notice tone="error" title="Account not created">{errorMessage(acceptNew.error)}</Notice>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            noValidate
            className="space-y-4"
          >
            <p className="text-xs text-muted-foreground">
              Create your account for <strong>{inv.email}</strong>. The address is verified by this invitation.
            </p>
            <form.Field
              name="fullName"
              children={(field) => (
                <FormField id="invite-name" name={field.name} label="Full name" error={field.state.meta.errors as any}>
                  <FormInput autoComplete="name" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} leftIcon={<User className="size-4" />} />
                </FormField>
              )}
            />
            <form.Field
              name="password"
              children={(field) => (
                <FormField
                  id="invite-password"
                  name={field.name}
                  label="Password"
                  description={`At least ${PASSWORD_MIN_LENGTH} characters with three of: lower-case, upper-case, digit, symbol.`}
                  required
                  error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}
                >
                  <FormInput type="password" autoComplete="new-password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} leftIcon={<Lock className="size-4" />} />
                </FormField>
              )}
            />
            <form.Field
              name="confirm"
              children={(field) => (
                <FormField id="invite-confirm" name={field.name} label="Confirm password" required error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}>
                  <FormInput type="password" autoComplete="new-password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} leftIcon={<Lock className="size-4" />} />
                </FormField>
              )}
            />
            <form.Subscribe
              selector={(s) => s.isSubmitting}
              children={(isSubmitting) => (
                <button type="submit" disabled={isSubmitting || acceptNew.isPending} className={`${buttonClass.primary} w-full`}>
                  <Pending busy={isSubmitting || acceptNew.isPending} busyLabel="Creating account..." idle="Create account and join" />
                </button>
              )}
            />
          </form>
        </>
      )}
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <AuthCard title="Organization invitation" icon={UserPlus}>
      <React.Suspense fallback={<SectionSkeleton rows={3} label="Loading" />}>
        <AcceptInvite />
      </React.Suspense>
    </AuthCard>
  );
}
