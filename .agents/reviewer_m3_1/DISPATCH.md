## 2026-09-24T05:58:56Z

You are reviewer_m3_1, a teamwork_preview_reviewer.
Your working directory is H:/erppreflight/.agents/reviewer_m3_1.
You MUST follow the File Workspace Convention: write ONLY within your working directory.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MISSION:
Independently review the Milestone 3 TanStack Query and DataTable primitives authored by worker_m3_1:
- worker_m3_1 handoff: H:/erppreflight/.agents/worker_m3_1/handoff.md
- apps/web/src/lib/query/query-client.ts
- apps/web/src/lib/query/query-provider.tsx
- apps/web/src/lib/query/query-keys.ts
- apps/web/src/app/layout.tsx
- apps/web/src/components/data-table/data-table.tsx
- apps/web/src/components/data-table/data-table-toolbar.tsx
- apps/web/src/components/data-table/data-table-pagination.tsx
- apps/web/src/components/data-table/data-table-column-header.tsx
- apps/web/src/components/data-table/data-table-faceted-filter.tsx
- apps/web/src/components/data-table/data-table-view-options.tsx
- apps/web/src/components/data-table/data-table-bulk-actions.tsx
- apps/web/src/components/data-table/data-table-empty-state.tsx
- apps/web/src/components/data-table/types.ts
- apps/web/src/hooks/useTableUrlSync.ts
- apps/web/src/lib/export.ts

Verify:
1. SSR-safe QueryClient: Does isServer check guarantee a fresh client per request on the server to prevent cross-tenant data leaks, and persistent singleton on browser?
2. QueryProvider: Does evictTenantQueryCache() call cancelQueries() before clear() to prevent lingering in-flight request race conditions?
3. DataTable & Virtualization: Does it use compound <tbody> measurement (<tbody ref={rowVirtualizer.measureElement} data-index={virtualRow.index}>) for expandable detail rows? Does it use spacer elements for virtualization offsets?
4. Full Dataset Export: Does exportToCsv prepend UTF-8 BOM (\uFEFF) and escape RFC 4180 CSV characters? Does triggerExport export all filtered/selected rows rather than just the visible viewport rows?
5. Run verification commands:
   node scripts/check-no-dependency-soup.mjs
   npx pnpm --filter @erppreflight/web typecheck
   npx pnpm run build
   npx pnpm test

OUTPUT:
Write your review report to H:/erppreflight/.agents/reviewer_m3_1/handoff.md.
State your clear verdict: APPROVE or REQUEST_CHANGES.
Send message to parent when done.
