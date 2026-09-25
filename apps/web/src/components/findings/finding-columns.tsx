import * as React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Finding, CleanCoreTier, DriftClassification } from '@erppreflight/schemas';
import { SeverityBadge } from './severity-badge';
import { ConfidenceBadge } from './confidence-badge';
import { CleanCoreBadge } from './clean-core-badge';
import { ALL_18_ENGINES } from '../../lib/api-client';
import { FilterDef } from '../data-table/types';
import {
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';

const engineMap = new Map(ALL_18_ENGINES.map((e) => [e.id, e.name]));

export interface DriftBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  classification?: DriftClassification | string | null;
  size?: 'sm' | 'default';
  showIcon?: boolean;
}

const driftConfig: Record<
  DriftClassification,
  {
    icon: React.ComponentType<{ className?: string }>;
    className: string;
    label: string;
  }
> = {
  NEWLY_INTRODUCED_RISK: {
    icon: AlertTriangle,
    className:
      'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/80 dark:text-rose-200 dark:border-rose-800',
    label: 'Newly Introduced (Regression)',
  },
  KNOWN_BASELINE_RISK: {
    icon: ShieldAlert,
    className:
      'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
    label: 'Known Baseline (Accepted)',
  },
  RESOLVED_RISK: {
    icon: CheckCircle2,
    className:
      'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-200 dark:border-emerald-800',
    label: 'Resolved Risk',
  },
};

export function DriftBadge({
  classification,
  size = 'default',
  showIcon = true,
  className = '',
  ...props
}: DriftBadgeProps) {
  if (!classification || !(classification in driftConfig)) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const conf = driftConfig[classification as DriftClassification];
  const Icon = conf.icon;
  const isSm = size === 'sm';

  return (
    <span
      role="status"
      aria-label={`Drift Status: ${conf.label}`}
      className={`inline-flex items-center gap-1.5 font-semibold border rounded-full select-none ${
        isSm ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'
      } ${conf.className} ${className}`}
      {...props}
    >
      {showIcon && <Icon className={`${isSm ? 'size-3' : 'size-3.5'} shrink-0`} aria-hidden="true" />}
      <span>{conf.label}</span>
    </span>
  );
}

export const findingFacetedFilters: FilterDef[] = [
  {
    id: 'driftClassification',
    title: 'Drift Status',
    options: [
      { label: 'Newly Introduced (Regression)', value: 'NEWLY_INTRODUCED_RISK' },
      { label: 'Known Baseline (Accepted)', value: 'KNOWN_BASELINE_RISK' },
      { label: 'Resolved Risk', value: 'RESOLVED_RISK' },
    ],
  },
  {
    id: 'severity',
    title: 'Severity',
    options: [
      { label: 'Blocker', value: 'BLOCKER' },
      { label: 'Critical', value: 'CRITICAL' },
      { label: 'Major', value: 'MAJOR' },
      { label: 'Medium', value: 'MEDIUM' },
      { label: 'Minor', value: 'MINOR' },
      { label: 'Low', value: 'LOW' },
      { label: 'Info', value: 'INFO' },
    ],
  },
  {
    id: 'confidence',
    title: 'Provenance',
    options: [
      { label: 'Verified (1.0)', value: 'VERIFIED' },
      { label: 'Rule Derived (0.85)', value: 'RULE_DERIVED' },
      { label: 'Inferred (0.60)', value: 'INFERRED' },
      { label: 'Unknown (0.30)', value: 'UNKNOWN' },
    ],
  },
  {
    id: 'cleanCoreTier',
    title: 'Clean Core',
    options: [
      { label: 'Tier 1: Cloud Compliant', value: 'TIER_1_CLOUD' },
      { label: 'Tier 2: Developer Extensibility', value: 'TIER_2_DEVELOPER' },
      { label: 'Tier 3: Classic Modification', value: 'TIER_3_CLASSIC' },
    ],
  },
  {
    id: 'engineType',
    title: 'Engine',
    options: ALL_18_ENGINES.map((eng) => ({
      label: eng.name,
      value: eng.id,
    })),
  },
];

