## 2026-09-24T07:12:17Z

You are worker_m4_2, a teamwork_preview_worker.
Your working directory is H:/erppreflight/.agents/worker_m4_2.
You MUST follow the File Workspace Convention: write metadata ONLY within your working directory. For target files, see Exclusive Write Ownership below.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
You own exclusively:
1. apps/web/src/components/data-table/types.ts
2. apps/web/src/components/data-table/data-table.tsx
3. apps/web/src/components/objects/types.ts
4. apps/web/src/app/projects/[id]/objects/page.tsx
5. apps/web/src/app/projects/[id]/findings/page.tsx
6. apps/web/src/app/inspector/page.tsx
7. apps/web/src/components/findings/finding-columns.tsx
8. apps/web/src/components/findings/finding-detail-row.tsx
9. apps/web/src/lib/export.ts

FEEDBACK TO RESOLVE:
Read:
- H:/erppreflight/.agents/reviewer_m4_1/handoff.md
- H:/erppreflight/.agents/reviewer_m4_2/handoff.md
- H:/erppreflight/.agents/challenger_m4_2/handoff.md
- H:/erppreflight/.agents/orchestrator_tanstack_1/GATE_STATUS.md

TASKS:
1. Bidirectional URL Synchronization & DataTable Controlled State:
   - In apps/web/src/components/data-table/types.ts, update DataTableProps to accept optional tableProps from useTableUrlSync (or controlled state props: columnFilters, onColumnFiltersChange, sorting, onSortingChange, pagination, onPaginationChange, globalFilter, onGlobalFilterChange, searchColumnId, searchPlaceholder).
   - In apps/web/src/components/data-table/data-table.tsx, wire tableProps into useReactTable. Ensure filter, search, sort, and pagination changes in DataTableToolbar / DataTable actively invoke tableProps change handlers so browser URL search params update. If tableProps is omitted, fall back to internal useState.
   - In apps/web/src/app/projects/[id]/findings/page.tsx, apps/web/src/app/projects/[id]/objects/page.tsx, and apps/web/src/app/inspector/page.tsx, pass tableProps={tableProps} to <DataTable>. Verify that URL search params drive the initial table state, and interacting with the toolbar updates URL search params.
2. 10,000 Object Virtualization:
   - In apps/web/src/components/objects/types.ts, in fetchProjectObjects, when enableVirtualization is true or when requesting all objects, do not hard-slice to 50 items. Return all 10,000 objects.
   - In apps/web/src/app/projects/[id]/objects/page.tsx, pass all objects to DataTable so @tanstack/react-virtual v3 actually virtualizes 10,000 rows with a constant ~30 DOM element footprint.
3. Fix Modulo Arithmetic Bug in generateMockSapObjects:
   - In apps/web/src/components/objects/types.ts line 62, replace `const tier = TIERS[(i * 3) % TIERS.length];` (which always evaluates to 0 because (i * 3) % 3 === 0) with a realistic distribution:
     `const tier = i % 5 === 0 ? 'TIER_3_CLASSIC' : i % 3 === 0 ? 'TIER_2_DEVELOPER' : 'TIER_1_CLOUD';`
     Verify Tier 2, Tier 3, Clean Core blockers (CLEAN_CORE_TIER3_DIRECT_DB_MUTATION), and object dependencies are properly populated.
4. Fix Export Fallback:
   - In apps/web/src/lib/export.ts, in triggerExport, wrap server fetch in a try/catch: if serverExportUrl returns 404 or fails, log a warning and fall back to client-side dataset serialization (exportRawData or filtered rows).
   - Remove hardcoded non-existent serverExportUrl from findings/page.tsx, objects/page.tsx, and inspector/page.tsx until API endpoints exist.
5. Minor Fixes:
   - In apps/web/src/components/findings/finding-columns.tsx, update cleanCoreTier filter/accessor so row.affectedObjects?.some(...) evaluates all objects rather than only index [0].
   - In finding-columns.tsx and finding-detail-row.tsx, wrap navigator.clipboard.writeText in .catch(() => {}).
6. Quality Gates:
   - node scripts/check-no-dependency-soup.mjs
   - npx pnpm --filter @erppreflight/schemas build
   - npx pnpm --filter @erppreflight/web typecheck
   - npx pnpm run build
   - npx pnpm test

OUTPUT:
Write your remediation report to H:/erppreflight/.agents/worker_m4_2/handoff.md.
Send message to parent when done.
