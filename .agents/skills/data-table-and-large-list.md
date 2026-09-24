# ERP Preflight Engineering Playbook: Enterprise Data Table & Large List Virtualization

> **Playbook Identifier**: `data-table-and-large-list`  
> **Authority**: Binding architectural playbook for all tabular data grids, finding tables, SAP object catalogs, and event streams.  
> **Governing Standards**: TanStack Table v8, TanStack Virtual v3, Next.js 15+ App Router, WCAG 2.2 AA.  
> **Anchored Cardinal Axiom**: **Cardinal Axiom 1: *"A page that renders is not a completed feature."*** (Defined in `AGENTS.md` Section 1)  
> **Applicable Trigger**: Creating or maintaining data grids, finding tables, SAP object inventories, migration catalogs, admin user tables, or MFS telegram logs.

---

## 1. Metadata & Trigger Definition

- **Canonical File Path**: `/.agents/skills/data-table-and-large-list.md`
- **Domain Scope**: High-volume tabular representations, server-side data windowing, URL query parameter synchronization, dynamic row height virtualization, accessible keyboard navigation, bulk row actions, and streaming data export.
- **Trigger Conditions**:
  - Authoring or modifying any table view displaying findings, objects, transports, or logs in `apps/web/src/components/data-table/` or feature pages.
  - Implementing pagination, multi-column sorting, faceted filters, or global text search on datasets exceeding 100 rows.
  - Rendering large datasets (e.g. 100,000+ SAP objects or 500,000+ MFS telegrams) requiring virtualization.
  - Adding CSV, JSON, or Excel export capabilities to tabular views.

### 1.1 Cardinal Axiom 1 Anchoring: Tabular Data Completeness
This playbook operationalizes **Cardinal Axiom 1** for tabular data grids. Rendering static rows or dumping 10,000 DOM elements is an incomplete, defective implementation. A data grid feature is complete **only** when:
- Backend pagination, multi-column sorting, and facet filtering are bound to URL query parameters via TanStack Query.
- Virtualization via `@tanstack/react-virtual` limits the active DOM footprint to ~30 rows regardless of dataset scale.
- Loading skeletons preserve exact table column geometry, avoiding cumulative layout shift (CLS).
- Row severity displays pair color tokens with explicit icons and text.
- Keyboard navigation (`ArrowDown`, `ArrowUp`, `Space`, `Enter`) and screen reader ARIA landmarks (`role="region"`, `role="grid"`) are fully operable.


---

## 2. Canonical Table Architecture & Directory Layout

To maintain modularity and consistency across features, all data tables build on a standard directory architecture:

```text
apps/web/src/components/data-table/
├── data-table.tsx               # Primary container & TanStack Table instance
├── data-table-virtual.tsx       # Virtualized row renderer (@tanstack/react-virtual)
├── data-table-toolbar.tsx       # Global search input, filter popovers, view toggles
├── data-table-filters.tsx       # Faceted multi-select filter components
├── data-table-pagination.tsx    # Page navigation and page-size selector
├── data-table-bulk-actions.tsx  # Floating batch selection toolbar (Export, Assign, Resolve)
├── data-table-column-menu.tsx   # Column visibility and pinning dropdown
├── data-table-export.tsx        # Full-dataset streaming export triggers
├── data-table-empty-state.tsx   # Contextual empty, error, and zero-result displays
├── use-table-url-sync.ts        # Bidirectional URL search param synchronization hook
└── types.ts                    # Standardized TableState, FilterDef, and ColumnMeta types
```

---

## 3. Server-Side Execution Model (Pagination, Sorting, Filtering, Search)

