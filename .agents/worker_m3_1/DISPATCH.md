## 2026-09-24T05:49:17Z
You are worker_m3_1, a teamwork_preview_worker.
Your working directory is H:/erppreflight/.agents/worker_m3_1.
You MUST follow the File Workspace Convention: write metadata only in your working directory. For target files, see Exclusive Write Ownership below.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
You own exclusively:
1. H:/erppreflight/apps/web/src/lib/query/* (query-client.ts, query-provider.tsx, query-keys.ts)
2. H:/erppreflight/apps/web/src/app/layout.tsx
3. H:/erppreflight/apps/web/src/components/data-table/* (data-table.tsx, data-table-toolbar.tsx, data-table-pagination.tsx, data-table-column-header.tsx, data-table-faceted-filter.tsx, data-table-view-options.tsx)
4. H:/erppreflight/apps/web/src/components/form/* (form-field.tsx, form-inputs.tsx)
5. H:/erppreflight/apps/web/src/hooks/useTableUrlSync.ts
6. H:/erppreflight/apps/web/src/hooks/useUnsavedChangesGuard.ts
7. H:/erppreflight/apps/web/src/hooks/pacer/* (useDebouncedValue.ts, useThrottledCallback.ts, useBatchQueue.ts)
8. H:/erppreflight/apps/web/src/lib/export.ts

INPUT BLUEPRINTS:
Read and strictly implement the production-tested code from:
- H:/erppreflight/.agents/explorer_m3_query_1/handoff.md (QueryClient factory, QueryProvider, query keys, layout wrapping)
- H:/erppreflight/.agents/explorer_m3_table_1/handoff.md (DataTable primitives, compound tbody virtualization, useTableUrlSync, export.ts)
- H:/erppreflight/.agents/explorer_m3_form_pacer_1/handoff.md (FormField, Form inputs, useUnsavedChangesGuard, Pacer hooks)

TASKS:
1. Implement apps/web/src/lib/query/query-client.ts, query-provider.tsx, query-keys.ts.
2. Update apps/web/src/app/layout.tsx wrapping children in QueryProvider.
3. Implement apps/web/src/components/data-table/ suite (DataTable with optional @tanstack/react-virtual virtualization, compound <tbody> measurement, toolbar, pagination, column options, faceted filters).
4. Implement apps/web/src/hooks/useTableUrlSync.ts and apps/web/src/lib/export.ts (CSV & JSON export).
5. Implement apps/web/src/components/form/ (form-field.tsx and form-inputs.tsx with full WCAG 2.2 AA ARIA accessibility).
6. Implement apps/web/src/hooks/useUnsavedChangesGuard.ts.
7. Implement apps/web/src/hooks/pacer/ (useDebouncedValue.ts, useThrottledCallback.ts, useBatchQueue.ts).
8. Run `pnpm run check:deps`, `pnpm run typecheck`, and `pnpm run build` to confirm 100% clean compilation.
9. Write handoff report to H:/erppreflight/.agents/worker_m3_1/handoff.md and send message when complete.
