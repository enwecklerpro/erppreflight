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

type BadgeDef = { label: string; icon: React.ComponentType<{ className?: string }>; className: string; description: string };

const SUPPORT: Record<SupportState, BadgeDef> = {
  RELEASED: {
    label: 'Released',
    icon: BadgeCheck,
    className: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800',
    description: 'Released API (clean core level A) for this release',
  },
  DEPRECATED: {
    label: 'Deprecated',
    icon: Clock3,
    className: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800',
    description: 'Was released but should no longer be used; see successor',
  },
  NOT_RELEASED: {
    label: 'Not released',
    icon: CircleSlash,
    className: 'bg-red-50 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800',
    description: 'Not released for ABAP Cloud; use the successor',
  },
  NOT_TO_BE_RELEASED_STABLE: {
    label: 'Not released (stable)',
    icon: Lock,
    className: 'bg-orange-50 text-orange-800 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800',
    description: 'Will not be released but is kept stable',
  },
  CLASSIC_API: {
    label: 'Classic API',
    icon: Library,
    className: 'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-800',
    description: 'Classic API (clean core level B, SAP Cloud ERP Private)',
  },
  NO_API: {
    label: 'No API',
    icon: Ban,
    className: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800',
    description: 'Classified as not to be used (clean core level D)',
  },
  SUPPORTED: {
    label: 'Supported',
    icon: BadgeCheck,
    className: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800',
    description: 'Supported in this release',
  },
  BLOCKED: {
    label: 'Blocked',
    icon: Ban,
    className: 'bg-red-50 text-red-800 border-red-300 dark:bg-red-950/60 dark:text-red-200 dark:border-red-800',
    description: 'Blocked in this release',
  },
  UNKNOWN: {
    label: 'Unknown',
    icon: CircleHelp,
    className: 'bg-muted text-muted-foreground border-border',
    description: 'No verified statement for this release',
  },
};

/** Release support state — icon + text (never color alone, AGENTS.md Axiom 1.5). */
export function SupportStateBadge({ state, level }: { state: SupportState; level?: string | null }) {
  const def = SUPPORT[state] ?? SUPPORT.UNKNOWN;
  const Icon = def.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${def.className}`}
      title={def.description}
      aria-label={`Support state: ${def.label}${level ? `, clean core level ${level}` : ''}`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {def.label}
      {level ? <span className="font-mono opacity-80">· {level}</span> : null}
    </span>
  );
}

const TRUST: Record<TrustLevel, { label: string; icon: React.ComponentType<{ className?: string }>; official: boolean }> = {
  OFFICIAL_REPOSITORY: { label: 'Official repository', icon: FileCheck2, official: true },
  OFFICIAL_DOCUMENTATION: { label: 'Official documentation', icon: BookOpen, official: true },
  OFFICIAL_SUPPORT: { label: 'Official support', icon: Building2, official: true },
  OFFICIAL_COMMUNITY: { label: 'Official community', icon: Users, official: true },
  CURATED_RULE: { label: 'Curated rule', icon: Wrench, official: false },
  THIRD_PARTY: { label: 'Third party', icon: Users, official: false },
  CUSTOMER_EVIDENCE: { label: 'Customer evidence', icon: Building2, official: false },
  INFERRED: { label: 'Inferred', icon: Lightbulb, official: false },
};

/** Evidence trust level (Part 04 §4.7 — the UI must distinguish these). */
export function TrustLevelBadge({ level }: { level: TrustLevel }) {
  const def = TRUST[level] ?? TRUST.INFERRED;
  const Icon = def.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
        def.official
          ? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200'
          : 'border-border bg-muted text-muted-foreground'
      }`}
      aria-label={`Evidence trust level: ${def.label}`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {def.label}
    </span>
  );
}

export const CHANGE_LABELS: Record<string, string> = {
  ADDED: 'Newly listed',
  REMOVED: 'Removed from list',
  NEWLY_RELEASED: 'Newly released',
  NEWLY_DEPRECATED: 'Newly deprecated',
  RELEASE_WITHDRAWN: 'Release withdrawn',
  STATE_CHANGED: 'State changed',
  SUCCESSOR_CHANGED: 'Successor changed',
  ATTRIBUTES_CHANGED: 'Attributes changed',
  GAP_CLOSED: 'Gap closed',
  GAP_OPENED: 'Gap opened',
  NEW_DEPRECATION: 'New deprecation',
  OBJECT_REMOVED: 'Removed',
};

export function isSupportState(v: string): v is SupportState {
  return v in SUPPORT;
}
