'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import { accountKeys, fetchSessions, logoutAll, revokeSession, type SessionItem } from '@/lib/account-api';
import { useErrorText, useFmt, useLabel, useT } from '@/i18n/client';
import type { TFunction } from '@/i18n/translate';
import { useLogout } from '@/lib/query/query-provider';
import { Notice, Pending, SectionSkeleton, SettingsSection, buttonClass } from './ui';

/** Short, human-readable device label from a user agent string (localized when `t` is given). */
export function describeUserAgent(ua: string | null, t?: TFunction): string {
  if (!ua) return t ? t('app.security.sessions.unknownDevice') : 'Unknown device';
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
            : t
              ? t('app.security.sessions.browser')
              : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  if (!os) return browser;
  return t ? t('app.security.sessions.browserOnOs', { browser, os }) : `${browser} on ${os}`;
}

function SessionRow({ session, onRevoke, busy }: { session: SessionItem; onRevoke: () => void; busy: boolean }) {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const device = describeUserAgent(session.userAgent, t);
  const method = label('app.security.sessions.method', session.authMethod);
  return (
    <li className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground flex flex-wrap items-center gap-2">
          {device}
          {session.current && (
            <span className="text-xs font-bold uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">{t('app.security.sessions.thisDevice')}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('app.security.sessions.details', {
            ip: session.ip || t('app.security.sessions.ipUnknown'),
            signedIn: fmt.dateTime(session.createdAt),
            lastActive: fmt.dateTime(session.lastSeenAt),
            method: method === session.authMethod ? session.authMethod.replace(/_/g, ' ').toLowerCase() : method,
          })}
        </p>
      </div>
      {!session.current && (
        <button type="button" className={buttonClass.secondary} onClick={onRevoke} disabled={busy} aria-label={t('app.security.sessions.signOutLabel', { device })}>
          <Pending busy={busy} busyLabel={t('app.security.sessions.signingOut')} idle={t('app.security.sessions.signOut')} />
        </button>
      )}
    </li>
  );
}

export function SessionsPanel() {
  const t = useT();
  const errText = useErrorText();
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
      title={t('app.security.sessions.title')}
      icon={MonitorSmartphone}
      description={t('app.security.sessions.hint')}
      actions={
        <button
          type="button"
          className={buttonClass.danger}
          disabled={revokeAll.isPending}
          onClick={() => {
            if (window.confirm(t('app.security.sessions.signOutAllConfirm'))) revokeAll.mutate();
          }}
        >
          <Pending busy={revokeAll.isPending} busyLabel={t('app.security.sessions.signingOut')} idle={<><LogOut className="size-3.5" aria-hidden="true" /> {t('app.security.sessions.signOutAll')}</>} />
        </button>
      }
    >
      {revokeAll.isError && <Notice tone="error">{errText(revokeAll.error)}</Notice>}
      {revoke.isError && <Notice tone="error">{errText(revoke.error)}</Notice>}
      {sessions.isPending ? (
        <SectionSkeleton rows={2} label={t('app.security.sessions.loading')} />
      ) : sessions.isError ? (
        <div className="space-y-3">
          <Notice tone="error" title={t('app.security.sessions.loadFailed')}>{errText(sessions.error)}</Notice>
          <button type="button" className={buttonClass.secondary} onClick={() => sessions.refetch()}>{t('app.ui.retry')}</button>
        </div>
      ) : sessions.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('app.security.sessions.empty')}</p>
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
