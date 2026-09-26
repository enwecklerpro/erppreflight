'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { PASSWORD_MIN_LENGTH, PasswordSchema, passwordPolicyViolations } from '@erppreflight/schemas';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSummaryErrors } from '@/components/form/form-inputs';
import {
  customInstance,
  setStoredAuthToken,
  setStoredTenantId,
} from '@/lib/api/custom-instance';
import {
  Building2,
  Lock,
  Mail,
  User,
  Loader2,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { useErrorText, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const signupSchema = z
  .object({
    organizationName: z
      .string()
      .min(2, vmsg('app.validation.orgNameMin', { min: 2 }))
      .max(100, vmsg('app.validation.orgNameMax', { max: 100 })),
    fullName: z.string(),
    email: z
      .string()
      .min(1, vmsg('app.validation.emailRequired'))
      .email(vmsg('app.validation.emailInvalid')),
    // Same policy the API enforces (shared @erppreflight/schemas contract).
    password: PasswordSchema,
    confirmPassword: z
      .string()
      .min(1, vmsg('app.validation.confirmPasswordRequired')),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: vmsg('app.validation.passwordsMismatch'),
    path: ['confirmPassword'],
  })
  .superRefine((data, ctx) => {
    if (passwordPolicyViolations(data.password, { email: data.email }).includes('Password must not contain your e-mail address')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['password'], message: vmsg('app.validation.passwordContainsEmail') });
    }
  });

type SignupFormData = z.infer<typeof signupSchema>;

