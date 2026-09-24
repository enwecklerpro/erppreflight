import * as React from 'react';
import { CleanCoreTier } from '@erppreflight/schemas';
import { CheckCircle2, ShieldAlert, OctagonAlert } from 'lucide-react';
import { ObjectTierBadgeProps } from './types';

const tierConfig: Record<
  CleanCoreTier,
  {
    icon: React.ComponentType<{ className?: string }>;
    className: string;
    label: string;
    description: string;
  }
> = {
  TIER_1_CLOUD: {
    icon: CheckCircle2,
    className:
      'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    label: 'Tier 1: Cloud',
    description: 'Cloud Compliant (Public API / RAP)',
  },
  TIER_2_DEVELOPER: {
    icon: ShieldAlert,
    className:
      'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
    label: 'Tier 2: Developer',
    description: 'Developer Extensibility (Transitional Custom Code)',
  },
  TIER_3_CLASSIC: {
    icon: OctagonAlert,
    className:
      'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
    label: 'Tier 3: Classic',
    description: 'Classic Modification (Prohibited Migration Hazard)',
  },
};

export function ObjectTierBadge({
  tier,
  className = '',
  size = 'default',
  showIcon = true,
}: ObjectTierBadgeProps) {
  const conf = tierConfig[tier] || tierConfig.TIER_3_CLASSIC;
  const Icon = conf.icon;
  const isSm = size === 'sm';

  return (
    <span
      role="status"
      aria-label={`Clean Core: ${conf.label} - ${conf.description}`}
      className={`inline-flex items-center gap-1.5 font-semibold border rounded-full select-none transition-colors ${
        isSm ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      } ${conf.className} ${className}`}
    >
      {showIcon && <Icon className={`${isSm ? 'size-3' : 'size-3.5'} shrink-0`} aria-hidden="true" />}
      <span>{conf.label}</span>
    </span>
  );
}
