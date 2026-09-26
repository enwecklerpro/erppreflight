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
import { errorMessage, resetPassword, validateResetToken } from '@/lib/account-api';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

const schema = z
  .object({ password: PasswordSchema, confirm: z.string().min(1, 'Please confirm the new password') })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] });

function ResetPasswordForm() {
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
      <Notice tone="error" title="Invalid reset link">
        This link is incomplete. <Link className="underline font-semibold" href="/forgot-password">Request a new one</Link>.
      </Notice>
    );
  }
  if (validation.isPending) {
    return <SectionSkeleton rows={3} label="Checking your reset link" />;
  }
  if (validation.isError) {
    return (
      <div className="space-y-4">
        <Notice tone="error" title="Could not check the link">{errorMessage(validation.error)}</Notice>
        <button type="button" className={buttonClass.secondary} onClick={() => validation.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!validation.data.valid && !done) {
    return (
      <Notice tone="warning" title="Link expired or already used">
        Reset links are valid for 60 minutes and can be used once.{' '}
        <Link className="underline font-semibold" href="/forgot-password">Request a new link</Link>.
      </Notice>
    );
  }
  if (done) {
    return (
      <div className="space-y-5">
        <Notice tone="success" title="Password changed">
          Your password was reset and every existing session was signed out.
        </Notice>
        <Link href="/login" className={`${buttonClass.primary} w-full`}>
          Sign in with your new password
        </Link>
      </div>
    );
  }

  return (
    <>
      {mutation.isError && (
        <Notice tone="error" title="Password not changed" className="mb-5">
          {errorMessage(mutation.error)}
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
              label="New password"
              description={`At least ${PASSWORD_MIN_LENGTH} characters with three of: lower-case, upper-case, digit, symbol.`}
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
            <FormField id="reset-confirm" name={field.name} label="Confirm new password" required error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}>
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
              <Pending busy={isSubmitting || mutation.isPending} busyLabel="Saving..." idle="Set new password" />
            </button>
          )}
        />
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthCard title="Choose a new password" subtitle="Resetting signs you out on every device." icon={KeyRound}>
      <React.Suspense fallback={<SectionSkeleton rows={3} label="Loading" />}>
        <ResetPasswordForm />
      </React.Suspense>
    </AuthCard>
  );
}
