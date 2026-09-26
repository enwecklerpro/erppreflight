'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { AuthCard, Notice, SectionSkeleton, buttonClass } from '@/components/account/ui';
import { accountKeys, errorMessage, verifyEmail } from '@/lib/account-api';
import { getStoredAuthToken } from '@/lib/api/custom-instance';
import { ResendVerificationButton } from '@/components/account/resend-verification-button';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Verification runs as an explicit POST from the page (not on GET of the e-mail link),
 * so link scanners that prefetch URLs cannot consume the single-use token.
 */
function VerifyEmail() {
  const token = useSearchParams().get('token') || '';
  const queryClient = useQueryClient();
  const started = React.useRef(false);
  const [signedIn, setSignedIn] = React.useState(false);
  const mutation = useMutation({
    mutationFn: () => verifyEmail(token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.me }),
  });

  React.useEffect(() => {
    setSignedIn(!!getStoredAuthToken());
    if (!started.current && TOKEN_RE.test(token)) {
      started.current = true;
      mutation.mutate();
    }
  }, [token, mutation]);

  if (!TOKEN_RE.test(token)) {
    return (
      <Notice tone="error" title="Invalid verification link">
        The link is incomplete. Open the most recent verification e-mail or request a new one.
      </Notice>
    );
  }
  if (mutation.isIdle || mutation.isPending) {
    return <SectionSkeleton rows={2} label="Verifying your e-mail address" />;
  }
  if (mutation.isError) {
    return (
      <div className="space-y-4">
        <Notice tone="error" title="Verification failed">{errorMessage(mutation.error)}</Notice>
        {signedIn ? (
          <ResendVerificationButton />
        ) : (
          <Link href="/login" className={buttonClass.secondary}>
            Sign in to request a new link
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Notice tone="success" title="E-mail verified">
        <strong>{mutation.data.email}</strong> is verified. Analyses and report exports are now unlocked.
      </Notice>
      <Link href={signedIn ? '/projects' : '/login'} className={`${buttonClass.primary} w-full`}>
        {signedIn ? 'Continue to projects' : 'Sign in'}
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthCard title="Verify your e-mail address" icon={MailCheck}>
      <React.Suspense fallback={<SectionSkeleton rows={2} label="Loading" />}>
        <VerifyEmail />
      </React.Suspense>
    </AuthCard>
  );
}
