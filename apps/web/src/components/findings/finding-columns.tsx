import * as React from 'react';
import { ColumnDef, Row } from '@tanstack/react-table';
import { Finding, CleanCoreTier, DriftClassification } from '@erppreflight/schemas';
import { SeverityBadge } from './severity-badge';
import { ConfidenceBadge } from './confidence-badge';
import { CleanCoreBadge } from './clean-core-badge';
import { ALL_18_ENGINES } from '../../lib/api-client';
import { FilterDef } from '../data-table/types';
import { useT } from '@/i18n/client';
import type { TFunction } from '@/i18n/translate';
import { useLocalizedRule } from '@/i18n/rule-catalog/client';
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
  }
> = {
  NEWLY_INTRODUCED_RISK: {
    icon: AlertTriangle,
    className:
      'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/80 dark:text-rose-200 dark:border-rose-800',
  },
  KNOWN_BASELINE_RISK: {
    icon: ShieldAlert,
    className:
      'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
  },
  RESOLVED_RISK: {
    icon: CheckCircle2,
    className:
      'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-200 dark:border-emerald-800',
  },
};

export function DriftBadge({
  classification,
  size = 'default',
  showIcon = true,
  className = '',
  ...props
}: DriftBadgeProps) {
  const t = useT();
  if (!classification || !(classification in driftConfig)) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }

  const conf = driftConfig[classification as DriftClassification];
  const label = t(`app.findings.drift.${classification as DriftClassification}`);
  const Icon = conf.icon;
  const isSm = size === 'sm';

  return (
    <span
      role="status"
      aria-label={t('app.findings.drift.label', { status: label })}
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

const SEVERITIES = ['BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR', 'LOW', 'INFO'] as const;
const CONFIDENCES = ['VERIFIED', 'RULE_DERIVED', 'INFERRED', 'UNKNOWN'] as const;
const TIERS = ['TIER_1_CLOUD', 'TIER_2_DEVELOPER', 'TIER_3_CLASSIC'] as const;
const DRIFTS = ['NEWLY_INTRODUCED_RISK', 'KNOWN_BASELINE_RISK', 'RESOLVED_RISK'] as const;

/** Faceted filters of the findings grid, labelled in the active language. */
export function buildFindingFacetedFilters(t: TFunction): FilterDef[] {
  return [
    {
      id: 'driftClassification',
      title: t('app.findings.columns.drift'),
      options: DRIFTS.map((d) => ({ label: t(`app.findings.drift.${d}`), value: d })),
    },
    {
      id: 'severity',
      title: t('app.findings.columns.severity'),
      options: SEVERITIES.map((s) => ({ label: t(`app.ui.severity.${s}`), value: s })),
    },
    {
      id: 'confidence',
      title: t('app.findings.columns.provenance'),
      options: CONFIDENCES.map((c) => ({ label: t(`app.findings.confidenceFilter.${c}`), value: c })),
    },
    {
      id: 'cleanCoreTier',
      title: t('app.findings.columns.cleanCore'),
      options: TIERS.map((tier) => ({ label: t(`app.findings.tierFilter.${tier}`), value: tier })),
    },
    {
      id: 'engineType',
      title: t('app.findings.columns.engine'),
      options: ALL_18_ENGINES.map((eng) => ({
        label: eng.name,
        value: eng.id,
      })),
    },
  ];
}

/** Title cell: German rule title from the rule catalog when the UI is German (engine text otherwise). */
function FindingTitleCell({ finding }: { finding: Finding }) {
  const text = useLocalizedRule(finding.ruleId, finding.title, finding.remediation);
  return (
    <div className="space-y-0.5 max-w-md">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-foreground text-xs line-clamp-1" title={text.engineTitle ?? undefined}>
          {text.title}
        </span>
        {finding.category && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground shrink-0 uppercase border border-border/50">
            {finding.category}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground line-clamp-1" translate="no">{text.engineTitle ?? finding.description}</p>
    </div>
  );
}

function RowActions({ row }: { row: Row<Finding> }) {
  const t = useT();
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
        title={copied ? t('app.findings.columns.copiedCode') : t('app.findings.columns.copyCode')}
        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label={t('app.findings.columns.copyCodeLabel', { code: row.original.ruleId })}
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => row.toggleExpanded()}
        title={row.getIsExpanded() ? t('app.findings.columns.collapseDetails') : t('app.findings.columns.expandDetails')}
        className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label={t('app.findings.columns.toggleDetails')}
      >
        {row.getIsExpanded() ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </button>
    </div>
  );
}

/** Columns of the findings grid (headers and labels in the active language). */
export function buildFindingColumns(t: TFunction): ColumnDef<Finding>[] {
  return [
    // 1. Selection Checkbox
    {
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          onChange={(e) => table.toggleAllPageRowsSelected(!!e.target.checked)}
          aria-label={t('app.findings.columns.selectAll')}
          className="rounded border-border text-primary focus:ring-primary size-3.5 cursor-pointer"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={(e) => row.toggleSelected(!!e.target.checked)}
          aria-label={t('app.findings.columns.selectOne', { code: row.original.ruleId })}
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
      header: t('app.findings.columns.code'),
      cell: ({ row }) => {
        const isExpanded = row.getIsExpanded();
        return (
          <button
            type="button"
            onClick={() => row.toggleExpanded()}
            className="flex items-center gap-1.5 font-mono text-xs font-bold text-primary hover:underline text-left group"
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? t('app.findings.columns.collapse', { code: row.original.ruleId })
                : t('app.findings.columns.expand', { code: row.original.ruleId })
            }
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

    // 3. Title & Description (German rule catalog title when the UI is German)
    {
      accessorKey: 'title',
      id: 'title',
      header: t('app.findings.columns.title'),
      cell: ({ row }) => <FindingTitleCell finding={row.original} />,
      size: 320,
    },

    // 4. Severity (Non-Color Triad)
    {
      accessorKey: 'severity',
      id: 'severity',
      header: t('app.findings.columns.severity'),
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
      header: t('app.findings.columns.drift'),
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
      header: t('app.findings.columns.provenance'),
      cell: ({ row }) => (
        <ConfidenceBadge confidence={row.original.confidence} score={row.original.confidenceScore} size="sm" />
      ),
      filterFn: (row, id, value: string[]) => {
        if (!value || value.length === 0) return true;
        const cellVal = String(row.getValue(id));
        return value.includes(cellVal);
      },
      size: 170,
    },

    // 7. Clean Core Tier
    {
      id: 'cleanCoreTier',
      header: t('app.findings.columns.cleanCore'),
      accessorFn: (row) => row.affectedObjects?.map((obj) => obj.tier).filter(Boolean) ?? [],
      cell: ({ row }) => {
        const tiers = row.original.affectedObjects?.map((obj) => obj.tier).filter((x): x is CleanCoreTier => Boolean(x));
        const primaryTier =
          tiers?.find((x) => x === 'TIER_3_CLASSIC') ?? tiers?.find((x) => x === 'TIER_2_DEVELOPER') ?? tiers?.[0];
        return <CleanCoreBadge tier={primaryTier} size="sm" />;
      },
      filterFn: (row, _id, value: string[]) => {
        if (!value || value.length === 0) return true;
        return row.original.affectedObjects?.some((obj) => obj.tier && value.includes(obj.tier)) ?? false;
      },
      size: 140,
    },

    // 8. Engine
    {
      accessorKey: 'engineType',
      id: 'engineType',
      header: t('app.findings.columns.engine'),
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

    // 9. Target SAP Object Reference
    {
      id: 'affectedObject',
      header: t('app.findings.columns.target'),
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

    // 10. Actions Column
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => <RowActions row={row} />,
      size: 60,
    },
  ];
}
