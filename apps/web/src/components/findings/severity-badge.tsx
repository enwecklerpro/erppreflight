import * as React from 'react';
import {
  OctagonAlert,
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  MinusCircle,
  HelpCircle,
  Info,
} from 'lucide-react';
import { Severity } from '@erppreflight/schemas';
import { SeverityBadgeProps } from './types';
import { useT } from '@/i18n/client';

const severityConfig: Record<
  Severity,
  {
    icon: React.ComponentType<{ className?: string }>;
    className: string;
  }
> = {
  BLOCKER: {
    icon: OctagonAlert,
    className:
      'bg-red-50 text-red-800 border-red-300 dark:bg-red-950/80 dark:text-red-200 dark:border-red-800',
  },
  CRITICAL: {
    icon: AlertTriangle,
    className:
      'bg-orange-50 text-orange-800 border-orange-300 dark:bg-orange-950/80 dark:text-orange-200 dark:border-orange-800',
  },
  MAJOR: {
    icon: AlertCircle,
    className:
      'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/80 dark:text-amber-200 dark:border-amber-800',
  },
  MEDIUM: {
    icon: ShieldAlert,
    className:
      'bg-yellow-50 text-yellow-800 border-yellow-300 dark:bg-yellow-950/80 dark:text-yellow-200 dark:border-yellow-800',
  },
  MINOR: {
    icon: MinusCircle,
    className:
      'bg-green-50 text-green-800 border-green-300 dark:bg-green-950/80 dark:text-green-200 dark:border-green-800',
  },
  LOW: {
    icon: HelpCircle,
    className:
      'bg-teal-50 text-teal-800 border-teal-300 dark:bg-teal-950/80 dark:text-teal-200 dark:border-teal-800',
  },
  INFO: {
    icon: Info,
    className:
      'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/80 dark:text-sky-200 dark:border-sky-800',
  },
};

export function SeverityBadge({
  severity,
  size = 'default',
  showIcon = true,
  className = '',
  ...props
}: SeverityBadgeProps) {
  const t = useT();
  const key = (severityConfig[severity] ? severity : 'INFO') as Severity;
  const conf = severityConfig[key];
  const label = t(`app.ui.severity.${key}`);
  const Icon = conf.icon;
  const isSm = size === 'sm';

  return (
    <span
      role="status"
      aria-label={t('app.findings.badges.severityAria', { label })}
      className={`inline-flex items-center gap-1.5 font-semibold border rounded-full select-none ${
        isSm ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'
      } ${conf.className} ${className}`}
      {...props}
    >
      {showIcon && <Icon className={`${isSm ? 'size-3' : 'size-3.5'} shrink-0`} aria-hidden="true" />}
      <span>{label}</span>
    </span>
  );
}
