'use client';

import React, { useEffect, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Loader2, Mail, Webhook } from 'lucide-react';
import { QueryErrorState } from '@/components/knowledge-graph/kg-nav';
import { NotificationItem } from '@/components/notifications/notification-item';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import {
  fetchNotificationChannels,
  fetchNotificationPreferences,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKeys,
  saveNotificationPreferences,
} from '@/lib/knowledge-graph';

const EVENT_LABEL: Record<string, string> = {
  'analysis.completed': 'Analysis completed',
  'analysis.failed': 'Analysis failed',
  'finding.critical': 'Critical / blocker findings',
  'release_watch.changed': 'Release watch changes',
};

function Preferences() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: notificationKeys.preferences, queryFn: ({ signal }) => fetchNotificationPreferences(signal) });
  const channels = useQuery({ queryKey: notificationKeys.channels, queryFn: ({ signal }) => fetchNotificationChannels(signal) });
  const [draft, setDraft] = useState<Array<{ eventType: string; inApp: boolean; email: boolean }> | null>(null);
  useEffect(() => {
    if (prefs.data && draft === null) setDraft(prefs.data);
  }, [prefs.data, draft]);
  const dirty = Boolean(draft && prefs.data && JSON.stringify(draft) !== JSON.stringify(prefs.data));
  const save = useMutation({
    mutationFn: () => saveNotificationPreferences(draft ?? []),
    onSuccess: (data) => {
      qc.setQueryData(notificationKeys.preferences, data);
      setDraft(data);
    },
  });
  useUnsavedChangesGuard({ isDirty: dirty, isSubmitting: save.isPending });

  if (prefs.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted/50 motion-reduce:animate-none" aria-busy="true" />;
  if (prefs.isError) return <QueryErrorState error={prefs.error} onRetry={() => prefs.refetch()} what="notification preferences" />;
  const emailAvailable = channels.data?.email ?? false;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="rounded-xl border border-border bg-card p-4"
      aria-labelledby="prefs-title"
    >
      <h2 id="prefs-title" className="text-sm font-semibold">
        Delivery preferences
      </h2>
      <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Bell className="size-3" aria-hidden="true" /> In-app: on</span>
        <span className="inline-flex items-center gap-1"><Webhook className="size-3" aria-hidden="true" /> Webhooks: configured by organization owners (signed)</span>
        <span className="inline-flex items-center gap-1">
          <Mail className="size-3" aria-hidden="true" /> E-mail: {emailAvailable ? 'available' : 'not configured on this server'}
        </span>
      </p>
      <table className="mt-3 w-full text-xs">
        <caption className="sr-only">Notification channels per event</caption>
        <thead className="text-left text-muted-foreground">
          <tr>
            <th scope="col" className="py-1">Event</th>
            <th scope="col" className="py-1">In-app</th>
            <th scope="col" className="py-1">E-mail</th>
          </tr>
        </thead>
        <tbody>
          {(draft ?? []).map((p, i) => (
            <tr key={p.eventType} className="border-t border-border">
              <td className="py-1.5">{EVENT_LABEL[p.eventType] ?? p.eventType}</td>
              <td className="py-1.5">
                <input
                  type="checkbox"
                  aria-label={`In-app notifications for ${EVENT_LABEL[p.eventType] ?? p.eventType}`}
                  checked={p.inApp}
                  onChange={(e) => setDraft((d) => d!.map((x, j) => (j === i ? { ...x, inApp: e.target.checked } : x)))}
                />
              </td>
              <td className="py-1.5">
                <input
                  type="checkbox"
                  aria-label={`E-mail notifications for ${EVENT_LABEL[p.eventType] ?? p.eventType}`}
                  checked={p.email}
                  disabled={!emailAvailable}
                  onChange={(e) => setDraft((d) => d!.map((x, j) => (j === i ? { ...x, email: e.target.checked } : x)))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {save.isError ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {(save.error as Error).message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!dirty || save.isPending}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
      >
        {save.isPending ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
        {save.isPending ? 'Saving…' : dirty ? 'Save preferences' : 'Saved'}
      </button>
    </form>
  );
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'all' | 'unread'>('all');
  const list = useInfiniteQuery({
    queryKey: notificationKeys.list(status),
    queryFn: ({ pageParam, signal }) => fetchNotifications(status, pageParam ?? undefined, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: notificationKeys.all });
  const toggle = useMutation({
    mutationFn: (p: { id: string; read: boolean }) => markNotificationRead(p.id, p.read),
    onSuccess: invalidate,
  });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: invalidate });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unreadCount = list.data?.pages[0]?.unreadCount ?? 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-labelledby="notif-title" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 id="notif-title" className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Bell className="size-6 text-primary" aria-hidden="true" /> Notifications
            <span className="text-sm font-normal text-muted-foreground">({unreadCount} unread)</span>
          </h1>
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Filter" className="inline-flex rounded-lg border border-border p-0.5 text-xs">
              {(['all', 'unread'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={status === s}
                  onClick={() => setStatus(s)}
                  className={`rounded-md px-2.5 py-1 ${status === s ? 'bg-primary text-primary-foreground' : ''}`}
                >
                  {s === 'all' ? 'All' : 'Unread'}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => readAll.mutate()}
              disabled={unreadCount === 0 || readAll.isPending}
              className="rounded-lg border border-border px-2.5 py-1 text-xs disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
        </div>
        {list.isLoading ? (
          <ul className="space-y-2" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="h-20 animate-pulse rounded-lg bg-muted/50 motion-reduce:animate-none" />
            ))}
          </ul>
        ) : list.isError ? (
          <QueryErrorState error={list.error} onRetry={() => list.refetch()} what="notifications" />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
            <BellOff className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">{status === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}</p>
            <p className="text-xs text-muted-foreground">
              You will be notified about completed or failed analyses, critical findings and release watch changes.
            </p>
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {items.map((n) => (
                <NotificationItem key={n.id} n={n} onToggleRead={(x) => toggle.mutate({ id: x.id, read: !x.readAt })} />
              ))}
            </ul>
            {list.hasNextPage ? (
              <button
                type="button"
                onClick={() => list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
                className="w-full rounded-lg border border-border py-2 text-xs"
              >
                {list.isFetchingNextPage ? 'Loading…' : 'Load older notifications'}
              </button>
            ) : null}
          </>
        )}
      </section>
      <aside>
        <Preferences />
      </aside>
    </div>
  );
}
