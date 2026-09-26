'use client';

import React from 'react';
import Link from 'next/link';
import { SeverityBadge } from '@/components/findings/severity-badge';
import type { AppNotification } from '@/lib/knowledge-graph';
import { useFmt, useT } from '@/i18n/client';
import { localizeNotification } from '@/lib/notification-text';

export function NotificationItem({
  n,
  onToggleRead,
  compact = false,
}: {
  n: AppNotification;
  onToggleRead?: (n: AppNotification) => void;
  compact?: boolean;
}) {
  const t = useT();
  const fmt = useFmt();
  const unread = !n.readAt;
  const text = React.useMemo(() => localizeNotification(n, t), [n, t]);
  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={n.severity} size="sm" />
        {unread ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase text-primary">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" /> {t('app.shell.notification.unread')}
          </span>
        ) : null}
        <time dateTime={n.createdAt} className="text-[11px] text-muted-foreground">{fmt.dateTime(n.createdAt)}</time>
      </div>
      <p className={`mt-1 text-sm ${unread ? 'font-semibold' : ''}`}>{text.title}</p>
      {!compact && text.body ? <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{text.body}</p> : null}
    </>
  );
  return (
    <li className={`flex items-start gap-3 rounded-lg border p-3 ${unread ? 'border-primary/40 bg-primary/5' : 'border-border'}`}>
      <div className="min-w-0 flex-1">
        {n.link ? (
          <Link href={n.link} className="block hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => unread && onToggleRead?.(n)}>
            {content}
          </Link>
        ) : (
          content
        )}
      </div>
      {onToggleRead ? (
        <button
          type="button"
          onClick={() => onToggleRead(n)}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={unread ? t('app.shell.notification.markReadLabel', { title: text.title }) : t('app.shell.notification.markUnreadLabel', { title: text.title })}
        >
          {unread ? t('app.shell.notification.markRead') : t('app.shell.notification.markUnread')}
        </button>
      ) : null}
    </li>
  );
}
