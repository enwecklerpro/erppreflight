'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Ban, Network } from 'lucide-react';
import { fetchTenantAccessStatus, tenantAccessKeys, type TenantAccessStatus } from '@/lib/api/tenant-access';
import { useT } from '@/i18n/client';

/** Pages that stay useful while the organization is suspended or the network is blocked. */
const ALLOWED_WHILE_BLOCKED = ['/suspended', '/settings/account', '/settings/support'];

/** Application areas that only show organization data (redirected to /suspended when blocked). */
const TENANT_AREAS = [
  '/dashboard',
  '/projects',
  '/analyze',
  '/reports',
  '/inspector',
  '/templates',
  '/artifacts',
  '/landscapes',
  '/agent-gate',
  '/integrations',
  '/settings',
  '/onboarding',
  '/knowledge-graph',
  '/matrix',
  '/notifications',
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function shouldRedirectToAccessPage(path: string, status: Pick<TenantAccessStatus, 'suspended' | 'ipAllowlist' | 'impersonating'>): boolean {
  if (status.impersonating) return false; // operators may inspect a suspended tenant
  const blocked = status.suspended || (status.ipAllowlist.enforced && !status.ipAllowlist.clientIpAllowed);
  if (!blocked) return false;
  if (ALLOWED_WHILE_BLOCKED.some((p) => under(path, p))) return false;
  return TENANT_AREAS.some((p) => under(path, p));
}

/** Shared query for the caller's organization access state (suspension, IP allowlist). */
export function useTenantAccessStatus(enabled: boolean) {
  return useQuery({
    queryKey: tenantAccessKeys.status,
    queryFn: fetchTenantAccessStatus,
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Banner + navigation guard for members of a suspended organization or requests
 * from outside the organization's IP allowlist (the API answers 403
 * TENANT_SUSPENDED / IP_NOT_ALLOWED). Organization pages redirect to /suspended,
 * which explains the state and what still works.
 */
export function TenantAccessNotice({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  const pathname = usePathname() || '/';
  const router = useRouter();
  const status = useTenantAccessStatus(signedIn);
  const data = status.data;

  React.useEffect(() => {
    if (data && shouldRedirectToAccessPage(pathname, data)) router.replace('/suspended');
  }, [data, pathname, router]);

  if (!signedIn || !data || data.impersonating) return null;
  const name = data.organizationName ?? '';
  const blockedIp = data.ipAllowlist.enforced && !data.ipAllowlist.clientIpAllowed;
  if (!data.suspended && !blockedIp) return null;

  return (
    <div className="border-b border-destructive/40 bg-destructive/10" data-testid="tenant-access-notice">
      <div role="alert" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
        <p className="flex items-start gap-2 min-w-0">
          {data.suspended ? <Ban className="size-4 shrink-0 mt-0.5" aria-hidden="true" /> : <Network className="size-4 shrink-0 mt-0.5" aria-hidden="true" />}
          <span className="min-w-0 break-words">
            <strong>{data.suspended ? t('app.tenantAccess.notice.suspendedTitle') : t('app.tenantAccess.notice.blockedTitle')}</strong>{' '}
            {data.suspended
              ? t('app.tenantAccess.notice.suspendedBody', { name })
              : t('app.tenantAccess.notice.blockedBody', { name, ip: data.ipAllowlist.clientIp ?? t('app.tenantAccess.suspendedPage.unknownIp') })}
          </span>
        </p>
        {pathname !== '/suspended' && (
          <Link href="/suspended" className="self-start sm:self-auto text-xs font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 rounded">
            {t('app.tenantAccess.notice.details')}
          </Link>
        )}
      </div>
    </div>
  );
}
