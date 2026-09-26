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
import { login, safeNextPath, storeSession, type MfaChallenge, type SessionResponse } from '@/lib/account-api';
import { evictTenantQueryCache } from '@/lib/query/query-provider';
import { ApiError, resolveApiUrl } from '@/lib/api/custom-instance';
import { SecondFactorStep } from '@/components/account/second-factor-step';
import { MagicLinkRequest } from '@/components/account/magic-link-request';
import { Lock, Mail, ArrowRight, Send } from 'lucide-react';
import { useErrorText, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const loginSchema = z.object({
  email: z.string().min(1, vmsg('app.validation.emailRequired')).email(vmsg('app.validation.emailInvalid')),
  password: z.string().min(1, vmsg('app.validation.passwordRequired')),
});

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const t = useT();
  const errText = useErrorText();
  const next = safeNextPath(searchParams.get('next'));
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [ssoEmail, setSsoEmail] = React.useState<string | null>(null);
  const [challenge, setChallenge] = React.useState<MfaChallenge | null>(null);
  const [mode, setMode] = React.useState<'password' | 'magic'>(
    searchParams.get('method') === 'link' ? 'magic' : 'password'
  );

  const finish = async (session: SessionResponse) => {
    // A new identity: never show cached data of a previous session/tenant. The
    // session itself is the API's HttpOnly cookie; nothing secret is stored here.
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
    onError: (err, value) => {
      // Organizations that enforce SSO reject password login; offer the IdP route instead.
      if (err instanceof ApiError && err.code === 'SSO_REQUIRED') {
        setSsoEmail(value.email.trim());
        setServerError(t('app.auth.login.ssoRequired'));
        return;
      }
      setSsoEmail(null);
      setServerError(errText(err, t('app.auth.login.invalidCredentials')));
    },
  });

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onChange: loginSchema, onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      await loginMutation.mutateAsync(value).catch(() => undefined);
    },
  });

  if (challenge) {
    return (
      <SecondFactorStep
        challenge={challenge}
        onSuccess={finish}
        onCancel={() => {
          setChallenge(null);
          setServerError(null);
        }}
      />
    );
  }

  if (mode === 'magic') {
    return (
      <MagicLinkRequest
        initialEmail={form.state.values.email}
        next={next}
        onUsePassword={() => {
          setMode('password');
          setServerError(null);
        }}
      />
    );
  }

  return (
    <AuthCard title={t('app.auth.login.title')} subtitle={t('app.auth.login.subtitle')}>
      {serverError && (
        <Notice tone="error" title={t('app.auth.login.errorTitle')} className="mb-6">
          {serverError}
          {ssoEmail && (
            <a
              href={resolveApiUrl(`/sso/login?email=${encodeURIComponent(ssoEmail)}`)}
              className={`${buttonClass.primary} mt-3 w-full`}
              data-testid="login-sso-required"
            >
              {t('app.auth.login.continueWithSso')}
            </a>
          )}
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
          name="email"
          children={(field) => (
            <FormField id="login-email" name={field.name} label={t('app.auth.workEmail')} required error={field.state.meta.errors as any}>
              <FormInput
                type="email"
                autoComplete="email"
                placeholder={t('app.auth.emailPlaceholder')}
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
            <FormField id="login-password" name={field.name} label={t('app.auth.password')} required error={field.state.meta.errors as any}>
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
            {t('app.auth.login.forgot')}
          </Link>
        </div>

        <form.Subscribe
          selector={(state) => ({ fieldMeta: state.fieldMeta, isSubmitting: state.isSubmitting })}
          children={({ fieldMeta, isSubmitting }) => {
            const activeErrors: Array<{ fieldId: string; label: string; error: unknown }> = [];
            if (fieldMeta.email?.errors?.length) {
              activeErrors.push({ fieldId: 'login-email', label: t('app.auth.workEmail'), error: fieldMeta.email.errors });
            }
            if (fieldMeta.password?.errors?.length) {
              activeErrors.push({ fieldId: 'login-password', label: t('app.auth.password'), error: fieldMeta.password.errors });
            }
            const busy = isSubmitting || loginMutation.isPending;
            return (
              <div className="space-y-4 pt-1">
                {activeErrors.length > 0 && <FormSummaryErrors errors={activeErrors as any} />}
                <button type="submit" disabled={busy} className={`${buttonClass.primary} w-full`}>
                  <Pending busy={busy} busyLabel={t('app.auth.login.submitting')} idle={<><span>{t('app.auth.login.submit')}</span><ArrowRight className="size-3.5" aria-hidden="true" /></>} />
                </button>
              </div>
            );
          }}
        />
      </form>

      <div className="mt-5 space-y-3">
        <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          {t('app.magicLink.or')}
          <span className="h-px flex-1 bg-border" />
        </div>
        <button
          type="button"
          data-testid="login-magic-link"
          className={`${buttonClass.secondary} w-full`}
          onClick={() => {
            setMode('magic');
            setServerError(null);
            setSsoEmail(null);
          }}
        >
          <Send className="size-3.5" aria-hidden="true" />
          {t('app.magicLink.requestLink')}
        </button>
      </div>

      <div className="mt-6 pt-5 border-t border-border text-center text-xs text-muted-foreground">
        <span>{t('app.auth.login.noAccount')} </span>
        <Link
          href="/signup"
          className="font-semibold text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-primary rounded-xs"
        >
          {t('app.auth.login.createAccount')}
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
