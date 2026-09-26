import * as React from 'react';
import { Sparkles, Code2, OctagonAlert } from 'lucide-react';
import { CleanCoreTier } from '@erppreflight/schemas';
import { CleanCoreBadgeProps } from './types';
import { useT } from '@/i18n/client';

const tierConfig: Record<
  CleanCoreTier,
  {
    icon: React.ComponentType<{ className?: string }>;
    className: string;
  }
> = {
  TIER_1_CLOUD: {
    icon: Sparkles,
    className:
      'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
  },
  TIER_2_DEVELOPER: {
    icon: Code2,
    className:
      'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800',
  },
  TIER_3_CLASSIC: {
    icon: OctagonAlert,
    className:
      'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300 dark:border-rose-800',
  },
};

export function CleanCoreBadge({
  tier,
  size = 'default',
  showIcon = true,
  className = '',
  ...props
}: CleanCoreBadgeProps) {
  const t = useT();
  if (!tier) {
    return <span className="text-muted-foreground text-xs font-mono">—</span>;
  }

  const key = (tierConfig[tier] ? tier : 'TIER_3_CLASSIC') as CleanCoreTier;
  const conf = tierConfig[key];
  const label = t(`app.findings.badges.tier.${key}`);
  const description = t(`app.findings.badges.tierDescription.${key}`);
  const Icon = conf.icon;
  const isSm = size === 'sm';

  return (
    <span
      role="status"
      aria-label={t('app.findings.badges.cleanCoreAria', { label, description })}
      className={`inline-flex items-center gap-1.5 font-semibold border rounded-md select-none ${
        isSm ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'
      } ${conf.className} ${className}`}
      {...props}
    >
      {showIcon && <Icon className={`${isSm ? 'size-3' : 'size-3.5'} shrink-0`} aria-hidden="true" />}
      <span>{label}</span>
    </span>
  );
}

// Export alias for consistency across components
export const CleanCoreTierBadge = CleanCoreBadge;
