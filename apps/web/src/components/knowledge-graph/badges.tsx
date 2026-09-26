'use client';

import * as React from 'react';
import {
  Ban,
  BadgeCheck,
  BookOpen,
  Building2,
  CircleHelp,
  CircleSlash,
  Clock3,
  FileCheck2,
  Library,
  Lightbulb,
  Lock,
  Users,
  Wrench,
} from 'lucide-react';
import type { SupportState, TrustLevel } from '@/lib/knowledge-graph';
import { useLabel, useT } from '@/i18n/client';

type BadgeDef = { icon: React.ComponentType<{ className?: string }>; className: string };

const SUPPORT: Record<SupportState, BadgeDef> = {
  RELEASED: {
    icon: BadgeCheck,
    className: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800',
  },
  DEPRECATED: {
    icon: Clock3,
    className: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800',
  },
  NOT_RELEASED: {
    icon: CircleSlash,
    className: 'bg-red-50 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800',
  },
  NOT_TO_BE_RELEASED_STABLE: {
    icon: Lock,
    className: 'bg-orange-50 text-orange-800 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800',
  },
  CLASSIC_API: {
    icon: Library,
    className: 'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-800',
  },
  NO_API: {
    icon: Ban,
    className: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800',
  },
  SUPPORTED: {
    icon: BadgeCheck,
    className: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800',
  },
  BLOCKED: {
    icon: Ban,
    className: 'bg-red-50 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800',
  },
  UNKNOWN: {
    icon: CircleHelp,
    className: 'bg-muted text-muted-foreground border-border',
  },
};

/** Release support state — icon + text (never color alone, AGENTS.md Axiom 1.5). */
export function SupportStateBadge({ state, level }: { state: SupportState; level?: string | null }) {
  const t = useT();
  const key: SupportState = SUPPORT[state] ? state : 'UNKNOWN';
  const def = SUPPORT[key];
  const Icon = def.icon;
  const label = t(`app.kg.support.${key}`);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${def.className}`}
      title={t(`app.kg.supportHint.${key}`)}
      aria-label={level ? t('app.kg.supportLabelLevel', { state: label, level }) : t('app.kg.supportLabel', { state: label })}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
      {level ? <span className="font-mono opacity-80">· {level}</span> : null}
    </span>
  );
}

const TRUST: Record<TrustLevel, { icon: React.ComponentType<{ className?: string }>; official: boolean }> = {
  OFFICIAL_REPOSITORY: { icon: FileCheck2, official: true },
  OFFICIAL_DOCUMENTATION: { icon: BookOpen, official: true },
  OFFICIAL_SUPPORT: { icon: Building2, official: true },
  OFFICIAL_COMMUNITY: { icon: Users, official: true },
  CURATED_RULE: { icon: Wrench, official: false },
  THIRD_PARTY: { icon: Users, official: false },
  CUSTOMER_EVIDENCE: { icon: Building2, official: false },
  INFERRED: { icon: Lightbulb, official: false },
};

/** Evidence trust level (Part 04 §4.7 — the UI must distinguish these). */
export function TrustLevelBadge({ level }: { level: TrustLevel }) {
  const t = useT();
  const key: TrustLevel = TRUST[level] ? level : 'INFERRED';
  const def = TRUST[key];
  const Icon = def.icon;
  const label = t(`app.kg.trust.${key}`);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
        def.official
          ? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200'
          : 'border-border bg-muted text-muted-foreground'
      }`}
      aria-label={t('app.kg.trustLabel', { level: label })}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Localized label for a knowledge change type (unknown codes are shown verbatim). */
export function useChangeLabel(): (changeType: string) => string {
  const label = useLabel();
  return React.useCallback((changeType: string) => label('app.kg.change', changeType), [label]);
}

export function isSupportState(v: string): v is SupportState {
  return v in SUPPORT;
}
