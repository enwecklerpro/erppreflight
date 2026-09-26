'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CalendarClock } from 'lucide-react';
import { FindingStatusEnum, type Finding, type FindingStatus } from '@erppreflight/schemas';
import type { FilterDef } from '../data-table/types';
import type { TFunction } from '@/i18n/translate';
import type { FindingWithLifecycle } from '@/lib/api/findings-lifecycle';
import { FindingStatusBadge } from './finding-status-badge';

const CLOSED: readonly string[] = ['RESOLVED', 'FALSE_POSITIVE', 'ACCEPTED_RISK', 'SUPPRESSED'];

const lc = (f: Finding) => (f as FindingWithLifecycle).lifecycle;

/** Server-side filters (status / assignee / due) as faceted filters synced to the URL. */
export function findingLifecycleFilters(t: TFunction): FilterDef[] {
  return [
    {
      id: 'status',
      title: t('findingLifecycle.table.statusFilter'),
      options: FindingStatusEnum.options.map((s) => ({ label: t(`findingLifecycle.status.${s}`), value: s })),
    },
    {
      id: 'assignee',
      title: t('findingLifecycle.table.assigneeFilter'),
      singleSelect: true,
      options: [
        { label: t('findingLifecycle.table.assigneeMe'), value: 'me' },
        { label: t('findingLifecycle.table.assigneeNone'), value: 'unassigned' },
      ],
    },
    {
      id: 'due',
      title: t('findingLifecycle.table.dueFilter'),
      singleSelect: true,
      options: [
        { label: t('findingLifecycle.table.dueOverdue'), value: 'overdue' },
        { label: t('findingLifecycle.table.dueSoon'), value: 'due_soon' },
        { label: t('findingLifecycle.table.dueNone'), value: 'no_due_date' },
      ],
    },
  ];
}

/** Status, assignee and due-date columns; inserted after the title column. */
export function withLifecycleColumns(base: ColumnDef<Finding>[], t: TFunction): ColumnDef<Finding>[] {
  const today = new Date().toISOString().slice(0, 10);
  const extra: ColumnDef<Finding>[] = [
    {
      id: 'status',
      header: t('findingLifecycle.table.statusColumn'),
      accessorFn: (row) => lc(row)?.status ?? 'OPEN',
      cell: ({ row }) => <FindingStatusBadge status={(lc(row.original)?.status ?? 'OPEN') as FindingStatus} size="sm" />,
      // Server already filtered; keep the current page consistent with the selection.
      filterFn: (row, id, value: string[]) => !value?.length || value.includes(String(row.getValue(id))),
      size: 170,
    },
    {
      id: 'assignee',
      header: t('findingLifecycle.table.ownerColumn'),
      accessorFn: (row) => lc(row)?.assignee?.email ?? '',
      cell: ({ row }) => {
        const l = lc(row.original);
        const who = l?.assignee ? l.assignee.fullName || l.assignee.email : null;
        return (
          <span className="text-xs text-foreground truncate block max-w-[180px]" title={who ?? undefined}>
            {who ?? <span className="text-muted-foreground">{t('findingLifecycle.assignment.unassigned')}</span>}
          </span>
        );
      },
      filterFn: () => true,
      enableSorting: false,
      size: 170,
    },
    {
      id: 'due',
      header: t('findingLifecycle.assignment.dueDate'),
      accessorFn: (row) => lc(row)?.dueDate ?? '',
      cell: ({ row }) => {
        const l = lc(row.original);
        if (!l?.dueDate) return <span className="text-xs text-muted-foreground">—</span>;
        const overdue = l.dueDate < today && !CLOSED.includes(l.status);
        return (
          <span className={`inline-flex items-center gap-1 text-xs font-mono ${overdue ? 'font-semibold text-destructive' : 'text-foreground'}`}>
            {overdue && <CalendarClock className="size-3" aria-hidden="true" />}
            {l.dueDate}
            {overdue && <span className="sr-only">{t('findingLifecycle.assignment.overdue')}</span>}
          </span>
        );
      },
      filterFn: () => true,
      size: 120,
    },
  ];
  const idx = base.findIndex((c) => c.id === 'title');
  return idx < 0 ? [...base, ...extra] : [...base.slice(0, idx + 1), ...extra, ...base.slice(idx + 1)];
}
