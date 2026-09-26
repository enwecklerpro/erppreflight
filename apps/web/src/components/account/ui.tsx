'use client';

import * as React from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/components/form/form-field';

/** Primary / secondary / danger button styles shared by the account pages. */
export const buttonClass = {
  primary:
    'inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 motion-reduce:transition-none',
  secondary:
    'inline-flex items-center justify-center gap-2 px-3 py-2 border border-border bg-background text-foreground text-xs font-semibold rounded-lg hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none',
  danger:
    'inline-flex items-center justify-center gap-2 px-3 py-2 border border-destructive/40 bg-destructive/10 text-destructive text-xs font-semibold rounded-lg hover:bg-destructive/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 motion-reduce:transition-none',
};

type NoticeTone = 'info' | 'success' | 'warning' | 'error';

const toneStyles: Record<NoticeTone, { box: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  info: { box: 'border-blue-500/30 bg-blue-500/10 text-foreground', icon: Info, label: 'Information' },
  success: { box: 'border-emerald-500/30 bg-emerald-500/10 text-foreground', icon: CheckCircle2, label: 'Success' },
  warning: { box: 'border-amber-500/40 bg-amber-500/10 text-foreground', icon: TriangleAlert, label: 'Warning' },
  error: { box: 'border-destructive/30 bg-destructive/10 text-destructive', icon: AlertCircle, label: 'Error' },
};

/**
 * Status message that never relies on color alone: every tone has its own icon and a
 * visually hidden label, and errors are announced assertively.
 */
export function Notice({
  tone,
  title,
  children,
  className,
}: {
  tone: NoticeTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const { box, icon: Icon, label } = toneStyles[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn('rounded-xl border p-3.5 text-xs flex items-start gap-2.5', box, className)}
    >
      <Icon className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <span className="sr-only">{label}: </span>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title ? 'mt-0.5' : '', 'break-words')}>{children}</div>}
      </div>
    </div>
  );
}

/** Centered card used by the public authentication pages. */
export function AuthCard({
  title,
  subtitle,
  icon: Icon = ShieldCheck,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[calc(100vh-12rem)] flex flex-col justify-center py-8 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="size-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
            <Icon className="size-7" aria-hidden="true" />
          </div>
        </div>
        <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1.5 text-center text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="mt-6 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-xs">{children}</div>
      </div>
    </div>
  );
}

/** Pending label for submit buttons. */
export function Pending({ busy, idle, busyLabel }: { busy: boolean; idle: React.ReactNode; busyLabel: string }) {
  return busy ? (
    <>
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span>{busyLabel}</span>
    </>
  ) : (
    <>{idle}</>
  );
}

/** Layout-stable loading placeholder for a settings section. */
export function SectionSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** Settings section container with a heading and description. */
export function SettingsSection({
  id,
  title,
  description,
  icon: Icon,
  children,
  actions,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section aria-labelledby={headingId} className="bg-card border border-border rounded-2xl p-5 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <div className="size-9 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Icon className="size-4" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-semibold text-foreground">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
