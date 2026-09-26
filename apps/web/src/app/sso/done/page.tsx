'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { markSignedIn, refreshCsrfToken, setStoredTenantId } from '@/lib/api/custom-instance';
import { fetchMe, safeNextPath } from '@/lib/account-api';
import { evictTenantQueryCache } from '@/lib/query/query-provider';
import { useT } from '@/i18n/client';

/**
 * Landing page of the OIDC flow. The API has already set the HttpOnly session
 * cookie on its callback response; the URL carries only the post-login path. The
 * session (and its organization, the one the IdP belongs to) is confirmed with /auth/me.
 */
export default function SsoDonePage() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
    window.history.replaceState(null, '', window.location.pathname);
    (async () => {
      await evictTenantQueryCache(queryClient);
      // A new identity: never send the previous user's active organization.
      setStoredTenantId(null);
      try {
        const me = await fetchMe();
        markSignedIn({ organizationId: me.organizationId });
        await refreshCsrfToken();
        router.replace(next);
      } catch {
        setError(true);
      }
    })();
  }, [router, queryClient]);

  return (
    <div className="py-16 text-center" role="status" aria-live="polite">
      {error ? (
        <p className="text-sm text-destructive">
          {t('app.auth.sso.incomplete')} <a className="underline" href="/sso">{t('app.auth.sso.back')}</a>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" /> {t('app.auth.sso.completing')}
        </p>
      )}
    </div>
  );
}
