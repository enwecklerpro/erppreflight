'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import { accountKeys, errorMessage, fetchSessions, logoutAll, revokeSession, type SessionItem } from '@/lib/account-api';
import { useLogout } from '@/lib/query/query-provider';
import { Notice, Pending, SectionSkeleton, SettingsSection, buttonClass } from './ui';

/** Short, human-readable device label from a user agent string. */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /curl\//.test(ua)
            ? 'curl'
            : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function SessionRow({ session, onRevoke, busy }: { session: SessionItem; onRevoke: () => void; busy: boolean }) {
  return (
    <li className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground flex items-center gap-2">
          {describeUserAgent(session.userAgent)}
          {session.current && (
            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">This device</span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {session.ip || 'IP unknown'} · signed in {new Date(session.createdAt).toLocaleString()} · last active{' '}
          {new Date(session.lastSeenAt).toLocaleString()} · {session.authMethod.replace(/_/g, ' ').toLowerCase()}
        </p>
      </div>
      {!session.current && (
        <button type="button" className={buttonClass.secondary} onClick={onRevoke} disabled={busy} aria-label={`Sign out ${describeUserAgent(session.userAgent)} session`}>
          <Pending busy={busy} busyLabel="Signing out..." idle="Sign out" />
        </button>
      )}
    </li>
  );
}

export function SessionsPanel() {
  const queryClient = useQueryClient();
  const logout = useLogout();
  const sessions = useQuery({ queryKey: accountKeys.sessions, queryFn: fetchSessions, retry: 1 });
  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions }),
  });
  const revokeAll = useMutation({
    mutationFn: logoutAll,
    onSuccess: () => logout('/login'),
  });

  return (
    <SettingsSection
      id="sessions"
      title="Active sessions"
      icon={MonitorSmartphone}
      description="Devices currently signed in to your account."
      actions={
        <button
          type="button"
          className={buttonClass.danger}
          disabled={revokeAll.isPending}
          onClick={() => {
            if (window.confirm('Sign out of every device, including this one?')) revokeAll.mutate();
          }}
        >
          <Pending busy={revokeAll.isPending} busyLabel="Signing out..." idle={<><LogOut className="size-3.5" aria-hidden="true" /> Sign out everywhere</>} />
        </button>
      }
    >
      {revokeAll.isError && <Notice tone="error">{errorMessage(revokeAll.error)}</Notice>}
      {revoke.isError && <Notice tone="error">{errorMessage(revoke.error)}</Notice>}
      {sessions.isPending ? (
        <SectionSkeleton rows={2} label="Loading sessions" />
      ) : sessions.isError ? (
        <div className="space-y-3">
          <Notice tone="error" title="Could not load sessions">{errorMessage(sessions.error)}</Notice>
          <button type="button" className={buttonClass.secondary} onClick={() => sessions.refetch()}>Retry</button>
        </div>
      ) : sessions.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">No active sessions were found.</p>
      ) : (
        <ul className="divide-y divide-border">
          {sessions.data.map((s) => (
            <SessionRow key={s.id} session={s} busy={revoke.isPending && revoke.variables === s.id} onRevoke={() => revoke.mutate(s.id)} />
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
