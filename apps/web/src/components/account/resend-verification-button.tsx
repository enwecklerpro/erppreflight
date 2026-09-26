'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { resendVerification } from '@/lib/account-api';
import { useErrorText, useT } from '@/i18n/client';
import { Pending, buttonClass } from './ui';

/** Requests a new verification e-mail (rate-limited server-side: 5 per hour). */
export function ResendVerificationButton({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const errText = useErrorText();
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
          busyLabel={t('app.shell.resend.sending')}
          idle={
            <>
              <Mail className="size-3.5" aria-hidden="true" />
              {mutation.isSuccess ? t('app.shell.resend.sent') : t('app.shell.resend.resend')}
            </>
          }
        />
      </button>
      <span role="status" aria-live="polite" className="text-xs">
        {mutation.isSuccess && t('app.shell.resend.checkInbox', { hours: mutation.data.expiresInHours })}
        {mutation.isError && <span className="text-destructive">{errText(mutation.error)}</span>}
      </span>
    </div>
  );
}
