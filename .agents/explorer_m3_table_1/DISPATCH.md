## 2026-09-24T05:41:13Z
Mission: Milestone 3 (TanStack Table & Virtualization Architecture)
1. Design reusable enterprise DataTable primitives in apps/web/src/components/data-table/:
   - `data-table.tsx`: Core wrapper around @tanstack/react-table with optional @tanstack/react-virtual virtualization.
   - Multi-column sorting, facet filtering, column visibility toggles, pagination, and bulk selection.
   - Virtualization with compound <tbody> container grouping base and expanded rows, with `ref={rowVirtualizer.measureElement}` per virtual index.
   - Support for 10,000+ rows without DOM bloat.
   - `data-table-toolbar.tsx`, `data-table-pagination.tsx`, `data-table-column-header.tsx`, `data-table-faceted-filter.tsx`, `data-table-view-options.tsx`.
2. Design `useTableUrlSync.ts` hook for bi-directional synchronization of table state (page, pageSize, sort, filters) with Next.js App Router URL search parameters.
3. Design export utility (`triggerExport`) for full dataset export to CSV and JSON.
Output: detailed implementation blueprint and code to H:/erppreflight/.agents/explorer_m3_table_1/handoff.md. Send message to parent when done.
