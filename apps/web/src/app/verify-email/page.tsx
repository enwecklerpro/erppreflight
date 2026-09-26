'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { AuthCard, Notice, SectionSkeleton, buttonClass } from '@/components/account/ui';
import { accountKeys, verifyEmail } from '@/lib/account-api';
import { useErrorText, useRichT, useT } from '@/i18n/client';
import { hasAuthHint } from '@/lib/api/custom-instance';
import { ResendVerificationButton } from '@/components/account/resend-verification-button';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Verification runs as an explicit POST from the page (not on GET of the e-mail link),
 * so link scanners that prefetch URLs cannot consume the single-use token.
 */
function VerifyEmail() {
  const t = useT();
  const rt = useRichT();
  const errText = useErrorText();
  const token = useSearchParams().get('token') || '';
  const queryClient = useQueryClient();
  const started = React.useRef(false);
  const [signedIn, setSignedIn] = React.useState(false);
  const mutation = useMutation({
    mutationFn: () => verifyEmail(token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.me }),
  });

  React.useEffect(() => {
    setSignedIn(hasAuthHint());
    if (!started.current && TOKEN_RE.test(token)) {
      started.current = true;
      mutation.mutate();
    }
  }, [token, mutation]);

  if (!TOKEN_RE.test(token)) {
    return (
      <Notice tone="error" title={t('app.auth.verify.invalidTitle')}>
        {t('app.auth.verify.invalidBody')}
      </Notice>
    );
  }
  if (mutation.isIdle || mutation.isPending) {
    return <SectionSkeleton rows={2} label={t('app.auth.verify.verifying')} />;
  }
  if (mutation.isError) {
    return (
      <div className="space-y-4">
        <Notice tone="error" title={t('app.auth.verify.failed')}>{errText(mutation.error)}</Notice>
        {signedIn ? (
          <ResendVerificationButton />
        ) : (
          <Link href="/login" className={buttonClass.secondary}>
            {t('app.auth.verify.signInForNew')}
          </Link>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <Notice tone="success" title={t('app.auth.verify.doneTitle')}>
        {rt('app.auth.verify.doneRich', { email: mutation.data.email, b: (c) => <strong>{c}</strong> })}
      </Notice>
      <Link href={signedIn ? '/projects' : '/login'} className={`${buttonClass.primary} w-full`}>
        {signedIn ? t('app.auth.verify.continue') : t('app.auth.verify.signIn')}
      </Link>
    </div>
  );
}

export default function VerifyEmailPage() {
  const t = useT();
  return (
    <AuthCard title={t('app.auth.verify.title')} icon={MailCheck}>
      <React.Suspense fallback={<SectionSkeleton rows={2} label={t('app.auth.loading')} />}>
        <VerifyEmail />
      </React.Suspense>
    </AuthCard>
  );
}
