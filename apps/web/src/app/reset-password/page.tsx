'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Lock, KeyRound } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, PasswordSchema } from '@erppreflight/schemas';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { AuthCard, Notice, Pending, SectionSkeleton, buttonClass } from '@/components/account/ui';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { resetPassword, validateResetToken } from '@/lib/account-api';
import { useErrorText, useRichT, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const schema = z
  .object({ password: PasswordSchema, confirm: z.string().min(1, vmsg('app.validation.confirmPasswordRequired')) })
  .refine((v) => v.password === v.confirm, { message: vmsg('app.validation.passwordsMismatch'), path: ['confirm'] });

function ResetPasswordForm() {
  const t = useT();
  const rt = useRichT();
  const errText = useErrorText();
  const token = useSearchParams().get('token') || '';
  const wellFormed = TOKEN_RE.test(token);
  const [done, setDone] = React.useState(false);

  const validation = useQuery({
    queryKey: ['auth', 'reset-token', token],
    queryFn: () => validateResetToken(token),
    enabled: wellFormed,
    retry: 1,
    staleTime: Infinity,
  });

  const mutation = useMutation({ mutationFn: (password: string) => resetPassword(token, password) });

  const form = useForm({
    defaultValues: { password: '', confirm: '' },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value.password).then(() => setDone(true)).catch(() => undefined);
    },
  });

  const isDirty = useStore(form.store, (s) => s.isDirty);
  useUnsavedChangesGuard({ isDirty: isDirty && !done, isSubmitting: mutation.isPending });

  if (!wellFormed) {
    return (
      <Notice tone="error" title={t('app.auth.reset.invalidTitle')}>
        {rt('app.auth.reset.invalidRich', { link: (c) => <Link className="underline font-semibold" href="/forgot-password">{c}</Link> })}
      </Notice>
    );
  }
  if (validation.isPending) {
    return <SectionSkeleton rows={3} label={t('app.auth.reset.checking')} />;
  }
  if (validation.isError) {
    return (
      <div className="space-y-4">
        <Notice tone="error" title={t('app.auth.reset.checkFailed')}>{errText(validation.error)}</Notice>
        <button type="button" className={buttonClass.secondary} onClick={() => validation.refetch()}>
          {t('app.ui.retry')}
        </button>
      </div>
    );
  }
  if (!validation.data.valid && !done) {
    return (
      <Notice tone="warning" title={t('app.auth.reset.expiredTitle')}>
        {rt('app.auth.reset.expiredRich', { link: (c) => <Link className="underline font-semibold" href="/forgot-password">{c}</Link> })}
      </Notice>
    );
  }
  if (done) {
    return (
      <div className="space-y-5">
        <Notice tone="success" title={t('app.auth.reset.doneTitle')}>
          {t('app.auth.reset.doneBody')}
        </Notice>
        <Link href="/login" className={`${buttonClass.primary} w-full`}>
          {t('app.auth.reset.signInNew')}
        </Link>
      </div>
    );
  }

  return (
    <>
      {mutation.isError && (
        <Notice tone="error" title={t('app.auth.reset.failed')} className="mb-5">
          {errText(mutation.error)}
        </Notice>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        noValidate
        className="space-y-5"
      >
        <form.Field
          name="password"
          children={(field) => (
            <FormField
              id="reset-password"
              name={field.name}
              label={t('app.auth.reset.newPassword')}
              description={t('app.auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}
              required
              error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}
            >
              <FormInput
                type="password"
                autoComplete="new-password"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                leftIcon={<Lock className="size-4" />}
              />
            </FormField>
          )}
        />
        <form.Field
          name="confirm"
          children={(field) => (
            <FormField id="reset-confirm" name={field.name} label={t('app.auth.reset.confirm')} required error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}>
              <FormInput
                type="password"
                autoComplete="new-password"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                leftIcon={<Lock className="size-4" />}
              />
            </FormField>
          )}
        />
        <form.Subscribe
          selector={(s) => s.isSubmitting}
          children={(isSubmitting) => (
            <button type="submit" disabled={isSubmitting || mutation.isPending} className={`${buttonClass.primary} w-full`}>
              <Pending busy={isSubmitting || mutation.isPending} busyLabel={t('app.auth.reset.saving')} idle={t('app.auth.reset.submit')} />
            </button>
          )}
        />
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  const t = useT();
  return (
    <AuthCard title={t('app.auth.reset.title')} subtitle={t('app.auth.reset.subtitle')} icon={KeyRound}>
      <React.Suspense fallback={<SectionSkeleton rows={3} label={t('app.auth.loading')} />}>
        <ResetPasswordForm />
      </React.Suspense>
    </AuthCard>
  );
}
