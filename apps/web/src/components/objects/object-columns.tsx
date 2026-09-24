import * as React from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { SapObject } from '@erppreflight/schemas';
import { ObjectTierBadge } from './object-tier-badge';
import { ObjectTypeBadge } from './object-type-badge';
import { FilterDef } from '../data-table/types';
import { CheckCircle, AlertTriangle, OctagonAlert, ChevronRight } from 'lucide-react';

export const objectFacetedFilters: FilterDef[] = [
  {
    id: 'objectType',
    title: 'Object Type',
    options: [
      { label: 'PROG (Program)', value: 'PROG' },
      { label: 'CLAS (Class)', value: 'CLAS' },
      { label: 'TABL (Table)', value: 'TABL' },
      { label: 'CDS (CDS View)', value: 'CDS' },
      { label: 'FUGR (Function Group)', value: 'FUGR' },
      { label: 'INTF (Interface)', value: 'INTF' },
      { label: 'FORM (Form Layout)', value: 'FORM' },
      { label: 'TRAN (Transaction)', value: 'TRAN' },
    ],
  },
  {
    id: 'cleanCoreTier',
    title: 'Clean Core Tier',
    options: [
      { label: 'Tier 1: Cloud Compliant', value: 'TIER_1_CLOUD' },
      { label: 'Tier 2: Developer Extensibility', value: 'TIER_2_DEVELOPER' },
      { label: 'Tier 3: Classic Modification', value: 'TIER_3_CLASSIC' },
    ],
  },
  {
    id: 'package',
    title: 'Package',
    options: [
      { label: 'Z_SALES_ORDER', value: 'Z_SALES_ORDER' },
      { label: 'Z_FIN_ACDOCA', value: 'Z_FIN_ACDOCA' },
      { label: 'Z_MM_PURCHASING', value: 'Z_MM_PURCHASING' },
      { label: 'Z_CLEAN_CORE', value: 'Z_CLEAN_CORE' },
      { label: '$TMP (Local)', value: '$TMP' },
    ],
  },
];

export function getObjectColumns({
  onSelectObject,
}: {
  onSelectObject: (obj: SapObject) => void;
}): ColumnDef<SapObject>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          onChange={(e) => table.toggleAllPageRowsSelected(!!e.target.checked)}
          aria-label="Select all objects on page"
          className="size-4 rounded border-border text-primary focus:ring-primary/40 cursor-pointer"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={(e) => row.toggleSelected(!!e.target.checked)}
          aria-label={`Select object ${row.original.name}`}
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
      header: 'Object Name',
      cell: ({ row }) => {
        const obj = row.original;
        return (
          <div
            className="flex flex-col cursor-pointer group text-left"
            onClick={() => onSelectObject(obj)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelectObject(obj)}
            aria-label={`Inspect object ${obj.name}`}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                {obj.name}
              </span>
              {obj.modificationStatus === 'SAP_MODIFIED' && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                  MODIFIED
                </span>
              )}
            </div>
            {obj.description && (
              <span className="text-[11px] text-muted-foreground line-clamp-1">
                {obj.description}
              </span>
            )}
          </div>
        );
      },
      size: 220,
    },
    {
      accessorKey: 'objectType',
      id: 'objectType',
      header: 'Type',
      cell: ({ row }) => <ObjectTypeBadge type={row.original.objectType} />,
      filterFn: (row, id, filterValues: string[]) => {
        if (!filterValues || filterValues.length === 0) return true;
        const cellVal = String(row.getValue(id));
        return filterValues.includes(cellVal);
      },
      size: 90,
    },
    {
      accessorKey: 'package',
      id: 'package',
      header: 'Package',
      cell: ({ row }) => {
        const pkg = row.original.package;
        const swComp = row.original.softwareComponent;
        return (
          <div className="flex flex-col">
            <span className="font-mono text-xs text-foreground font-medium">{pkg}</span>
            <span className="text-[10px] text-muted-foreground">{swComp}</span>
          </div>
        );
      },
      filterFn: (row, id, filterValues: string[]) => {
        if (!filterValues || filterValues.length === 0) return true;
        const cellVal = String(row.getValue(id));
        return filterValues.includes(cellVal);
      },
      size: 140,
    },
    {
      accessorKey: 'cleanCoreTier',
      id: 'cleanCoreTier',
      header: 'Clean Core Tier',
      cell: ({ row }) => <ObjectTierBadge tier={row.original.cleanCoreTier} size="sm" />,
      filterFn: (row, id, filterValues: string[]) => {
        if (!filterValues || filterValues.length === 0) return true;
        const cellVal = String(row.getValue(id));
        return filterValues.includes(cellVal);
      },
      size: 150,
    },
    {
      id: 'findingsCount',
      accessorFn: (row) => row.findingSummary.totalCount,
      header: 'Findings',
      cell: ({ row }) => {
        const { totalCount, blockerCount, criticalCount } = row.original.findingSummary;

        if (totalCount === 0) {
          return (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              <CheckCircle className="size-3.5" aria-hidden="true" />
              <span>0 Clean</span>
            </span>
          );
        }

        return (
          <div
            className="flex items-center gap-1.5 cursor-pointer"
            onClick={() => onSelectObject(row.original)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onSelectObject(row.original)}
            aria-label={`View ${totalCount} findings for ${row.original.name}`}
          >
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold font-mono border flex items-center gap-1 ${
                blockerCount > 0
                  ? 'bg-red-50 text-red-700 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
                  : criticalCount > 0
                  ? 'bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800'
                  : 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
              }`}
            >
              {blockerCount > 0 ? (
                <OctagonAlert className="size-3" aria-hidden="true" />
              ) : (
                <AlertTriangle className="size-3" aria-hidden="true" />
              )}
              {totalCount} {totalCount === 1 ? 'Finding' : 'Findings'}
            </span>
            {blockerCount > 0 && (
              <span className="text-[10px] font-bold text-red-600 dark:text-red-400 font-mono">
                ({blockerCount} Blocker)
              </span>
            )}
          </div>
        );
      },
      size: 140,
    },
    {
      id: 'complexity',
      accessorFn: (row) => row.complexity.score,
      header: 'Complexity',
      cell: ({ row }) => {
        const { score, level, linesOfCode } = row.original.complexity;
        return (
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
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
                {level} ({score})
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">
              {linesOfCode.toLocaleString()} LOC
            </span>
          </div>
        );
      },
      size: 130,
    },
    {
      accessorKey: 'lastChangedAt',
      id: 'lastChangedAt',
      header: 'Last Changed',
      cell: ({ row }) => {
        const dateStr = row.original.lastChangedAt;
        const author = row.original.lastChangedBy;
        const transport = row.original.transportRequest;
        const formattedDate = new Date(dateStr).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
        return (
          <div className="flex flex-col">
            <span className="text-xs text-foreground font-medium">{formattedDate}</span>
            <span className="text-[10px] text-muted-foreground font-mono">
              by {author} {transport && `• ${transport}`}
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
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          aria-label={`View details for ${row.original.name}`}
        >
          <ChevronRight className="size-4" />
        </button>
      ),
      size: 40,
    },
  ];
}
