'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, MailCheck, RotateCcw } from 'lucide-react';
import { AuthCard, Notice, Pending, SectionSkeleton, buttonClass } from '@/components/account/ui';
import { SecondFactorStep } from '@/components/account/second-factor-step';
import {
  previewMagicLink,
  safeNextPath,
  storeSession,
  verifyMagicLink,
  type MfaChallenge,
  type SessionResponse,
} from '@/lib/account-api';
import { ApiError, resolveApiUrl } from '@/lib/api/custom-instance';
import { evictTenantQueryCache } from '@/lib/query/query-provider';
import { useErrorText, useFmt, useRichT, useT } from '@/i18n/client';

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Landing page of the e-mail sign-in link. The link is checked (not consumed) on
 * load and only used after an explicit click, so mail scanners that open links
 * cannot burn it. The session arrives as the API's HttpOnly cookie.
 */
function MagicLinkLanding() {
  const t = useT();
  const rt = useRichT();
  const fmt = useFmt();
  const errText = useErrorText();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  // Captured once, then removed from the address bar (history, screenshots, referrers).
  const [token] = React.useState(() => searchParams.get('token') || '');
  const [next] = React.useState(() => safeNextPath(searchParams.get('next')));
  const valid = TOKEN_RE.test(token);
  const [challenge, setChallenge] = React.useState<MfaChallenge | null>(null);

  React.useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const preview = useQuery({
    queryKey: ['auth', 'magic-link', 'preview', token],
    queryFn: () => previewMagicLink(token),
    enabled: valid,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  const finish = async (session: SessionResponse) => {
    await evictTenantQueryCache(queryClient);
    storeSession(session);
    router.replace(next);
  };

  const signIn = useMutation({
    mutationFn: () => verifyMagicLink(token),
    onSuccess: async (res) => {
      if ('mfaRequired' in res) {
        setChallenge(res);
        return;
      }
      await finish(res);
    },
  });

  const requestNew = (
    <Link href="/login?method=link" className={`${buttonClass.primary} w-full`} data-testid="magic-link-request-new">
      <RotateCcw className="size-3.5" aria-hidden="true" />
      {t('app.magicLink.requestNew')}
    </Link>
  );

  const invalid = (
    <div className="space-y-5" data-testid="magic-link-invalid">
      <Notice tone="error" title={t('app.magicLink.invalidTitle')}>
        {t('app.magicLink.invalidBody')}
      </Notice>
      {requestNew}
    </div>
  );

  if (challenge) {
    return <SecondFactorStep challenge={challenge} onSuccess={finish} onCancel={() => router.replace('/login')} />;
  }

  let body: React.ReactNode;
  const signInError = signIn.error;
  if (!valid) {
    body = invalid;
  } else if (signInError instanceof ApiError && signInError.code === 'SSO_REQUIRED') {
    const email = preview.data?.email;
    body = (
      <div className="space-y-5" data-testid="magic-link-sso-required">
        <Notice tone="warning" title={t('app.magicLink.failedTitle')}>
          {t('app.magicLink.ssoRequired')}
        </Notice>
        <a
          href={resolveApiUrl(email ? `/sso/login?email=${encodeURIComponent(email)}` : '/sso/login')}
          className={`${buttonClass.primary} w-full`}
        >
          {t('app.magicLink.continueWithSso')}
        </a>
      </div>
    );
  } else if (signInError instanceof ApiError && (signInError.code === 'MAGIC_LINK_INVALID' || signInError.statusCode === 400)) {
    body = invalid;
  } else if (signInError) {
    body = (
      <div className="space-y-5">
        <Notice tone="error" title={t('app.magicLink.failedTitle')}>
          {errText(signInError, t('app.magicLink.failed'))}
        </Notice>
        {requestNew}
      </div>
    );
  } else if (preview.isPending) {
    body = <SectionSkeleton rows={2} label={t('app.magicLink.checking')} />;
  } else if (preview.isError) {
    body = (
      <div className="space-y-5">
        <Notice tone="error" title={t('app.magicLink.previewFailed')}>
          {errText(preview.error)}
        </Notice>
        <button type="button" className={`${buttonClass.secondary} w-full`} onClick={() => preview.refetch()}>
          {t('app.magicLink.retry')}
        </button>
      </div>
    );
  } else if (!preview.data?.valid) {
    body = invalid;
  } else {
    const busy = signIn.isPending || signIn.isSuccess;
    body = (
      <div className="space-y-5" data-testid="magic-link-ready">
        <Notice tone="info">
          <span className="block">{rt('app.magicLink.signingInAsRich', { email: preview.data.email ?? '', b: (c) => <strong>{c}</strong> })}</span>
          {preview.data.expiresAt && (
            <span className="block mt-1">{t('app.magicLink.expiresAt', { time: fmt.dateTime(preview.data.expiresAt) })}</span>
          )}
        </Notice>
        <button
          type="button"
          className={`${buttonClass.primary} w-full`}
          disabled={busy}
          onClick={() => signIn.mutate()}
          data-testid="magic-link-continue"
        >
          <Pending
            busy={busy}
            busyLabel={t('app.magicLink.signingIn')}
            idle={<>{t('app.magicLink.continue')}<ArrowRight className="size-3.5" aria-hidden="true" /></>}
          />
        </button>
        <p className="text-xs text-muted-foreground text-center">{t('app.magicLink.notYou')}</p>
      </div>
    );
  }

  return (
    <AuthCard title={t('app.magicLink.landingTitle')} icon={MailCheck}>
      {body}
    </AuthCard>
  );
}

export default function MagicLinkPage() {
  return (
    <React.Suspense fallback={null}>
      <MagicLinkLanding />
    </React.Suspense>
  );
}
