'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSummaryErrors } from '@/components/form/form-inputs';
import { AuthCard, Notice, Pending, buttonClass } from '@/components/account/ui';
import {
  completeSecondFactor,
  errorMessage,
  login,
  safeNextPath,
  storeSession,
  type MfaChallenge,
  type SessionResponse,
} from '@/lib/account-api';
import { evictTenantQueryCache } from '@/lib/query/query-provider';
import { Lock, Mail, ArrowRight, KeyRound, Smartphone } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid work email address'),
  password: z.string().min(1, 'Password is required'),
});

/** Accepts a 6-digit TOTP code or a recovery code (the API checks which one it is). */
const secondFactorSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, 'Enter a 6-digit code or a recovery code (abcde-12345)'),
});

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const next = safeNextPath(searchParams.get('next'));
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [challenge, setChallenge] = React.useState<MfaChallenge | null>(null);
  const [useRecovery, setUseRecovery] = React.useState(false);

  const finish = async (session: SessionResponse) => {
    // A new identity: never show cached data of a previous session/tenant.
    await evictTenantQueryCache(queryClient);
    storeSession(session);
    router.push(next);
  };

  const loginMutation = useMutation({
    mutationFn: (value: z.infer<typeof loginSchema>) => login(value.email.trim(), value.password),
    onSuccess: async (res) => {
      if ('mfaRequired' in res) {
        setChallenge(res);
        return;
      }
      await finish(res);
    },
    onError: (err) => setServerError(errorMessage(err, 'Invalid email or password.')),
  });

  const secondFactorMutation = useMutation({
    mutationFn: (code: string) =>
      completeSecondFactor(challenge!.challengeToken, useRecovery ? { recoveryCode: code.trim() } : { code: code.trim() }),
    onSuccess: finish,
    onError: (err) => setServerError(errorMessage(err, 'Invalid authentication code.')),
  });

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onChange: loginSchema, onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      await loginMutation.mutateAsync(value).catch(() => undefined);
    },
  });

  const codeForm = useForm({
    defaultValues: { code: '' },
    validators: { onSubmit: secondFactorSchema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      await secondFactorMutation.mutateAsync(value.code).catch(() => undefined);
    },
  });

  if (challenge) {
    return (
      <AuthCard
        title="Two-factor authentication"
        subtitle={useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.'}
        icon={Smartphone}
      >
        {serverError && <Notice tone="error" title="Verification failed" className="mb-5">{serverError}</Notice>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            codeForm.handleSubmit();
          }}
          noValidate
          className="space-y-5"
        >
          <codeForm.Field
            name="code"
            children={(field) => (
              <FormField
                id="login-code"
                name={field.name}
                label={useRecovery ? 'Recovery code' : 'Authentication code'}
                required
                error={field.state.meta.errors as any}
              >
                <FormInput
                  autoFocus
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  placeholder={useRecovery ? 'abcde-12345' : '123456'}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  leftIcon={<KeyRound className="size-4" />}
                />
              </FormField>
            )}
          />
          <codeForm.Subscribe
            selector={(s) => s.isSubmitting}
            children={(isSubmitting) => (
              <button type="submit" disabled={isSubmitting || secondFactorMutation.isPending} className={`${buttonClass.primary} w-full`}>
                <Pending busy={isSubmitting || secondFactorMutation.isPending} busyLabel="Verifying..." idle={<>Verify and sign in<ArrowRight className="size-3.5" aria-hidden="true" /></>} />
              </button>
            )}
          />
        </form>
        <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-between text-xs">
          <button
            type="button"
            className="text-primary font-semibold hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs text-left"
            onClick={() => {
              setUseRecovery((v) => !v);
              setServerError(null);
              codeForm.reset();
            }}
          >
            {useRecovery ? 'Use authenticator app code' : 'Use a recovery code instead'}
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs text-left"
            onClick={() => {
              setChallenge(null);
              setServerError(null);
            }}
          >
            Back to sign in
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in to ERP Preflight" subtitle="Enterprise Clean Core, SAP Preflight Analysis & Migration Verification">
      {serverError && <Notice tone="error" title="Authentication Error" className="mb-6">{serverError}</Notice>}

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
          name="email"
          children={(field) => (
            <FormField id="login-email" name={field.name} label="Work Email" required error={field.state.meta.errors as any}>
              <FormInput
                type="email"
                autoComplete="email"
                placeholder="architect@enterprise.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                leftIcon={<Mail className="size-4" />}
              />
            </FormField>
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <FormField id="login-password" name={field.name} label="Password" required error={field.state.meta.errors as any}>
              <FormInput
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                leftIcon={<Lock className="size-4" />}
              />
            </FormField>
          )}
        />

        <div className="flex justify-end -mt-2">
          <Link
            href="/forgot-password"
            className="text-xs font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs"
          >
            Forgot password?
          </Link>
        </div>

        <form.Subscribe
          selector={(state) => ({ fieldMeta: state.fieldMeta, isSubmitting: state.isSubmitting })}
          children={({ fieldMeta, isSubmitting }) => {
            const activeErrors: Array<{ fieldId: string; label: string; error: unknown }> = [];
            if (fieldMeta.email?.errors?.length) {
              activeErrors.push({ fieldId: 'login-email', label: 'Work Email', error: fieldMeta.email.errors });
            }
            if (fieldMeta.password?.errors?.length) {
              activeErrors.push({ fieldId: 'login-password', label: 'Password', error: fieldMeta.password.errors });
            }
            const busy = isSubmitting || loginMutation.isPending;
            return (
              <div className="space-y-4 pt-1">
                {activeErrors.length > 0 && <FormSummaryErrors errors={activeErrors as any} />}
                <button type="submit" disabled={busy} className={`${buttonClass.primary} w-full`}>
                  <Pending busy={busy} busyLabel="Verifying credentials..." idle={<><span>Sign In</span><ArrowRight className="size-3.5" aria-hidden="true" /></>} />
                </button>
              </div>
            );
          }}
        />
      </form>

      <div className="mt-6 pt-5 border-t border-border text-center text-xs text-muted-foreground">
        <span>Don&apos;t have an enterprise workspace? </span>
        <Link
          href="/signup"
          className="font-semibold text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-primary rounded-xs"
        >
          Create account
        </Link>
      </div>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}
