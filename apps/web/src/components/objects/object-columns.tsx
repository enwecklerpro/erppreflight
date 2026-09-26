import * as React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { SapObject } from '@erppreflight/schemas';
import { ObjectTierBadge } from './object-tier-badge';
import { ObjectTypeBadge } from './object-type-badge';
import { FilterDef } from '../data-table/types';
import { CheckCircle, AlertTriangle, OctagonAlert, ChevronRight } from 'lucide-react';
import type { AppFormat } from '../../i18n/client';
import type { TFunction } from '../../i18n/translate';

const TYPE_FILTERS = ['PROG', 'CLAS', 'TABL', 'CDS', 'FUGR', 'INTF', 'FORM', 'TRAN'] as const;
const TIERS = ['TIER_1_CLOUD', 'TIER_2_DEVELOPER', 'TIER_3_CLASSIC'] as const;

/**
 * Faceted filters for the object inventory. Package options are derived from
 * the loaded objects (never a fixed list), so they always match the data.
 */
export function buildObjectFacetedFilters(objects: SapObject[], t: TFunction): FilterDef[] {
  const packages = Array.from(new Set(objects.map((o) => o.package).filter(Boolean))).sort();
  return [
    {
      id: 'objectType',
      title: t('app.objects.filter.objectType'),
      options: TYPE_FILTERS.map((type) => ({ value: type, label: `${type} (${t(`app.objects.typeName.${type}`)})` })),
    },
    {
      id: 'cleanCoreTier',
      title: t('app.objects.filter.cleanCoreTier'),
      options: TIERS.map((tier) => ({ value: tier, label: t(`app.objects.tier.${tier}.label`) })),
    },
    {
      id: 'package',
      title: t('app.objects.filter.package'),
      options: packages.map((pkg) => ({ value: pkg, label: pkg })),
    },
  ];
}

const inList = (row: { getValue: (id: string) => unknown }, id: string, filterValues: string[]) =>
  !filterValues || filterValues.length === 0 || filterValues.includes(String(row.getValue(id)));

export function getObjectColumns({
  onSelectObject,
  t,
  fmt,
}: {
  onSelectObject: (obj: SapObject) => void;
  t: TFunction;
  fmt: AppFormat;
}): ColumnDef<SapObject>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          onChange={(e) => table.toggleAllPageRowsSelected(!!e.target.checked)}
          aria-label={t('app.objects.col.selectAll')}
          className="size-4 rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={(e) => row.toggleSelected(!!e.target.checked)}
          aria-label={t('app.objects.col.select', { name: row.original.name })}
          className="size-4 rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
    },
    {
      accessorKey: 'name',
      id: 'name',
      header: t('app.objects.col.name'),
      cell: ({ row }) => {
        const obj = row.original;
        return (
          <button
            type="button"
            className="flex flex-col text-left group rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onClick={() => onSelectObject(obj)}
            aria-label={t('app.objects.col.inspect', { name: obj.name })}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-foreground group-hover:text-primary transition-colors">{obj.name}</span>
              {obj.modificationStatus === 'SAP_MODIFIED' && (
                <span className="px-1.5 rounded text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                  {t('app.objects.col.modified')}
                </span>
              )}
            </span>
            {obj.description && <span className="text-xs text-muted-foreground line-clamp-1">{obj.description}</span>}
          </button>
        );
      },
      size: 220,
    },
    {
      accessorKey: 'objectType',
      id: 'objectType',
      header: t('app.objects.col.type'),
      cell: ({ row }) => <ObjectTypeBadge type={row.original.objectType} />,
      filterFn: inList,
      size: 90,
    },
    {
      accessorKey: 'package',
      id: 'package',
      header: t('app.objects.col.package'),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs text-foreground font-medium">{row.original.package}</span>
          <span className="text-xs text-muted-foreground">{row.original.softwareComponent}</span>
        </div>
      ),
      filterFn: inList,
      size: 140,
    },
    {
      accessorKey: 'cleanCoreTier',
      id: 'cleanCoreTier',
      header: t('app.objects.col.tier'),
      cell: ({ row }) => <ObjectTierBadge tier={row.original.cleanCoreTier} size="sm" />,
      filterFn: inList,
      size: 150,
    },
    {
      id: 'findingsCount',
      accessorFn: (row) => row.findingSummary.totalCount,
      header: t('app.objects.col.findings'),
      cell: ({ row }) => {
        const { totalCount, blockerCount, criticalCount } = row.original.findingSummary;
        if (totalCount === 0) {
          return (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle className="size-3.5" aria-hidden="true" />
              <span>{t('app.objects.col.clean')}</span>
            </span>
          );
        }
        return (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            onClick={() => onSelectObject(row.original)}
            aria-label={t('app.objects.col.viewFindings', { count: totalCount, name: row.original.name })}
          >
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold border flex items-center gap-1 ${
                blockerCount > 0
                  ? 'bg-red-50 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
                  : criticalCount > 0
                  ? 'bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800'
                  : 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
              }`}
            >
              {blockerCount > 0 ? <OctagonAlert className="size-3" aria-hidden="true" /> : <AlertTriangle className="size-3" aria-hidden="true" />}
              {t('app.objects.col.findingsCount', { count: totalCount })}
            </span>
            {blockerCount > 0 && (
              <span className="text-xs font-bold text-red-600 dark:text-red-400">{t('app.objects.col.blockers', { count: blockerCount })}</span>
            )}
          </button>
        );
      },
      size: 150,
    },
    {
      id: 'complexity',
      accessorFn: (row) => row.complexity.score,
      header: t('app.objects.col.complexity'),
      cell: ({ row }) => {
        const { score, level, linesOfCode } = row.original.complexity;
        return (
          <div className="flex flex-col gap-0.5">
            <span
              className={`text-xs font-semibold ${
                level === 'VERY_HIGH'
                  ? 'text-red-600 dark:text-red-400'
                  : level === 'HIGH'
                  ? 'text-orange-600 dark:text-orange-400'
                  : level === 'MEDIUM'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {t(`app.objects.complexityLevel.${level}`)} ({fmt.number(score)})
            </span>
            <span className="text-xs text-muted-foreground">{t('app.objects.col.loc', { count: fmt.number(linesOfCode) })}</span>
          </div>
        );
      },
      size: 130,
    },
    {
      accessorKey: 'lastChangedAt',
      id: 'lastChangedAt',
      header: t('app.objects.col.lastChanged'),
      cell: ({ row }) => {
        const { lastChangedAt, lastChangedBy, transportRequest } = row.original;
        return (
          <div className="flex flex-col">
            <span className="text-xs text-foreground font-medium">{fmt.date(lastChangedAt)}</span>
            <span className="text-xs text-muted-foreground">
              {t('app.objects.col.changedBy', { author: lastChangedBy })}
              {transportRequest ? ` · ${transportRequest}` : ''}
            </span>
          </div>
        );
      },
      size: 160,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onSelectObject(row.original)}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={t('app.objects.col.details', { name: row.original.name })}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      ),
      size: 40,
    },
  ];
}
