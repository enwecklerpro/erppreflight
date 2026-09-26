import React from 'react';
import Link from 'next/link';
import { SeverityBadge } from '@/components/findings/severity-badge';
import type { AppNotification } from '@/lib/knowledge-graph';

export function NotificationItem({
  n,
  onToggleRead,
  compact = false,
}: {
  n: AppNotification;
  onToggleRead?: (n: AppNotification) => void;
  compact?: boolean;
}) {
  const unread = !n.readAt;
  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={n.severity} size="sm" />
        {unread ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase text-primary">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" /> Unread
          </span>
        ) : null}
        <span className="text-[10px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</span>
      </div>
      <p className={`mt-1 text-sm ${unread ? 'font-semibold' : ''}`}>{n.title}</p>
      {!compact && n.body ? <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{n.body}</p> : null}
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
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
          aria-label={unread ? `Mark "${n.title}" as read` : `Mark "${n.title}" as unread`}
        >
          {unread ? 'Mark read' : 'Mark unread'}
        </button>
      ) : null}
    </li>
  );
}