### 3.1 Two-Tier Execution Axiom
1. **Tier 1 (Server-Side Execution)**: For datasets exceeding 500 records (e.g. enterprise findings and SAP catalog tables), pagination, multi-column sorting, facet filtering, and text search MUST execute on the backend database. Downloading 50,000+ records to the browser for client-side filtering is strictly prohibited.
2. **Tier 2 (Client-Side Virtualization)**: The client browser virtualizes the active server page window (typically 50–500 rows) or large client buffers using `@tanstack/react-virtual`, maintaining a lightweight DOM footprint (~20–30 rendered rows).

---

## 4. URL Synchronization Protocol (`useTableUrlSync`)

### 4.1 Single Source of Truth
Table filter, sort, page, and search parameters must be stored directly in URL search parameters. This enables deep-linking, bookmarking, browser back/forward navigation, and reproducible audit sessions without duplicating state in Redux or Zustand.

```typescript
// apps/web/src/components/data-table/use-table-url-sync.ts
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

export interface TableUrlState {
  page: number;
  pageSize: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters: Record<string, string[]>;
}

export function useTableUrlSync(defaultPageSize = 50) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state: TableUrlState = useMemo(() => {
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.max(10, parseInt(searchParams.get('pageSize') || String(defaultPageSize), 10));
    const sort = searchParams.get('sort');
    let sortField: string | undefined;
    let sortOrder: 'asc' | 'desc' | undefined;

    if (sort) {
      const parts = sort.split('.');
      sortField = parts[0];
      sortOrder = parts[1] === 'desc' ? 'desc' : 'asc';
    }

    const search = searchParams.get('search') || undefined;
    const filters: Record<string, string[]> = {};

    searchParams.forEach((value, key) => {
      if (!['page', 'pageSize', 'sort', 'search'].includes(key)) {
        filters[key] = value.split(',').filter(Boolean);
      }
    });

    return { page, pageSize, sortField, sortOrder, search, filters };
  }, [searchParams, defaultPageSize]);

  const updateUrl = useCallback(
    (newState: Partial<TableUrlState>) => {
      const current = new URLSearchParams(searchParams.toString());

      if (newState.page !== undefined) {
        if (newState.page > 1) current.set('page', String(newState.page));
        else current.delete('page');
      }

      if (newState.pageSize !== undefined) {
        if (newState.pageSize !== defaultPageSize) current.set('pageSize', String(newState.pageSize));
        else current.delete('pageSize');
      }

      if (newState.sortField !== undefined) {
        if (newState.sortField) {
          current.set('sort', `${newState.sortField}.${newState.sortOrder || 'asc'}`);
        } else {
          current.delete('sort');
        }
      }

      if (newState.search !== undefined) {
        if (newState.search.trim()) current.set('search', newState.search.trim());
        else current.delete('search');
      }

      if (newState.filters) {
        Object.entries(newState.filters).forEach(([key, values]) => {
          if (values && values.length > 0) {
            current.set(key, values.join(','));
          } else {
            current.delete(key);
          }
        });
      }

      router.replace(`${pathname}?${current.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams, defaultPageSize]
  );

  return { state, updateUrl };
}
```

---

## 5. Virtualization Engine & Dynamic Row Heights (`@tanstack/react-virtual`)

### 5.1 Dynamic Measurement Standard
Findings and log rows contain expandable details (code snippets, SHA-256 hashes, remediation steps) that vary in height from 48px to 400px+. The virtualizer must attach `rowVirtualizer.measureElement` to DOM rows to automatically compute dynamic heights without visual glitching.

```tsx
// apps/web/src/components/data-table/data-table-virtual.tsx
'use client';

import * as React from 'react';
import { Table, flexRender, Row } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

interface VirtualizedDataTableProps<TData> {
  table: Table<TData>;
  containerHeight?: number | string;
  renderExpandedRow?: (row: Row<TData>) => React.ReactNode;
}