interface AuthResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    fullName?: string;
    organizationId: string;
    role: string;
    systemRole: string;
  };
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { evictTenantQueryCache } from '@/lib/query/query-provider';

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const errText = useErrorText();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const signupMutation = useMutation({
    mutationFn: async (value: SignupFormData) => {
      return await customInstance<AuthResponse>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          organizationName: value.organizationName.trim(),
          fullName: value.fullName?.trim() || undefined,
          email: value.email.trim(),
          password: value.password,
        }),
      });
    },
    onSuccess: async (res) => {
      // New identity: drop anything cached while signed out (e.g. a 401 for /auth/me).
      await evictTenantQueryCache(queryClient);
      if (res?.accessToken) {
        setStoredAuthToken(res.accessToken);
      }
      if (res?.user?.organizationId) {
        setStoredTenantId(res.user.organizationId);
      }
      router.push('/projects');
    },
    onError: (err: unknown) => {
      setServerError(errText(err, t('app.auth.signup.failed')));
    },
  });

  const form = useForm({
    defaultValues: {
      organizationName: '',
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
    validators: {
      onChange: signupSchema,
      onSubmit: signupSchema,
    },
    onSubmit: async ({ value }) => {
      setServerError(null);
      signupMutation.mutate(value);
    },
  });

  return (
    <div className="min-h-[calc(100vh-12rem)] flex flex-col justify-center py-8 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
            <ShieldCheck className="size-7" aria-hidden="true" />
          </div>
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-foreground">
          {t('app.auth.signup.title')}
        </h1>
        <p className="mt-1.5 text-center text-sm text-muted-foreground">{t('app.auth.signup.subtitle')}</p>
      </div>

      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-xs">
          {serverError && (
            <div
              role="alert"
              aria-live="polite"
              className="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-destructive text-xs flex items-start gap-2.5 animate-in fade-in-50 duration-200"
            >
              <AlertCircle className="size-4 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
              <div>
                <p className="font-semibold text-destructive">{t('app.auth.signup.errorTitle')}</p>
                <p className="text-destructive/90 mt-0.5">{serverError}</p>
              </div>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            noValidate
            className="space-y-4"
          >
            <form.Field
              name="organizationName"
              children={(field) => (
                <FormField
                  id="signup-org-name"
                  name={field.name}
                  label={t('app.auth.signup.orgName')}
                  required
                  error={field.state.meta.errors as any}
                >
                  <FormInput
                    autoComplete="organization"
                    placeholder={t('app.auth.signup.orgPlaceholder')}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    leftIcon={<Building2 className="size-4" />}
                  />
                </FormField>
              )}
            />

            <form.Field
              name="fullName"
              children={(field) => (
                <FormField
                  id="signup-full-name"
                  name={field.name}
                  label={t('app.auth.signup.fullName')}
                  error={field.state.meta.errors as any}
                >
                  <FormInput
                    autoComplete="name"
                    placeholder={t('app.auth.signup.namePlaceholder')}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    leftIcon={<User className="size-4" />}
                  />
                </FormField>
              )}
            />

            <form.Field
              name="email"
              children={(field) => (
                <FormField
                  id="signup-email"
                  name={field.name}
                  label={t('app.auth.workEmail')}
                  required
                  error={field.state.meta.errors as any}
                >
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
                <FormField
                  id="signup-password"
                  name={field.name}
                  label={t('app.auth.password')}
                  description={t('app.auth.passwordHint', { min: PASSWORD_MIN_LENGTH })}
                  required
                  error={field.state.meta.errors as any}
                >
                  <FormInput
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••••••"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    leftIcon={<Lock className="size-4" />}
                  />
                </FormField>
              )}
            />

            <form.Field
              name="confirmPassword"
              children={(field) => (
                <FormField
                  id="signup-confirm-password"
                  name={field.name}
                  label={t('app.auth.signup.confirmPassword')}
                  required
                  error={field.state.meta.errors as any}
                >
                  <FormInput
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••••••"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    leftIcon={<Lock className="size-4" />}
                  />
                </FormField>
              )}
            />

            <form.Subscribe
              selector={(state) => ({
                fieldMeta: state.fieldMeta,
                isSubmitting: state.isSubmitting,
              })}
              children={({ fieldMeta, isSubmitting }) => {
                const activeErrors: Array<{ fieldId: string; label: string; error: unknown }> = [];
                if (fieldMeta.organizationName?.errors?.length) {
                  activeErrors.push({
                    fieldId: 'signup-org-name',
                    label: t('app.auth.signup.orgName'),
                    error: fieldMeta.organizationName.errors,
                  });
                }
                if (fieldMeta.fullName?.errors?.length) {
                  activeErrors.push({
                    fieldId: 'signup-full-name',
                    label: t('app.auth.signup.fullNameShort'),
                    error: fieldMeta.fullName.errors,
                  });
                }
                if (fieldMeta.email?.errors?.length) {
                  activeErrors.push({
                    fieldId: 'signup-email',
                    label: t('app.auth.workEmail'),
                    error: fieldMeta.email.errors,
                  });
                }
                if (fieldMeta.password?.errors?.length) {
                  activeErrors.push({
                    fieldId: 'signup-password',
                    label: t('app.auth.password'),
                    error: fieldMeta.password.errors,
                  });
                }
                if (fieldMeta.confirmPassword?.errors?.length) {
                  activeErrors.push({
                    fieldId: 'signup-confirm-password',
                    label: t('app.auth.signup.confirmPassword'),
                    error: fieldMeta.confirmPassword.errors,
                  });
                }

                return (
                  <div className="space-y-4 pt-2">
                    {activeErrors.length > 0 && (
                      <FormSummaryErrors errors={activeErrors} />
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting || signupMutation.isPending}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
                    >
                      {isSubmitting || signupMutation.isPending ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          <span>{t('app.auth.signup.submitting')}</span>
                        </>
                      ) : (
                        <>
                          <span>{t('app.auth.signup.submit')}</span>
                          <ArrowRight className="size-3.5" aria-hidden="true" />
                        </>
                      )}
                    </button>
                  </div>
                );
              }}
            />
          </form>

          <div className="mt-6 pt-5 border-t border-border text-center text-xs text-muted-foreground">
            <span>{t('app.auth.signup.haveAccount')} </span>
            <Link
              href="/login"
              className="font-semibold text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-primary rounded-xs"
            >
              {t('app.auth.signup.signIn')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
