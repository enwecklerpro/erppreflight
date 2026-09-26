'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { setStoredAuthToken, setStoredTenantId } from '@/lib/api/custom-instance';
import { evictTenantQueryCache } from '@/lib/query/query-provider';

/**
 * Landing page of the OIDC flow. The API redirects here with the session token
 * in the URL fragment (never sent to any server); it is moved into storage and
 * removed from the address bar immediately.
 */
export default function SsoDonePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const frag = new URLSearchParams(window.location.hash.slice(1));
    const token = frag.get('token');
    const org = frag.get('org');
    const next = frag.get('next') || '/projects';
    window.history.replaceState(null, '', window.location.pathname);
    if (!token || !org) {
      setError('The sign-in response was incomplete. Please start again.');
      return;
    }
    (async () => {
      await evictTenantQueryCache(queryClient);
      setStoredAuthToken(token);
      setStoredTenantId(org);
      router.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/projects');
    })();
  }, [router, queryClient]);

  return (
    <div className="py-16 text-center" role="status" aria-live="polite">
      {error ? (
        <p className="text-sm text-destructive">
          {error} <a className="underline" href="/sso">Back to SSO sign-in</a>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" /> Completing single sign-on…
        </p>
      )}
    </div>
  );
}
