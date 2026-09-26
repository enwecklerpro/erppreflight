'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  notificationKeys,
} from '@/lib/knowledge-graph';
import { NotificationItem } from './notification-item';

/** Navbar notification bell: unread badge (polled every 60 s) + keyboard-accessible popover. */
export function NotificationsBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const unread = useQuery({
    queryKey: notificationKeys.unread,
    queryFn: ({ signal }) => fetchUnreadCount(signal),
    refetchInterval: 60_000,
    retry: false,
  });
  const recent = useQuery({
    queryKey: notificationKeys.list('recent'),
    queryFn: ({ signal }) => fetchNotifications('all', undefined, signal),
    enabled: open,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: notificationKeys.all });
  const toggleRead = useMutation({
    mutationFn: (p: { id: string; read: boolean }) => markNotificationRead(p.id, p.read),
    onSuccess: invalidate,
  });
  const readAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: invalidate });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Not signed in / no tenant: render nothing rather than a broken control.
  if (unread.isError) return null;
  const count = unread.data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="notifications-panel"
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        className="relative inline-flex items-center justify-center rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-4" aria-hidden="true" />
        {count > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id="notifications-panel"
          ref={panelRef}
          role="dialog"
          aria-label="Recent notifications"
          className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] rounded-xl border border-border bg-card p-3 shadow-lg"
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">Notifications</p>
            <button
              type="button"
              onClick={() => readAll.mutate()}
              disabled={count === 0 || readAll.isPending}
              className="text-xs text-primary disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
          {recent.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/50 motion-reduce:animate-none" />
              ))}
            </div>
          ) : recent.isError ? (
            <p role="alert" className="text-xs text-destructive">
              Could not load notifications.{' '}
              <button type="button" className="underline" onClick={() => recent.refetch()}>
                Retry
              </button>
            </p>
          ) : recent.data && recent.data.items.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">You are all caught up.</p>
          ) : (
            <ul className="max-h-[360px] space-y-1.5 overflow-y-auto">
              {recent.data?.items.slice(0, 6).map((n) => (
                <NotificationItem key={n.id} n={n} compact onToggleRead={(x) => toggleRead.mutate({ id: x.id, read: !x.readAt })} />
              ))}
            </ul>
          )}
          <Link href="/notifications" onClick={() => setOpen(false)} className="mt-2 block text-center text-xs text-primary hover:underline">
            View all notifications
          </Link>
        </div>
      ) : null}
    </div>
  );
}
