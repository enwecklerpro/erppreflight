import * as React from 'react';
import { ShieldCheck, AlertTriangle, HelpCircle } from 'lucide-react';
import { ConfidenceClass } from '@erppreflight/schemas';
import { ConfidenceBadgeProps } from './types';

const confidenceConfig: Record<
  ConfidenceClass,
  {
    icon: React.ComponentType<{ className?: string }>;
    className: string;
    defaultScore: string;
    label: string;
  }
> = {
  VERIFIED: {
    icon: ShieldCheck,
    className:
      'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800',
    defaultScore: '1.0',
    label: 'Verified',
  },
  RULE_DERIVED: {
    icon: ShieldCheck,
    className:
      'bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950/70 dark:text-blue-300 dark:border-blue-800',
    defaultScore: '0.85',
    label: 'Rule Derived',
  },
  INFERRED: {
    icon: AlertTriangle,
    className:
      'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800',
    defaultScore: '0.60',
    label: 'Inferred',
  },
  UNKNOWN: {
    icon: HelpCircle,
    className:
      'bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800/80 dark:text-zinc-300 dark:border-zinc-700',
    defaultScore: '0.30',
    label: 'Unknown',
  },
};

export function ConfidenceBadge({
  confidence,
  score,
  size = 'default',
  showIcon = true,
  className = '',
  ...props
}: ConfidenceBadgeProps) {
  const conf = confidenceConfig[confidence] || confidenceConfig.UNKNOWN;
  const Icon = conf.icon;
  const displayScore = score !== undefined ? score.toFixed(2) : conf.defaultScore;
  const isSm = size === 'sm';

  return (
    <span
      role="status"
      aria-label={`Confidence: ${conf.label}, Trust Score: ${displayScore}`}
      className={`inline-flex items-center gap-1.5 font-medium border rounded-md select-none ${
        isSm ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
      } ${conf.className} ${className}`}
      {...props}
    >
      {showIcon && <Icon className={`${isSm ? 'size-3' : 'size-3.5'} shrink-0`} aria-hidden="true" />}
      <span>{conf.label}</span>
      {/* Full badge colour (no opacity): the score must keep >= 4.5:1 contrast (WCAG 1.4.3). */}
      <span className="font-mono text-[10px]">({displayScore})</span>
    </span>
  );
}
