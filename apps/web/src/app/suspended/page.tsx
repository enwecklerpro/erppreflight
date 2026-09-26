'use client';

import Link from 'next/link';
import { ArrowRight, Ban, CheckCircle2, LifeBuoy, Network, UserCog } from 'lucide-react';
import { useTenantAccessStatus } from '@/components/tenant-access/tenant-access-notice';
import { ErrorState, SkeletonBlock } from '@/components/commercial/states';
import { useFmt, useT } from '@/i18n/client';

const linkClass =
  'inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';

/**
 * Organization access page for members of a suspended organization or requests
 * from outside the organization's IP allowlist (spec 10.2 / 10.7): explains the
 * state (reason, since when) and what the member can still do.
 */
export default function OrganizationAccessPage() {
  const t = useT();
  const fmt = useFmt();
  const status = useTenantAccessStatus(true);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{t('app.tenantAccess.suspendedPage.title')}</h1>
      {status.isPending ? (
        <div role="status" aria-label={t('app.tenantAccess.suspendedPage.loading')} className="space-y-3">
          <SkeletonBlock className="h-32" />
          <SkeletonBlock className="h-40" />
        </div>
      ) : status.isError ? (
        <ErrorState title={t('app.tenantAccess.suspendedPage.loadFailed')} error={status.error} onRetry={() => status.refetch()} />
      ) : (
        (() => {
          const s = status.data;
          const name = s.organizationName ?? s.organizationId;
          const blockedIp = s.ipAllowlist.enforced && !s.ipAllowlist.clientIpAllowed;
          if (!s.suspended && !blockedIp) {
            return (
              <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 space-y-3" data-testid="access-active">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <CheckCircle2 className="size-5" aria-hidden="true" />
                  {t('app.tenantAccess.suspendedPage.activeTitle')}
                </h2>
                <p className="text-sm">{t('app.tenantAccess.suspendedPage.activeBody', { name })}</p>
                <Link href="/dashboard" className={linkClass}>
                  {t('app.tenantAccess.suspendedPage.toDashboard')}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </section>
            );
          }
          return (
            <>
              {s.suspended && (
                <section className="rounded-2xl border-2 border-destructive/50 bg-destructive/5 p-6 space-y-3" data-testid="access-suspended" aria-labelledby="suspended-title">
                  <h2 id="suspended-title" className="flex items-center gap-2 text-lg font-semibold">
                    <Ban className="size-5 text-destructive" aria-hidden="true" />
                    {t('app.tenantAccess.suspendedPage.suspendedTitle', { name })}
                  </h2>
                  {s.suspendedAt && <p className="text-sm text-muted-foreground">{t('app.tenantAccess.suspendedPage.suspendedSince', { date: fmt.dateTime(s.suspendedAt) })}</p>}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('app.tenantAccess.suspendedPage.reasonLabel')}</p>
                    <blockquote className="mt-1 border-l-4 border-destructive/60 pl-3 text-sm whitespace-pre-wrap break-words">
                      {s.suspensionReason || t('app.tenantAccess.suspendedPage.noReason')}
                    </blockquote>
                  </div>
                </section>
              )}
              {blockedIp && (
                <section className="rounded-2xl border-2 border-amber-600/50 bg-amber-500/5 p-6 space-y-2" data-testid="access-ip-blocked" aria-labelledby="blocked-title">
                  <h2 id="blocked-title" className="flex items-center gap-2 text-lg font-semibold">
                    <Network className="size-5" aria-hidden="true" />
                    {t('app.tenantAccess.suspendedPage.blockedTitle')}
                  </h2>
                  <p className="text-sm">
                    {t('app.tenantAccess.suspendedPage.blockedBody', {
                      name,
                      ip: s.ipAllowlist.clientIp ?? t('app.tenantAccess.suspendedPage.unknownIp'),
                    })}
                  </p>
                </section>
              )}
              <section className="rounded-2xl border border-border bg-card p-6 space-y-3" aria-labelledby="still-possible">
                <h2 id="still-possible" className="text-base font-semibold">{t('app.tenantAccess.suspendedPage.stillPossible')}</h2>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>{t('app.tenantAccess.suspendedPage.signIn')}</li>
                  {s.suspended && <li>{t('app.tenantAccess.suspendedPage.exportData')}</li>}
                  {s.suspended && <li>{t('app.tenantAccess.suspendedPage.contactSupport')}</li>}
                </ul>
                {s.suspended && <p className="text-sm text-muted-foreground">{t('app.tenantAccess.suspendedPage.noDataDeleted')}</p>}
                {s.suspended && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link href="/settings/account" className={linkClass}>
                      <UserCog className="size-4" aria-hidden="true" />
                      {t('app.tenantAccess.suspendedPage.openAccount')}
                    </Link>
                    <Link href="/settings/support" className={linkClass}>
                      <LifeBuoy className="size-4" aria-hidden="true" />
                      {t('app.tenantAccess.suspendedPage.openSupport')}
                    </Link>
                  </div>
                )}
              </section>
            </>
          );
        })()
      )}
    </div>
  );
}