export const findingColumns: ColumnDef<Finding>[] = [
  // 1. Selection Checkbox
  {
    id: 'select',
    header: ({ table }) => (
      <input
        type="checkbox"
        checked={table.getIsAllPageRowsSelected()}
        onChange={(e) => table.toggleAllPageRowsSelected(!!e.target.checked)}
        aria-label="Select all findings on this page"
        className="rounded border-border text-primary focus:ring-primary size-3.5 cursor-pointer"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        checked={row.getIsSelected()}
        onChange={(e) => row.toggleSelected(!!e.target.checked)}
        aria-label={`Select finding ${row.original.ruleId}`}
        className="rounded border-border text-primary focus:ring-primary size-3.5 cursor-pointer"
      />
    ),
    enableSorting: false,
    enableHiding: false,
    size: 40,
  },

  // 2. Finding Code / Rule ID
  {
    accessorKey: 'ruleId',
    id: 'ruleId',
    header: 'Finding Code',
    cell: ({ row }) => {
      const isExpanded = row.getIsExpanded();
      return (
        <button
          type="button"
          onClick={() => row.toggleExpanded()}
          className="flex items-center gap-1.5 font-mono text-xs font-bold text-primary hover:underline text-left group"
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} finding ${row.original.ruleId}`}
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
          )}
          <span>{row.original.ruleId}</span>
        </button>
      );
    },
    size: 240,
  },

  // 3. Title & Description
  {
    accessorKey: 'title',
    id: 'title',
    header: 'Title & Summary',
    cell: ({ row }) => {
      const f = row.original;
      return (
        <div className="space-y-0.5 max-w-md">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground text-xs line-clamp-1">{f.title}</span>
            {f.category && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground shrink-0 uppercase border border-border/50">
                {f.category}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground line-clamp-1">{f.description}</p>
        </div>
      );
    },
    size: 320,
  },

  // 4. Severity (Non-Color Triad)
  {
    accessorKey: 'severity',
    id: 'severity',
    header: 'Severity',
    cell: ({ row }) => <SeverityBadge severity={row.original.severity} size="sm" />,
    filterFn: (row, id, value: string[]) => {
      if (!value || value.length === 0) return true;
      const cellVal = String(row.getValue(id));
      return value.includes(cellVal);
    },
    size: 130,
  },

  // 5. Drift Status (Non-Color Triad)
  {
    id: 'driftClassification',
    header: 'Drift Status',
    accessorFn: (row) => (row as any).driftClassification ?? null,
    cell: ({ row }) => {
      const drift = (row.original as any).driftClassification as DriftClassification | undefined;
      return <DriftBadge classification={drift} size="sm" />;
    },
    filterFn: (row, id, value: string[]) => {
      if (!value || value.length === 0) return true;
      const cellVal = String(row.getValue(id) || '');
      return value.includes(cellVal);
    },
    size: 190,
  },

  // 6. Epistemic Confidence & Trust Score
  {
    accessorKey: 'confidence',
    id: 'confidence',
    header: 'Provenance',
    cell: ({ row }) => (
      <ConfidenceBadge
        confidence={row.original.confidence}
        score={row.original.confidenceScore}
        size="sm"
      />
    ),
    filterFn: (row, id, value: string[]) => {
      if (!value || value.length === 0) return true;
      const cellVal = String(row.getValue(id));
      return value.includes(cellVal);
    },
    size: 170,
  },

  // 6. Clean Core Tier
  {
    id: 'cleanCoreTier',
    header: 'Clean Core',
    accessorFn: (row) =>
      row.affectedObjects?.map((obj) => obj.tier).filter(Boolean) ?? [],
    cell: ({ row }) => {
      const tiers = row.original.affectedObjects
        ?.map((obj) => obj.tier)
        .filter((t): t is CleanCoreTier => Boolean(t));
      const primaryTier =
        tiers?.find((t) => t === 'TIER_3_CLASSIC') ??
        tiers?.find((t) => t === 'TIER_2_DEVELOPER') ??
        tiers?.[0];
      return <CleanCoreBadge tier={primaryTier} size="sm" />;
    },
    filterFn: (row, _id, value: string[]) => {
      if (!value || value.length === 0) return true;
      return (
        row.original.affectedObjects?.some(
          (obj) => obj.tier && value.includes(obj.tier)
        ) ?? false
      );
    },
    size: 140,
  },

  // 7. Engine
  {
    accessorKey: 'engineType',
    id: 'engineType',
    header: 'Engine',
    cell: ({ row }) => {
      const eng = row.original.engineType;
      const humanName = eng ? engineMap.get(eng) || eng : '—';
      return (
        <span className="text-xs text-foreground font-medium" title={eng || ''}>
          {humanName}
        </span>
      );
    },
    filterFn: (row, id, value: string[]) => {
      if (!value || value.length === 0) return true;
      const cellVal = row.getValue(id) as string | null;
      return cellVal ? value.includes(cellVal) : false;
    },
    size: 160,
  },

  // 8. Target SAP Object Reference
  {
    id: 'affectedObject',
    header: 'Target Object',
    accessorFn: (row) => row.affectedObjects?.[0]?.name ?? '—',
    cell: ({ row }) => {
      const obj = row.original.affectedObjects?.[0];
      if (!obj) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <div className="flex items-center gap-1.5 font-mono text-xs">
          <span className="font-semibold text-foreground">{obj.name}</span>
          {obj.type && (
            <span className="px-1 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-sans border border-border/40">
              {obj.type}
            </span>
          )}
        </div>
      );
    },
    size: 180,
  },

  // 9. Actions Column
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => {
      const [copied, setCopied] = React.useState(false);

      const copyRuleId = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(row.original.ruleId).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      };

      return (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={copyRuleId}
            title={copied ? 'Copied Rule ID' : 'Copy Finding Rule ID'}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label={`Copy Rule ID ${row.original.ruleId}`}
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => row.toggleExpanded()}
            title={row.getIsExpanded() ? 'Collapse Details' : 'Expand Details'}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Toggle Details"
          >
            {row.getIsExpanded() ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        </div>
      );
    },
    size: 60,
  },
];
