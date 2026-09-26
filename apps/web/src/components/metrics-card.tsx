'use client';

import React from 'react';
import { CheckCircle2, AlertTriangle, type LucideIcon } from 'lucide-react';
import { useT } from '../i18n/client';

interface MetricsCardProps {
  title: string;
  value: string | number;
  change?: string;
  isPositive?: boolean;
  icon: LucideIcon;
  description?: string;
}

/** KPI tile. The trend badge pairs color with an icon and a screen-reader status (never color alone). */
export function MetricsCard({ title, value, change, isPositive, icon: Icon, description }: MetricsCardProps) {
  const t = useT();
  const StatusIcon = isPositive ? CheckCircle2 : AlertTriangle;
  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow motion-reduce:transition-none">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <div className="p-2 bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 rounded-lg shrink-0">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-3xl font-bold tracking-tight text-foreground">{value}</span>
        {change && (
          <span
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded ${
              isPositive
                ? 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300'
                : 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
            }`}
          >
            <StatusIcon className="size-3" aria-hidden="true" />
            <span className="sr-only">{isPositive ? t('app.dashboard.statusGood') : t('app.dashboard.statusAttention')}: </span>
            {change}
          </span>
        )}
      </div>
      {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}
