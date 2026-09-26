'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, LogOut, ShieldAlert, Timer } from 'lucide-react';
import { endCurrentImpersonation, fetchCurrentImpersonation, tenantAccessKeys } from '@/lib/api/tenant-access';
import { useErrorText, useT } from '@/i18n/client';
import { useRoleLabel } from '@/components/account/role-label';

/** mm:ss (or h:mm:ss) for the countdown. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Leaves the impersonated tenant: every cached query belongs to the impersonated
 * member, so the cache is cancelled and cleared before the operator returns to the
 * admin console with a full navigation (no stale tenant data can render).
 */
function useReturnToAdmin() {
  const queryClient = useQueryClient();
  return React.useCallback(
    async (target = '/admin') => {
      await queryClient.cancelQueries();
      queryClient.clear();
      window.location.assign(target);
    },
    [queryClient]
  );
}

/**
 * Visible banner while a super admin impersonates a tenant member (spec 10.8,
 * C §24): who is impersonated, in which organization, why, read-only or not, a
 * countdown to the hard expiry and an End button. Also shown (with a way back)
 * when the session ended or expired while the page was open.
 */
export function ImpersonationBanner({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  const roleLabel = useRoleLabel();
  const errText = useErrorText();
  const returnToAdmin = useReturnToAdmin();
  const current = useQuery({
    queryKey: tenantAccessKeys.impersonation,
    queryFn: fetchCurrentImpersonation,
    enabled: signedIn,
    retry: false,
    staleTime: 15_000,
    refetchInterval: (q) => (q.state.data?.active ? 30_000 : false),
    refetchOnWindowFocus: true,
  });
  const end = useMutation({
    mutationFn: endCurrentImpersonation,
    onSuccess: (res) => returnToAdmin(res.returnTo || '/admin'),
  });

  const data = current.data;
  const session = data?.active ? data.session : undefined;
  // Server clock offset so the countdown matches the server-side expiry.
  const offset = React.useMemo(() => (data ? new Date(data.serverTime).getTime() - Date.now() : 0), [data]);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session]);

  const remaining = session ? new Date(session.expiresAt).getTime() - (now + offset) : 0;
  const expiredLocally = !!session && remaining <= 0;
  const { refetch } = current;
  React.useEffect(() => {
    if (expiredLocally) void refetch();
  }, [expiredLocally, refetch]);

  if (!signedIn || !data) return null;

  if (!data.active && data.ended) {
    const expired = data.ended.code === 'IMPERSONATION_EXPIRED';
    return (
      <div className="border-b border-amber-600/40 bg-amber-500/15" data-testid="impersonation-ended">
        <div role="status" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm">
          <p className="flex items-center gap-2">
            <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
            <span>
              <strong>{expired ? t('app.tenantAccess.banner.expiredTitle') : t('app.tenantAccess.banner.endedTitle')}</strong>{' '}
              {expired ? t('app.tenantAccess.banner.expiredBody') : t('app.tenantAccess.banner.endedBody')}
            </span>
          </p>
          <button
            type="button"
            onClick={() => returnToAdmin('/admin')}
            className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-amber-700/40 bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
          >
            {t('app.tenantAccess.banner.backToAdmin')}
          </button>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div
      role="region"
      aria-label={t('app.tenantAccess.banner.label')}
      data-testid="impersonation-banner"
      className="border-b-2 border-fuchsia-700 bg-fuchsia-50 text-fuchsia-950 dark:bg-fuchsia-950/60 dark:text-fuchsia-50"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-2 text-sm">
        <div className="min-w-0 space-y-0.5">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <Eye className="size-4 shrink-0" aria-hidden="true" />
            <span className="break-all">{t('app.tenantAccess.banner.title', { email: session.targetEmail })}</span>
            <span className="inline-flex items-center gap-1 rounded border border-current px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide">
              <ShieldAlert className="size-3" aria-hidden="true" />
              {session.mode === 'READ_ONLY' ? t('app.tenantAccess.banner.readOnly') : t('app.tenantAccess.banner.readWrite')}
            </span>
          </p>
          <p className="text-xs flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{t('app.tenantAccess.banner.organization', { name: session.organizationName ?? session.organizationId })}</span>
            <span>{t('app.tenantAccess.banner.role', { role: roleLabel(session.memberRole) })}</span>
            <span className="break-words">{t('app.tenantAccess.banner.reason', { reason: session.reason })}</span>
          </p>
          <p className="text-xs opacity-80">{t('app.tenantAccess.banner.audited')}</p>
          {end.isError && (
            <p role="alert" className="text-xs font-semibold">
              {t('app.tenantAccess.banner.endFailed')}: {errText(end.error)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            role="timer"
            aria-label={t('app.tenantAccess.banner.remainingLabel')}
            className="inline-flex items-center gap-1.5 font-mono text-sm font-bold tabular-nums"
            data-testid="impersonation-countdown"
          >
            <Timer className="size-4" aria-hidden="true" />
            {t('app.tenantAccess.banner.remaining', { time: formatRemaining(remaining) })}
          </span>
          <button
            type="button"
            onClick={() => end.mutate()}
            disabled={end.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-fuchsia-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-900 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-600 focus-visible:ring-offset-2"
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            {end.isPending ? t('app.tenantAccess.banner.ending') : t('app.tenantAccess.banner.end')}
          </button>
        </div>
      </div>
    </div>
  );
}
