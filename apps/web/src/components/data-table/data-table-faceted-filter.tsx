'use client';

import * as React from 'react';
import { Column } from '@tanstack/react-table';
import { Check, PlusCircle, Search, X } from 'lucide-react';
import { cn, FilterOption } from './types';

export interface DataTableFacetedFilterProps<TData, TValue> {
  column?: Column<TData, TValue>;
  title: string;
  options: FilterOption[];
  singleSelect?: boolean;
}

export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
  singleSelect = false,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const popoverRef = React.useRef<HTMLDivElement>(null);

  const selectedValues = new Set((column?.getFilterValue() as string[]) || []);

  React.useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (val: string) => {
    if (singleSelect) {
      if (selectedValues.has(val)) {
        column?.setFilterValue(undefined);
      } else {
        column?.setFilterValue([val]);
      }
      setOpen(false);
      return;
    }

    const next = new Set(selectedValues);
    if (next.has(val)) {
      next.delete(val);
    } else {
      next.add(val);
    }
    const filterArray = Array.from(next);
    column?.setFilterValue(filterArray.length > 0 ? filterArray : undefined);
  };

  const handleClear = () => {
    column?.setFilterValue(undefined);
    setSearch('');
  };

  return (
    <div ref={popoverRef} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/80 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors shadow-xs',
          selectedValues.size > 0 && 'border-solid border-primary/50 bg-primary/5'
        )}
        aria-expanded={open}
        aria-label={`Filter by ${title}`}
      >
        <PlusCircle className="size-3.5 text-muted-foreground" />
        <span>{title}</span>

        {selectedValues.size > 0 && (
          <>
            <div className="h-3 w-px bg-border mx-0.5" />
            <div className="flex items-center gap-1">
              {selectedValues.size <= 2 ? (
                options
                  .filter((opt) => selectedValues.has(opt.value))
                  .map((opt) => (
                    <span
                      key={opt.value}
                      className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                    >
                      {opt.label}
                    </span>
                  ))
              ) : (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {selectedValues.size} selected
                </span>
              )}
            </div>
          </>
        )}
      </button>

      {/* Facet Filter Popover */}
      {open && (
        <div
          role="dialog"
          aria-label={`${title} filter popover`}
          className="absolute left-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-xl border border-border bg-card p-1.5 text-foreground shadow-xl animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Quick Search inside popover */}
          <div className="relative mb-1 px-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Filter ${title.toLowerCase()}...`}
              className="w-full rounded-md border border-input bg-background pl-8 pr-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5 p-1">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                No matching options
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = selectedValues.has(option.value);
                const IconComponent = option.icon;

                return (
                  <button
                    type="button"
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs cursor-pointer select-none transition-colors hover:bg-muted text-left',
                      isSelected && 'bg-primary/5 font-medium'
                    )}
                    role="checkbox"
                    aria-checked={isSelected}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'flex size-4 items-center justify-center rounded border border-border transition-colors',
                          isSelected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'bg-card'
                        )}
                      >
                        {isSelected && <Check className="size-3 stroke-[3]" />}
                      </div>
                      {IconComponent && (
                        <IconComponent className="size-3.5 text-muted-foreground" />
                      )}
                      <span>{option.label}</span>
                    </div>

                    {option.count !== undefined && (
                      <span className="font-mono text-[10px] text-muted-foreground ml-auto pl-2">
                        {option.count}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {selectedValues.size > 0 && (
            <>
              <div className="h-px bg-border my-1" />
              <button
                type="button"
                onClick={handleClear}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors font-medium"
              >
                <X className="size-3.5" />
                <span>Clear filters</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
