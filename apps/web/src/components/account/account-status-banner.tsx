'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { MailWarning, ShieldAlert } from 'lucide-react';
import { accountKeys, fetchCurrentOrganizationDetails, fetchMe } from '@/lib/account-api';
import { ResendVerificationButton } from './resend-verification-button';
import { useRichT } from '@/i18n/client';

/**
 * Account-state banners shown to signed-in users:
 * - e-mail not verified (analyses and exports are locked server-side);
 * - the active organization requires 2FA and the user has not enrolled.
 */
export function AccountStatusBanner({ signedIn }: { signedIn: boolean }) {
  const rt = useRichT();
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, enabled: signedIn, retry: false, staleTime: 30_000 });
  const org = useQuery({
    queryKey: accountKeys.currentOrganization,
    queryFn: fetchCurrentOrganizationDetails,
    enabled: signedIn && !!me.data,
    retry: false,
    staleTime: 60_000,
  });
  if (!signedIn || !me.data) return null;

  const needsVerification = me.data.emailVerified === false;
  const needs2fa = !!org.data?.require_2fa && me.data.mfaEnabled === false && me.data.systemRole !== 'SUPER_ADMIN';
  if (!needsVerification && !needs2fa) return null;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 space-y-2 text-xs">
        {needsVerification && (
          <div role="status" className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
            <p className="flex items-center gap-2">
              <MailWarning className="size-4 shrink-0" aria-hidden="true" />
              <span>{rt('app.shell.banner.verifyRich', { email: me.data.email ?? '', b: (c) => <strong>{c}</strong> })}</span>
            </p>
            <ResendVerificationButton compact />
          </div>
        )}
        {needs2fa && (
          <p role="status" className="flex items-center gap-2">
            <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
            <span>
              {rt('app.shell.banner.twoFactorRich', {
                b: (c) => <strong>{c}</strong>,
                link: (c) => (
                  <Link href="/settings/security" className="font-semibold underline">
                    {c}
                  </Link>
                ),
              })}
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
