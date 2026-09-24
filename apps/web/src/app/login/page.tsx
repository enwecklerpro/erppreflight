'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSummaryErrors } from '@/components/form/form-inputs';
import {
  customInstance,
  setStoredAuthToken,
  setStoredTenantId,
  ApiError,
} from '@/lib/api/custom-instance';
import { Lock, Mail, Loader2, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';

const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid work email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

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

export default function LoginPage() {
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
    },
    validators: {
      onChange: loginSchema,
      onSubmit: loginSchema,
    },
    onSubmit: async ({ value }) => {
      setServerError(null);
      try {
        const res = await customInstance<AuthResponse>('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: value.email.trim(),
            password: value.password,
          }),
        });

        if (res?.accessToken) {
          setStoredAuthToken(res.accessToken);
        }
        if (res?.user?.organizationId) {
          setStoredTenantId(res.user.organizationId);
        }

        router.push('/projects');
      } catch (err: unknown) {
        if (err instanceof ApiError) {
          setServerError(err.message);
        } else if (err instanceof Error) {
          setServerError(err.message);
        } else {
          setServerError('Invalid email or password. Please verify your credentials.');
        }
      }
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
          Sign in to ERP Preflight
        </h1>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          Enterprise Clean Core, SAP Preflight Analysis &amp; Migration Verification
        </p>
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
                <p className="font-semibold text-destructive">Authentication Error</p>
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
            className="space-y-5"
          >
            <form.Field
              name="email"
              children={(field) => (
                <FormField
                  id="login-email"
                  name={field.name}
                  label="Work Email"
                  required
                  error={field.state.meta.errors as any}
                >
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
                <FormField
                  id="login-password"
                  name={field.name}
                  label="Password"
                  required
                  error={field.state.meta.errors as any}
                >
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

            <form.Subscribe
              selector={(state) => ({
                fieldMeta: state.fieldMeta,
                isSubmitting: state.isSubmitting,
              })}
              children={({ fieldMeta, isSubmitting }) => {
                const activeErrors: Array<{ fieldId: string; label: string; error: unknown }> = [];
                if (fieldMeta.email?.errors?.length) {
                  activeErrors.push({
                    fieldId: 'login-email',
                    label: 'Work Email',
                    error: fieldMeta.email.errors,
                  });
                }
                if (fieldMeta.password?.errors?.length) {
                  activeErrors.push({
                    fieldId: 'login-password',
                    label: 'Password',
                    error: fieldMeta.password.errors,
                  });
                }

                return (
                  <div className="space-y-4 pt-1">
                    {activeErrors.length > 0 && (
                      <FormSummaryErrors errors={activeErrors} />
                    )}

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          <span>Verifying credentials...</span>
                        </>
                      ) : (
                        <>
                          <span>Sign In</span>
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
            <span>Don&apos;t have an enterprise workspace? </span>
            <Link
              href="/signup"
              className="font-semibold text-primary hover:underline focus:outline-none focus:ring-1 focus:ring-primary rounded-xs"
            >
              Create account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
