# Dispatch: worker_m5_1
Assigned: Milestone 5 Frontend Test Suite, Monorepo Verification & Test Infrastructure
Target: H:/erppreflight/.agents/worker_m5_1

## 2026-09-24T10:32:59Z
You are worker_m5_1, a teamwork_preview_worker.
Your working directory is H:/erppreflight/.agents/worker_m5_1.
You MUST follow the File Workspace Convention: write metadata ONLY within your working directory. For target files, see Exclusive Write Ownership below.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
You own exclusively:
1. apps/web/package.json
2. apps/web/vitest.config.ts
3. apps/web/src/test/*
4. apps/web/src/__tests__/* (query-client.test.ts, data-table.test.tsx, form.test.tsx, badges.test.tsx, export.test.ts)

TASKS:
1. Configure Vitest in apps/web:
   - In apps/web/package.json, add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.
   - In devDependencies, ensure `"vitest": "^2.1.8"`, `"@vitejs/plugin-react": "^4.3.4"`, `"jsdom": "^25.0.1"`, `"@testing-library/react": "^16.2.0"`, `"@testing-library/jest-dom": "^6.6.3"` are available and install via `pnpm --filter @erppreflight/web install` if needed (do NOT install duplicate or competing frameworks).
   - Create apps/web/vitest.config.ts configuring `environment: 'jsdom'`, globals: true, alias resolution for `@/*` -> `./src/*`, and setupFiles: ['./src/test/setup.ts'].
   - Create apps/web/src/test/setup.ts importing `@testing-library/jest-dom/vitest`.
2. Author Comprehensive Automated Test Suites in apps/web/src/__tests__/:
   a. `query-client.test.ts`:
      - Test getQueryClient SSR isolation: verify that in server environment (`typeof window === 'undefined'`), getQueryClient() produces a fresh QueryClient instance on every invocation (simulate 100 concurrent async requests and verify zero cross-request cache contamination).
      - Test browser singleton: verify that in browser environment (`typeof window !== 'undefined'`), getQueryClient() returns the identical singleton instance.
      - Test evictTenantQueryCache(): verify cancelQueries() is called before clear() to prevent promise race conditions on tenant switch.
   b. `data-table.test.tsx`:
      - Test DataTable with TanStack Table: multi-column sorting, facet filter popovers, row selection, search input sync (`searchColumnId` bridge to `globalFilter`).
      - Test compound row virtualization: test that @tanstack/react-virtual correctly mounts and measures virtual rows and maintains a constant DOM footprint (~30 rows) even across 10,000 items.
   c. `form.test.tsx`:
      - Test @tanstack/react-form + Zod schema validation: test field validation errors, Standard Schema v1 error extraction in FormField, accessible error messages with warning icons, and submission workflows.
      - Test useUnsavedChangesGuard: test dirty state warning on navigation.
   d. `badges.test.tsx`:
      - Test SeverityBadge, ConfidenceBadge, CleanCoreBadge, ObjectTypeBadge, ObjectTierBadge: verify non-color presentation triad (high-contrast colors + Lucide icons + explicit text badges + ARIA labels/roles).
   e. `export.test.ts`:
      - Test exportToCsv, escapeCsvCell, triggerExport: verify RFC 4180 escaping, UTF-8 BOM (\uFEFF), CWE-1236 CSV formula injection neutralization (prefixing `'` on `=+\-@\t\r`), and resilient fallback when server returns 404 or fails.
3. Monorepo Quality Gates:
   - Run `node scripts/check-no-dependency-soup.mjs` (must pass 100%).
   - Run `npx pnpm --filter @erppreflight/web test` (must pass 100%).
   - Run `npx pnpm test` (monorepo turbo run test: all suites must pass).
   - Run `npx pnpm --filter @erppreflight/web typecheck` (0 errors).
   - Run `npx pnpm run build` (monorepo build passes with 0 errors).
   - Run `py -m pytest services/analysis-python/tests -q` (100% pass).

OUTPUT:
Write your report to H:/erppreflight/.agents/worker_m5_1/handoff.md.
Send message to parent when done.

