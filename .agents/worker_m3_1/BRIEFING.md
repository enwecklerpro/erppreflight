# BRIEFING — 2026-09-24T05:57:00Z

## Mission
Implement the full production TanStack Query, Table, Virtual, Form, and Pacer architecture in apps/web.

## 🔒 My Identity
- Archetype: teamwork_preview_worker
- Roles: implementer, qa, specialist
- Working directory: H:/erppreflight/.agents/worker_m3_1
- Original parent: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Milestone: Milestone 3 — Enterprise TanStack Suite Architecture

## 🔒 Key Constraints
- Strict Exclusive Write Ownership:
  1. apps/web/src/lib/query/* (query-client.ts, query-provider.tsx, query-keys.ts)
  2. apps/web/src/app/layout.tsx
  3. apps/web/src/components/data-table/* (data-table.tsx, data-table-toolbar.tsx, data-table-pagination.tsx, data-table-column-header.tsx, data-table-faceted-filter.tsx, data-table-view-options.tsx)
  4. apps/web/src/components/form/* (form-field.tsx, form-inputs.tsx)
  5. apps/web/src/hooks/useTableUrlSync.ts
  6. apps/web/src/hooks/useUnsavedChangesGuard.ts
  7. apps/web/src/hooks/pacer/* (useDebouncedValue.ts, useThrottledCallback.ts, useBatchQueue.ts)
  8. apps/web/src/lib/export.ts
- File Workspace Convention: metadata strictly in H:/erppreflight/.agents/worker_m3_1/
- No fake/dummy code, no hardcoding, no dependency soup (no react-hook-form, redux, etc.)
- 100% clean check:deps, typecheck, and build

## Current Parent
- Conversation ID: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Updated: 2026-09-24T05:57:00Z

## Task Summary
- **What to build**:
  1. apps/web/src/lib/query/query-client.ts, query-provider.tsx, query-keys.ts
  2. apps/web/src/app/layout.tsx (wrap in QueryProvider)
  3. apps/web/src/components/data-table/ suite (DataTable with compound tbody virtualization, toolbar, pagination, column options, faceted filters)
  4. apps/web/src/hooks/useTableUrlSync.ts and apps/web/src/lib/export.ts (CSV & JSON export)
  5. apps/web/src/components/form/ (form-field.tsx and form-inputs.tsx with WCAG 2.2 AA ARIA accessibility)
  6. apps/web/src/hooks/useUnsavedChangesGuard.ts
  7. apps/web/src/hooks/pacer/ (useDebouncedValue.ts, useThrottledCallback.ts, useBatchQueue.ts)
- **Success criteria**: pnpm run check:deps, pnpm run typecheck, and pnpm run build pass cleanly.

## Key Decisions Made
- Implemented SSR-isolated QueryClient factory with 4xx non-retry policy and cross-tab/auth tenant cache eviction.
- Implemented compound `<tbody>` measurement pattern in DataTable to ensure zero measurement cache clobbering when expanding detail rows.
- Implemented RFC 4180 UTF-8 BOM CSV & JSON export engine in `apps/web/src/lib/export.ts`.
- Implemented full WCAG 2.2 AA Form primitives with Standard Schema v1 error extraction.
- Implemented App Router + Browser dirty state navigation interceptor in `useUnsavedChangesGuard.ts`.
- Implemented Pacer hooks with explicit type generics for `useBatcher`.

## Change Tracker
- **Files modified/created**:
  - `apps/web/src/lib/query/query-client.ts`: SSR-safe QueryClient factory
  - `apps/web/src/lib/query/query-provider.tsx`: Root QueryProvider with tenant eviction
  - `apps/web/src/lib/query/query-keys.ts`: Hierarchical query key factory
  - `apps/web/src/app/layout.tsx`: Root layout wrapped with QueryProvider
  - `apps/web/src/components/data-table/`: Complete enterprise DataTable suite
  - `apps/web/src/lib/export.ts`: Full-dataset CSV/JSON export engine with BOM
  - `apps/web/src/hooks/useTableUrlSync.ts`: Next.js 15 App Router URL state synchronization
  - `apps/web/src/components/form/form-field.tsx`: Accessible FormField primitive
  - `apps/web/src/components/form/form-inputs.tsx`: Accessible form input components
  - `apps/web/src/hooks/useUnsavedChangesGuard.ts`: Client navigation guard
  - `apps/web/src/hooks/pacer/`: Pacer search debounce, throttled callback, and batch queue
- **Build status**: PASS (`turbo run build` exited with 0)
- **Pending issues**: None

## Quality Status
- **Build/test result**: PASS (build, typecheck, lint, test: 100% pass)
- **Dependency compliance**: PASS (`check:deps` confirmed zero prohibited duplicate libraries)
- **Lint status**: Clean (0 errors)

## Loaded Skills
- **Source**: /.agents/skills/frontend-design-system.md
- **Core methodology**: WCAG 2.2 AA accessibility, Base UI/shadcn patterns, non-color severity, responsive layout.
- **Source**: /.agents/skills/data-table-and-large-list.md
- **Core methodology**: Compound tbody virtualization, URL state sync, full-dataset export.

## Artifact Index
- H:/erppreflight/.agents/worker_m3_1/DISPATCH.md
- H:/erppreflight/.agents/worker_m3_1/BRIEFING.md
- H:/erppreflight/.agents/worker_m3_1/progress.md
- H:/erppreflight/.agents/worker_m3_1/handoff.md
