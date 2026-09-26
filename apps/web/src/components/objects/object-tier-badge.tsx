import * as React from 'react';
import { CleanCoreTier } from '@erppreflight/schemas';
import { CheckCircle2, ShieldAlert, OctagonAlert } from 'lucide-react';
import { ObjectTierBadgeProps } from './types';
import { useT } from '../../i18n/client';

const tierConfig: Record<
  CleanCoreTier,
  {
    icon: React.ComponentType<{ className?: string }>;
    className: string;
  }
> = {
  TIER_1_CLOUD: {
    icon: CheckCircle2,
    className:
      'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  },
  TIER_2_DEVELOPER: {
    icon: ShieldAlert,
    className:
      'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
  },
  TIER_3_CLASSIC: {
    icon: OctagonAlert,
    className:
      'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
  },
};

export function ObjectTierBadge({
  tier,
  className = '',
  size = 'default',
  showIcon = true,
}: ObjectTierBadgeProps) {
  const t = useT();
  const key: CleanCoreTier = tierConfig[tier] ? tier : 'TIER_3_CLASSIC';
  const conf = tierConfig[key];
  const label = t(`app.objects.tier.${key}.label`);
  const description = t(`app.objects.tier.${key}.description`);
  const Icon = conf.icon;
  const isSm = size === 'sm';

  return (
    <span
      role="status"
      aria-label={t('app.objects.tierAria', { label, description })}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap font-semibold border rounded-full select-none transition-colors ${
        isSm ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      } ${conf.className} ${className}`}
    >
      {showIcon && <Icon className={`${isSm ? 'size-3' : 'size-3.5'} shrink-0`} aria-hidden="true" />}
      <span>{label}</span>
    </span>
  );
}
