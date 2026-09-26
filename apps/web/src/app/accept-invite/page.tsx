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
  accountKeys,
  acceptInvitation,
  acceptInvitationWithNewAccount,
  fetchMe,
  previewInvitation,
  storeSession,
  type SessionResponse,
} from '@/lib/account-api';
import { hasAuthHint } from '@/lib/api/custom-instance';
import { evictTenantQueryCache } from '@/lib/query/query-provider';
import { useErrorText, useFmt, useRichT, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';
import { useRoleLabel } from '@/components/account/role-label';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const newAccountSchema = z
  .object({
    fullName: z.string().max(255),
    password: PasswordSchema,
    confirm: z.string().min(1, vmsg('app.validation.confirmPasswordRequired')),
  })
  .refine((v) => v.password === v.confirm, { message: vmsg('app.validation.passwordsMismatch'), path: ['confirm'] });

function AcceptInvite() {
  const t = useT();
  const rt = useRichT();
  const fmt = useFmt();
  const errText = useErrorText();
  const roleLabel = useRoleLabel();
  const token = useSearchParams().get('token') || '';
  const router = useRouter();
  const queryClient = useQueryClient();
  const valid = TOKEN_RE.test(token);
  const [hasToken, setHasToken] = React.useState(false);
  // A sign-in may exist (HttpOnly cookie): confirm it with /auth/me.
  React.useEffect(() => setHasToken(hasAuthHint()), []);

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
    return <Notice tone="error" title={t('app.auth.invite.invalidTitle')}>{t('app.auth.invite.invalidBody')}</Notice>;
  }
  if (preview.isPending) return <SectionSkeleton rows={3} label={t('app.auth.invite.loading')} />;
  if (preview.isError) {
    return (
      <Notice tone="warning" title={t('app.auth.invite.unavailableTitle')}>
        {errText(preview.error)} {t('app.auth.invite.unavailableHint')}
      </Notice>
    );
  }

  const inv = preview.data;
  const signedInEmail = me.data?.email?.toLowerCase();
  const matches = signedInEmail === inv.email.toLowerCase();
  const nextUrl = `/accept-invite?token=${encodeURIComponent(token)}`;
  const inviteVars = { email: inv.email, role: roleLabel(inv.role), date: fmt.date(inv.expiresAt), b: (c: React.ReactNode) => <strong>{c}</strong> };

  return (
    <div className="space-y-5">
      <Notice tone="info" title={t('app.auth.invite.joinTitle', { organization: inv.organizationName })}>
        {inv.invitedBy
          ? rt('app.auth.invite.invitedByRich', { ...inviteVars, inviter: inv.invitedBy })
          : rt('app.auth.invite.invitedRich', inviteVars)}
      </Notice>

      {hasToken && me.isPending && <SectionSkeleton rows={1} label={t('app.auth.invite.checkingSession')} />}

      {hasToken && me.data && (
        matches ? (
          <>
            {acceptExisting.isError && <Notice tone="error" title={t('app.auth.invite.joinFailed')}>{errText(acceptExisting.error)}</Notice>}
            <button type="button" className={`${buttonClass.primary} w-full`} disabled={acceptExisting.isPending} onClick={() => acceptExisting.mutate()}>
              <Pending busy={acceptExisting.isPending} busyLabel={t('app.auth.invite.joining')} idle={t('app.auth.invite.join', { organization: inv.organizationName })} />
            </button>
          </>
        ) : (
          <Notice tone="warning" title={t('app.auth.invite.otherAccountTitle')}>
            {rt('app.auth.invite.otherAccountRich', { current: me.data.email ?? '', email: inv.email, b: (c) => <strong>{c}</strong> })}
          </Notice>
        )
      )}

      {(!hasToken || me.isError) && inv.accountExists && (
        <Link href={`/login?next=${encodeURIComponent(nextUrl)}`} className={`${buttonClass.primary} w-full`}>
          {t('app.auth.invite.signInToAccept', { email: inv.email })}
        </Link>
      )}

      {(!hasToken || me.isError) && !inv.accountExists && (
        <>
          {acceptNew.isError && <Notice tone="error" title={t('app.auth.invite.accountFailed')}>{errText(acceptNew.error)}</Notice>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            noValidate
            className="space-y-4"
          >
            <p className="text-sm text-muted-foreground">
              {rt('app.auth.invite.createForRich', { email: inv.email, b: (c) => <strong>{c}</strong> })}
            </p>
            <form.Field
              name="fullName"
              children={(field) => (
                <FormField id="invite-name" name={field.name} label={t('app.auth.invite.fullName')} error={field.state.meta.errors as any}>
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
                  label={t('app.auth.password')}
                  description={t('app.auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}
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
                <FormField id="invite-confirm" name={field.name} label={t('app.auth.invite.confirmPassword')} required error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}>
                  <FormInput type="password" autoComplete="new-password" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} leftIcon={<Lock className="size-4" />} />
                </FormField>
              )}
            />
            <form.Subscribe
              selector={(s) => s.isSubmitting}
              children={(isSubmitting) => (
                <button type="submit" disabled={isSubmitting || acceptNew.isPending} className={`${buttonClass.primary} w-full`}>
                  <Pending busy={isSubmitting || acceptNew.isPending} busyLabel={t('app.auth.invite.creating')} idle={t('app.auth.invite.submit')} />
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
  const t = useT();
  return (
    <AuthCard title={t('app.auth.invite.title')} icon={UserPlus}>
      <React.Suspense fallback={<SectionSkeleton rows={3} label={t('app.auth.loading')} />}>
        <AcceptInvite />
      </React.Suspense>
    </AuthCard>
  );
}