export function VirtualizedDataTable<TData>({
  table,
  containerHeight = '650px',
  renderExpandedRow,
}: VirtualizedDataTableProps<TData>) {
  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 52, // Baseline row height in pixels
    overscan: 8,            // Pre-render 8 buffer rows above and below viewport
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

  return (
    <div
      ref={tableContainerRef}
      style={{ height: containerHeight }}
      className="relative overflow-auto border border-border rounded-xl bg-card shadow-xs focus:outline-none"
      tabIndex={0}
      role="region"
      aria-label="Virtualized Findings Grid"
    >
      <table className="w-full text-left text-sm border-collapse">
        <thead className="sticky top-0 z-20 bg-muted/90 backdrop-blur-xs border-b border-border shadow-xs">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                  className="px-4 py-3 font-semibold text-xs text-muted-foreground uppercase tracking-wider select-none"
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        {/* Top Virtual Padding Spacer */}
        {paddingTop > 0 && (
          <tbody>
            <tr>
              <td
                style={{ height: `${paddingTop}px` }}
                colSpan={table.getVisibleLeafColumns().length}
                aria-hidden="true"
              />
            </tr>
          </tbody>
        )}

        {/* Virtualized Compound Row Groups */}
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          const isExpanded = row.getIsExpanded();

          return (
            <tbody
              key={row.id}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className={`border-b border-border/60 transition-colors ${
                row.getIsSelected() ? 'bg-primary/5' : ''
              }`}
            >
              {/* Primary Row */}
              <tr className="hover:bg-muted/40 transition-colors">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3 text-foreground align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>

              {/* Dynamic Height Expanded Finding Remediation & Evidence */}
              {isExpanded && renderExpandedRow && (
                <tr className="border-t border-border/40 bg-muted/20">
                  <td colSpan={table.getVisibleLeafColumns().length} className="p-4">
                    {renderExpandedRow(row)}
                  </td>
                </tr>
              )}
            </tbody>
          );
        })}

        {/* Bottom Virtual Padding Spacer */}
        {paddingBottom > 0 && (
          <tbody>
            <tr>
              <td
                style={{ height: `${paddingBottom}px` }}
                colSpan={table.getVisibleLeafColumns().length}
                aria-hidden="true"
              />
            </tr>
          </tbody>
        )}
      </table>
    </div>
  );
}
```

---

## 6. Row Selection, Bulk Actions & Stable Identifiers

### 6.1 Stable Unique Identifiers
- Every row model must provide a stable unique string ID: `getRowId: (row) => row.id`.
- **Strictly Forbidden**: Array indices must never be used as row identifiers.

### 6.2 Bulk Action Capabilities
When one or more rows are selected via checkbox, display a floating bulk action bar exposing:
1. **Export Selected**: Stream selected finding IDs as JSON or CSV.
2. **Assign Consultant**: Batch assign remediation ownership.
3. **Accept Clean Core Deviation**: Batch accept risk with documented justification.
4. **Mark Resolved**: Batch resolve verified issues.

---

## 7. Full-Dataset Server-Side Export Architecture

### 7.1 The Complete Dataset Export Invariant
Export actions (CSV, JSON, XLSX) must execute against backend export endpoints passing all active URL filters. It is strictly forbidden to export only the visible 20–50 rows rendered in the virtualized DOM.

```typescript
// apps/web/src/components/data-table/export-handler.ts
export async function triggerServerExport({
  projectId,
  filters,
  search,
  format,
}: {
  projectId: string;
  filters: Record<string, string[]>;
  search?: string;
  format: 'csv' | 'json' | 'xlsx';
}) {
  const query = new URLSearchParams({
    format,
    ...(search ? { search } : {}),
    ...Object.fromEntries(
      Object.entries(filters).map(([k, v]) => [k, v.join(',')])
    ),
  });

  const response = await fetch(`/api/v1/projects/${projectId}/findings/export?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: format === 'json' ? 'application/json' : 'text/csv' },
  });

  if (!response.ok) {
    throw new Error(`Export failed with HTTP status ${response.status}`);
  }

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `preflight-findings-${projectId}-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
```

---

## 8. Keyboard Navigation & Screen-Reader Grid Semantics

1. **Table Region Landmark**: The outer scroll container must provide `role="region"`, `aria-label="Findings Data Grid"`, and `tabIndex={0}`.
2. **Selection State**: Rows convey selection status via `aria-selected={row.getIsSelected()}`.
3. **Row Selection Checkboxes**: Each checkbox must provide an explicit `aria-label={`Select row ${row.original.ruleId}`}`.
4. **Keyboard Shortcuts**:
   - `ArrowDown` / `ArrowUp`: Move focus between rows.
   - `Space`: Toggle row selection.
   - `Enter`: Expand or collapse finding detail row.

---

## 9. Non-Negotiable Invariants

1. **No Massive Client Fetches**: Never download >500 records to the client for client-side pagination. Server pagination is mandatory.
2. **Mandatory Virtualization**: Datasets with >100 visible items must be virtualized via `@tanstack/react-virtual`.
3. **Stable Identifiers**: `getRowId: (row) => row.id` is mandatory. Array index keys are forbidden.
4. **URL Single Source of Truth**: All filter, sort, page, and search parameters must sync bidirectionally with URL search parameters.
5. **Full Export Invariant**: Exporting data must stream the entire filtered dataset from the server, never just visible DOM rows.

### 9.1 Strictly Forbidden Competing Libraries (Part 21.42 & AGENTS.md §4.2)
Tabular representations and virtualization must strictly adhere to the single-library standard:
- ❌ **Tabular Data Grids**: `ag-grid-community`, `ag-grid-react`, `ag-grid-enterprise`, `@mui/x-data-grid`, `handsontable`, `react-table` (v7 legacy), `ka-table` (Standard: `@tanstack/react-table` v8).
- ❌ **Virtualization**: `react-window`, `react-virtualized`, `virtuoso` (Standard: `@tanstack/react-virtual` v3).
- ❌ **Pacing & Search Debouncing**: `lodash.debounce`, `lodash.throttle` (Standard: `@tanstack/react-pacer` or native React transitions).
- ❌ **Grid State Stores**: Global `redux` or `mobx` stores for table filters, sorts, and pagination (Standard: URL search parameters via `useTableUrlSync`).
- ❌ **Client DOM Scraping Export**: `jspdf-autotable`, `tableexport` scraping rendered DOM (Standard: Server-side streaming API endpoints).

---

## 10. Anti-Patterns & Corrective Implementations

- ❌ **Anti-Pattern**: `table.getRowModel().rows.slice(0, 20).map(...)` exported to CSV on "Export All".  
  *Violation*: Produces truncated exports missing 99% of customer findings.  
  *Correction*: Call backend streaming export endpoint with active URL search params.

- ❌ **Anti-Pattern**: Storing filter state in a global Redux or Zustand store.  
  *Violation*: Breaks browser back/forward buttons and prevents URL sharing between consultants.  
  *Correction*: Use `useTableUrlSync()` to bind state to URL search parameters.

- ❌ **Anti-Pattern**: Rendering 10,000 DOM `<tr>` elements without virtualization.  
  *Violation*: Freezes the browser UI thread and causes out-of-memory crashes on mobile/laptops.  
  *Correction*: Wrap table body in `VirtualizedDataTable` using `@tanstack/react-virtual`.

- ❌ **Anti-Pattern**: Attaching `ref={rowVirtualizer.measureElement}` with the same `data-index` to both the primary `<tr>` and the expanded `<tr>`.  
  *Violation*: Clobbers TanStack Virtual measurement cache, cuts measured row height by >50%, and causes subsequent rows to visually overlap.  
  *Correction*: Wrap primary and expanded rows within a single compound container (e.g. `<tbody ref={rowVirtualizer.measureElement} data-index={virtualRow.index}>`) so the entire compound bounding box is measured as a unified entity.

