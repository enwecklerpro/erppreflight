# BRIEFING — 2026-09-24T08:08:00Z

## Mission
Adversarially challenge and stress-test the DataTable, Virtualization, and URL State primitives implemented in Milestone 3.

## 🔒 My Identity
- Archetype: empirical_challenger
- Roles: critic, specialist
- Working directory: H:/erppreflight/.agents/challenger_m3_1
- Original parent: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Milestone: Milestone 3
- Instance: 1 of 1

## 🔒 Key Constraints
- Review-only — do NOT modify implementation code
- Write only within H:/erppreflight/.agents/challenger_m3_1/
- No changes to apps/ or packages/ or services/
- Challenge empirically with executable tests/oracles
- Provide verdict: APPROVE or REQUEST_CHANGES

## Current Parent
- Conversation ID: 66440be0-c7ee-4a74-8a17-61e13b963df1
- Updated: 2026-09-24T08:08:00Z

## Review Scope
- **Files to review**:
  - `apps/web/src/components/data-table/data-table.tsx`
  - `apps/web/src/hooks/useTableUrlSync.ts`
  - `apps/web/src/lib/export.ts`
  - `apps/web/src/components/data-table/export.ts`
  - Related data-table components (`data-table-toolbar.tsx`, `data-table-pagination.tsx`, `data-table-bulk-actions.tsx`)
- **Interface contracts**: AGENTS.md, `/.agents/skills/data-table-and-large-list.md`, `/.agents/skills/frontend-design-system.md`
- **Review criteria**: Virtualization measurement cache integrity, URL state edge cases, RFC 4180 compliance, CSV formula injection defense, verification gates.

## Attack Surface
- **Hypotheses tested**:
  1. Virtualization compound `<tbody>` prevents row clobbering, but missing `getItemKey` causes index-bound cache desynchronization across sort/filter. [CONFIRMED]
  2. URL state parsing handles negatives and zero, but `NaN` propagation crashes TanStack Table rendering to 0 rows. [CONFIRMED]
  3. `useTableUrlSync` creates empty array filter entries for empty or malformed strings (`?status=,,,,`), filtering out all data. [CONFIRMED]
  4. Unbounded `pageSize` (e.g. 1 billion) is accepted without ceiling clamp. [CONFIRMED]
  5. `escapeCsvCell` implements RFC 4180 escaping and UTF-8 BOM, but lacks CSV Formula Injection defense (CWE-1236). [CONFIRMED]
  6. CSV export joins headers without escaping, corrupting CSV alignment if header names contain commas. [CONFIRMED]
- **Vulnerabilities found**:
  - Critical: CSV Formula Injection in `apps/web/src/lib/export.ts`.
  - Critical: `NaN` pagination state crashing table rendering in `apps/web/src/hooks/useTableUrlSync.ts`.
  - High: Missing `getItemKey` in `apps/web/src/components/data-table/data-table.tsx` causing virtualizer cache desynchronization.
  - High: Empty filter array injection in `useTableUrlSync.ts` wiping table rows.
  - High: Unescaped CSV headers in `apps/web/src/lib/export.ts`.
  - Medium: Unbounded `pageSize` parameter in `useTableUrlSync.ts`.
- **Untested angles**: Full Playwright browser rendering with simulated mouse wheel scrolling.

## Loaded Skills
- **Source**: `/.agents/skills/data-table-and-large-list.md`
  - **Local copy**: `H:/erppreflight/.agents/challenger_m3_1/skills/data-table-and-large-list.md`
  - **Core methodology**: Virtualization via @tanstack/react-virtual dynamic measurement, URL state sync via useTableUrlSync, RFC 4180 export with formula injection protection, full dataset server-side exports.
- **Source**: `/.agents/skills/frontend-design-system.md`
  - **Local copy**: `H:/erppreflight/.agents/challenger_m3_1/skills/frontend-design-system.md`
  - **Core methodology**: Base UI / shadcn design tokens, accessibility WCAG 2.2 AA, motion discipline, non-color severity representation.

## Key Decisions Made
- Executed empirical test suites in `.agents/challenger_m3_1/`.
- Verified all quality gates (`check-no-dependency-soup.mjs`, web `typecheck`, monorepo `test`).
- Determined verdict: REQUEST_CHANGES based on 6 reproducible defects.

## Artifact Index
- `DISPATCH.md` — Initial dispatch
- `BRIEFING.md` — Situational awareness
- `progress.md` — Liveness & heartbeat
- `test_export_empirical.mjs` — Test harness for RFC 4180 & CSV formula injection
- `test_export_headers.mjs` — Test harness for header escaping
- `test_url_sync_empirical.mjs` — Test harness for URL query state parsing
- `test_virtualizer_empirical.mjs` — Test harness for virtualizer compound measurement
- `test_pagination_nan.mjs` — Test harness for TanStack Table pagination under NaN
- `test_filter_empty_array.mjs` — Test harness for empty filter array behavior
- `handoff.md` — Final challenge report
