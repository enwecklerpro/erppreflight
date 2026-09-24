'use client';

import * as React from 'react';
import { Column } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, EyeOff } from 'lucide-react';
import { cn } from './types';

export interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
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

  if (!column.getCanSort()) {
    return <div className={cn('text-xs font-semibold', className)}>{title}</div>;
  }

  const isSorted = column.getIsSorted();
  const ariaSort =
    isSorted === 'desc' ? 'descending' : isSorted === 'asc' ? 'ascending' : 'none';

  return (
    <div
      ref={menuRef}
      className={cn('relative inline-flex items-center gap-1', className)}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/80 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
        aria-expanded={open}
        aria-label={`Sort options for ${title}`}
      >
        <span>{title}</span>
        {isSorted === 'desc' ? (
          <ArrowDown className="size-3.5 text-primary" aria-hidden="true" />
        ) : isSorted === 'asc' ? (
          <ArrowUp className="size-3.5 text-primary" aria-hidden="true" />
        ) : (
          <ChevronsUpDown className="size-3.5 text-muted-foreground/60" aria-hidden="true" />
        )}
      </button>

      {/* Accessible Dropdown Menu */}
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-[9rem] overflow-hidden rounded-lg border border-border bg-card p-1 text-foreground shadow-lg animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              column.toggleSorting(false);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted transition-colors text-left"
          >
            <ArrowUp className="size-3.5 text-muted-foreground" />
            <span>Sort Ascending</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              column.toggleSorting(true);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted transition-colors text-left"
          >
            <ArrowDown className="size-3.5 text-muted-foreground" />
            <span>Sort Descending</span>
          </button>

          {isSorted && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                column.clearSorting();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-left"
            >
              <ChevronsUpDown className="size-3.5" />
              <span>Clear Sort</span>
            </button>
          )}

          {column.getCanHide() && (
            <>
              <div className="h-px bg-border my-1" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  column.toggleVisibility(false);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-left"
              >
                <EyeOff className="size-3.5" />
                <span>Hide Column</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
