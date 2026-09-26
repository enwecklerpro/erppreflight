'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { KeyRound, Mail, ArrowLeft } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { AuthCard, Notice, Pending, buttonClass } from '@/components/account/ui';
import { errorMessage, requestPasswordReset } from '@/lib/account-api';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Please enter a valid email address'),
});

export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const mutation = useMutation({ mutationFn: (email: string) => requestPasswordReset(email) });

  const form = useForm({
    defaultValues: { email: '' },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      await mutation.mutateAsync(email).then(() => setSentTo(email)).catch(() => undefined);
    },
  });

  return (
    <AuthCard
      title="Reset your password"
      subtitle="We will e-mail you a single-use link that is valid for 60 minutes."
      icon={KeyRound}
    >
      {sentTo ? (
        <div className="space-y-5">
          <Notice tone="success" title="Check your inbox">
            If an account exists for <strong>{sentTo}</strong>, a password reset link is on its way. For your
            security we do not reveal whether an address is registered.
          </Notice>
          <button
            type="button"
            className={`${buttonClass.secondary} w-full`}
            onClick={() => {
              setSentTo(null);
              form.reset();
            }}
          >
            Send to a different address
          </button>
        </div>
      ) : (
        <>
          {mutation.isError && (
            <Notice tone="error" title="Request failed" className="mb-5">
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
              name="email"
              children={(field) => (
                <FormField id="forgot-email" name={field.name} label="Account email" required error={field.state.meta.errors as any}>
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
            <form.Subscribe
              selector={(s) => s.isSubmitting}
              children={(isSubmitting) => (
                <button type="submit" disabled={isSubmitting || mutation.isPending} className={`${buttonClass.primary} w-full`}>
                  <Pending busy={isSubmitting || mutation.isPending} busyLabel="Sending..." idle="Send reset link" />
                </button>
              )}
            />
          </form>
        </>
      )}
      <div className="mt-6 pt-5 border-t border-border text-center text-xs">
        <Link href="/login" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs">
          <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to sign in
        </Link>
      </div>
    </AuthCard>
  );
}
