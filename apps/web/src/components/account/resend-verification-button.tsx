'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { errorMessage, resendVerification } from '@/lib/account-api';
import { Pending, buttonClass } from './ui';

/** Requests a new verification e-mail (rate-limited server-side: 5 per hour). */
export function ResendVerificationButton({ compact = false }: { compact?: boolean }) {
  const mutation = useMutation({ mutationFn: resendVerification });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || mutation.isSuccess}
        className={compact ? buttonClass.secondary : buttonClass.primary}
      >
        <Pending
          busy={mutation.isPending}
          busyLabel="Sending..."
          idle={
            <>
              <Mail className="size-3.5" aria-hidden="true" />
              {mutation.isSuccess ? 'Verification e-mail sent' : 'Resend verification e-mail'}
            </>
          }
        />
      </button>
      <span role="status" aria-live="polite" className="text-xs">
        {mutation.isSuccess && `Check your inbox — the link is valid for ${mutation.data.expiresInHours} hours.`}
        {mutation.isError && <span className="text-destructive">{errorMessage(mutation.error)}</span>}
      </span>
    </div>
  );
}
