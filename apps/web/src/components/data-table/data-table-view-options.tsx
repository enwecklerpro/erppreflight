'use client';

import * as React from 'react';
import { Table } from '@tanstack/react-table';
import { SlidersHorizontal, Check } from 'lucide-react';
import { cn } from './types';
import { useT } from '../../i18n/client';

export interface DataTableViewOptionsProps<TData> {
  table: Table<TData>;
}

export function DataTableViewOptions<TData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const hideableColumns = table
    .getAllColumns()
    .filter((column) => typeof column.accessorFn !== 'undefined' && column.getCanHide());

  return (
    <div ref={menuRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40 shadow-xs transition-colors"
        aria-expanded={open}
        aria-label={t('app.dataTable.toggleColumnsLabel')}
      >
        <SlidersHorizontal className="size-3.5 text-muted-foreground" />
        <span>{t('app.dataTable.columns')}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1.5 w-48 overflow-hidden rounded-xl border border-border bg-card p-1.5 text-foreground shadow-xl animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider select-none">
            {t('app.dataTable.toggleColumns')}
          </div>
          <div className="h-px bg-border my-1" />

          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {hideableColumns.map((column) => {
              const isVisible = column.getIsVisible();
              return (
                <button
                  type="button"
                  key={column.id}
                  role="menuitemcheckbox"
                  aria-checked={isVisible}
                  onClick={() => column.toggleVisibility(!isVisible)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-foreground hover:bg-muted transition-colors text-left capitalize select-none',
                    isVisible && 'font-medium'
                  )}
                >
                  <div
                    className={cn(
                      'flex size-4 items-center justify-center rounded border border-border transition-colors',
                      isVisible
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'bg-card'
                    )}
                  >
                    {isVisible && <Check className="size-3 stroke-[3]" />}
                  </div>
                  <span>{column.id.replace(/_/g, ' ')}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
