# Baseline Exploration Handoff Report

**Agent**: `explorer_baseline_1`  
**Date**: 2026-09-24  
**Working Directory**: `H:/erppreflight/.agents/explorer_baseline_1`  
**Target Repository**: `H:/erppreflight`  

---

## 1. Observation

### 1.1 `apps/web` Structure & Current Implementation

1. **Next.js App Router Structure**:
   - `apps/web/src/app/layout.tsx` (lines 11–26):
     ```tsx
     export default function RootLayout({ children }: { children: React.ReactNode }) {
       return (
         <html lang="en">
           <body className="antialiased min-h-screen flex flex-col bg-background text-foreground">
             <Navbar />
             <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
               {children}
             </main>
           </body>
         </html>
       );
     }
     ```
     *Direct Observation*: The layout provides zero context providers. No `QueryClientProvider`, no theme provider, no error boundary, and no SSR hydration wrappers exist.

   - **Existing Routes**:
     - `apps/web/src/app/page.tsx`: Executive Dashboard displaying KPI cards (`MetricsCard`) and an engine status grid (`EngineMatrix`).
     - `apps/web/src/app/projects/page.tsx`: Project Workspaces page. Uses raw `useState<Project[]>` and `useEffect` with manual `fetchProjects()`. Lines 33–38:
       ```tsx
       <button
         onClick={() => alert('New Project creation form modal available')}
         className="..."
       >
         <Plus className="h-4 w-4" />
         New Project
       </button>
       ```
       No modal dialog or form component is implemented.
     - `apps/web/src/app/projects/[id]/page.tsx`: Project Workspace detail with tab state (`overview`, `artifacts`, `history`, `launcher`). Staged artifacts and execution histories are hardcoded mock arrays. The launcher uses `setTimeout` with a mock state update.
     - `apps/web/src/app/inspector/page.tsx`: Universal Object & Analysis Inspector. Serves as a makeshift findings view. Lines 18–36:
       ```tsx
       const [findings, setFindings] = useState<Finding[]>([]);
       const [searchTerm, setSearchTerm] = useState('');
       const [selectedSeverity, setSelectedSeverity] = useState<string>('ALL');
       const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

       useEffect(() => {
         fetchFindings().then(setFindings);
       }, []);
       ```
       Renders an unvirtualized `<div>` list with a local JavaScript `.filter()` call.
   - **Missing Routes & Pages**:
     - No dedicated `/findings` page with URL-backed filters, faceted filtering, multi-column sorting, column toggles, row selection, or CSV/JSON export.
     - No SAP Object Inventory page (`/inventory` or `/objects`) exists anywhere in `apps/web/src/app`.

2. **Data Fetching, Table, and Form Implementations in `apps/web`**:
   - `apps/web/src/lib/api-client.ts`: Contains hardcoded `ALL_18_ENGINES` (lines 20–40), `MOCK_PROJECTS` (lines 42–65), `MOCK_FINDINGS` (lines 67–153), and fallback `fetchProjects()` and `fetchFindings()`.
   - Zero TanStack libraries are imported or installed. No `@tanstack/react-query`, no `@tanstack/react-table`, no `@tanstack/react-virtual`, no `@tanstack/react-form`, and no `@tanstack/pacer`.
   - All forms/buttons use `alert()` or inline `useState`. Search inputs use unthrottled `onChange={(e) => setSearchTerm(e.target.value)}`.

### 1.2 `packages/ui` and Component Libraries / Primitives

1. **Existence of `packages/ui`**:
   - Directory listing of `H:/erppreflight/packages`:
     - `auth/`
     - `database/`
     - `evidence/`
     - `schemas/`
     - `tenancy/`
   - *Direct Observation*: `packages/ui` does **NOT** exist. There is no shared UI package in the monorepo.

2. **Components in `apps/web/src/components/`**:
   - Only 4 ad-hoc components exist:
     - `engine-matrix.tsx`: Operational status cards for 18 engines with local domain filtering.
     - `evidence-inspector.tsx`: Modal dialog displaying raw snippet, SHA-256 hash, and provenance score for a selected finding.
     - `metrics-card.tsx`: Stat display card with icon, title, value, and change indicator.
     - `navbar.tsx`: Fixed top header navigation bar.

3. **Installed Primitives in `apps/web/package.json`**:
   - Lines 16–21:
     - `@radix-ui/react-dialog: ^1.1.6`
     - `@radix-ui/react-dropdown-menu: ^2.1.6`
     - `@radix-ui/react-select: ^2.1.6`
     - `@radix-ui/react-slot: ^1.1.2`
     - `@radix-ui/react-tabs: ^1.1.3`
     - `@radix-ui/react-tooltip: ^1.1.8`
   - *Direct Observation*: Radix UI primitives are used directly in `apps/web`. Base UI (`@base-ui-components/react`) is completely absent.
   - `shadcn/ui` is not initialized (no `components.json`, no `src/components/ui` primitive directory).
   - `motion` (`motion/react`) is not installed.
   - `@xyflow/react` and `elkjs` are not installed.
   - `orval` is not installed.
   - Zod version is `^3.24.2` (in `apps/web/package.json`, `packages/schemas/package.json`, and `packages/evidence/package.json`), not Zod 4.

### 1.3 Monorepo Testing & Linting Setup

1. **Configured Test Runners**:
   - **`apps/api`**:
     - Runner: Vitest 2.1.8 (`apps/api/package.json`: `"test": "vitest run"`, config: `apps/api/vitest.config.ts`).
     - Test files: 12 `.spec.ts` files across `apps/api/src/modules/**/*.spec.ts` and `apps/api/test/*.spec.ts`.
     - Result of running `pnpm test` (running Vitest): **12 passed test files, 124 passed tests** in 1.21s.
   - **`services/analysis-python`**:
     - Runner: pytest (`pytest.ini`).
     - Test files: 13 test modules in `services/analysis-python/tests/` (unit, integration, adversarial).
     - Result of running `pnpm run test:python`: **101 passed tests** in 0.15s.
   - **Root `tests/`**: Contains Python E2E integration suites (`test_tier1_features.py`, `test_tier2_boundaries.py`, `test_tier3_combinations.py`, `test_tier4_scenarios.py`, and empirical challenges).
   - **`apps/web`**: **NO test runner configured**. `package.json` contains no `"test"` script, no Vitest/Jest/Playwright dependency, and 0 test files.
   - **`packages/*`** (`auth`, `database`, `evidence`, `schemas`, `tenancy`): **NO test runners configured**. None have a `"test"` script or test files.

2. **Linting Setup**:
   - `package.json` root script: `"lint": "turbo run lint"`.
   - In `turbo.json`: `"lint": { "dependsOn": [] }`.
   - Only `apps/web` has a `"lint"` script in its `package.json`: `"lint": "tsc --noEmit"`. It executes TypeScript checking rather than an actual linter.
   - `apps/web/package.json` lists `eslint: ^8.57.1` and `eslint-config-next: ^16.3.6`, but:
     - No `.eslintrc*` or `eslint.config.*` file exists in `apps/web` or repo root.
     - ESLint is never invoked by any script.
   - `apps/api` has no `"lint"` script.
   - `packages/*` have no `"lint"` script.
   - No Biome (`biome.json`) or Prettier configurations exist in the monorepo.

3. **Build & Typecheck Baseline**:
   - `pnpm run typecheck` (`turbo run typecheck`): **12 successful tasks across 7 packages** (@erppreflight/api, @erppreflight/auth, @erppreflight/database, @erppreflight/evidence, @erppreflight/schemas, @erppreflight/tenancy, @erppreflight/web) with 0 errors.
   - `pnpm run build` (`turbo run build`): **7 successful tasks across 7 packages** with 0 errors.
   - *Environment Finding*: On Windows, `pnpm` binary resides in `C:\Users\SKAF\AppData\Roaming\npm\pnpm.cmd`, which is outside default PATH in subshells. Setting `$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"` ensures standard CLI invocation.

### 1.4 Part 21/22 Playbooks & Governance

- Root `AGENTS.md`: Does **NOT** exist (`find_by_name` returned 0 results).
- `/.agents/skills/`: Does **NOT** exist (`find_by_name` returned 0 results). None of the 8 canonical playbooks specified in Part 22 exist:
  1. `frontend-design-system.md`
  2. `data-table-and-large-list.md`
  3. `dependency-graph.md`
  4. `engine-authoring.md`
  5. `sap-evidence.md`
  6. `release-aware-knowledge.md`
  7. `secure-file-parser.md`
  8. `multi-tenant-security.md`

---

## 2. Logic Chain

1. **Premise**: Part 21 and the TanStack prompt mandate TanStack Query as the canonical client server-state cache, requiring an SSR-safe QueryClient factory in `apps/web` and typed query hooks.
   - *Observation*: `apps/web/src/app/layout.tsx` has no `QueryClientProvider`, and all pages fetch server data via raw `useEffect` and `useState` calling hand-coded mocks in `apps/web/src/lib/api-client.ts`.
   - *Inference*: The frontend operates entirely on imperative, un-cached local state without SSR safety, cache invalidation, or background polling.

2. **Premise**: Part 21, Part 22, and the TanStack prompt require enterprise data grids powered by TanStack Table and `@tanstack/react-virtual` for large datasets (Findings and SAP Object Inventory), featuring URL-backed filter state, multi-column sorting, column toggles, row selection, and CSV/JSON exports.
   - *Observation*: The only findings view is `apps/web/src/app/inspector/page.tsx`, which renders plain `<div>` elements after in-memory array filtering. There is no SAP Object Inventory page, no table component, and neither `@tanstack/react-table` nor `@tanstack/react-virtual` is installed.
   - *Inference*: Reusable `DataTable` primitives, virtualization layers, and reference pages for Findings and SAP Object Inventory must be built from scratch.

3. **Premise**: Part 21 and the TanStack prompt mandate TanStack Form as the canonical form engine, combined with Zod validation schemas.
   - *Observation*: Buttons like "New Project" and "Browse Local Files" invoke `alert()`. `@tanstack/react-form` is not installed anywhere.
   - *Inference*: Form components, Zod integration wrappers, and mutation hooks are completely unbuilt.

4. **Premise**: Part 21.1 mandates a curated UI foundation based on shadcn/ui and Base UI as the preferred headless primitive layer, prohibiting unmanaged primitive mixing.
   - *Observation*: `apps/web` currently installs `@radix-ui/react-*` directly; Base UI (`@base-ui-components/react`) is absent; no `packages/ui` exists; only 4 custom UI components exist.
   - *Inference*: A coherent component layer adhering to Part 21 must be established either in `packages/ui` or structured cleanly in `apps/web/src/components/ui`.

5. **Premise**: Acceptance criteria require automated tests verifying QueryClient SSR-safety, TanStack Table interactions/virtualization, and TanStack Form validation, alongside clean builds and linting.
   - *Observation*: Currently, `apps/web` has zero test configuration (no Vitest, Jest, or Playwright), no test files, and its lint script is just `tsc --noEmit`. Only `apps/api` (Vitest) and `services/analysis-python` (pytest) have test suites.
   - *Inference*: A frontend test runner (Vitest + Testing Library) must be configured in `apps/web` to test QueryClient hydration, Table virtualization, and Form validation.

---

## 3. Caveats

1. **Scope of Investigation**: This investigation was strictly read-only and focused on the baseline frontend architecture, component libraries, testing infrastructure, and Part 21/22 documentation. Backend engines (`services/analysis-python/src/engines/`) and NestJS backend APIs (`apps/api/src/modules/`) were verified to compile and pass tests, but their internal domain logic was not audited in depth as it is outside the TanStack/UI scope.
2. **Package Manager Path**: In the Windows environment, `pnpm` is not in the system PATH by default but is available at `C:\Users\SKAF\AppData\Roaming\npm\pnpm.cmd` or through `corepack`. Build and test scripts executed cleanly once this path was prepended.
3. **Zod Version**: The monorepo currently standardizes on `zod@^3.24.2` across `apps/web`, `apps/api`, `packages/schemas`, and `packages/evidence`. Part 21 references Zod 4; upgrading to Zod 4 may require coordinating type compatibility across all workspace packages.

---

## 4. Conclusion

The ERP Preflight platform has a strong backend and Python engine test baseline (124 Vitest tests passing in `apps/api`, 101 pytest tests passing in `services/analysis-python`, and 0 TypeScript compilation errors monorepo-wide). 

However, **there is a total gap** between the current frontend/governance state and the Part 21/22 & TanStack requirements:
1. **Agent Skills & Governance (Part 22)**: Root `AGENTS.md` and all 8 playbooks in `/.agents/skills/` are completely absent.
2. **TanStack Suite (Part 21 & TanStack Prompt)**: Zero TanStack libraries are installed. No QueryClient factory, no `DataTable` primitives, no TanStack Virtual integration, no TanStack Form, and no TanStack Pacer utilities exist.
3. **Reference Pages**: Neither a dedicated TanStack-powered Findings data grid nor an SAP Object Inventory page exists.
4. **UI Primitives**: No `packages/ui` exists; `apps/web` relies directly on Radix UI instead of Base UI/shadcn; no Motion or React Flow is present.
5. **Frontend Testing & Linting**: `apps/web` has zero tests, zero test runners, and no ESLint configuration.

### Actionable Implementation Plan for Successor Agents:

| Priority | Task Area | Action Items |
| :--- | :--- | :--- |
| **P1** | **Part 22 Playbooks & AGENTS.md** | Author root `AGENTS.md` and all 8 canonical playbooks in `/.agents/skills/` adhering to Part 22 specs. |
| **P2** | **TanStack Dependencies & Setup** | Install `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `@tanstack/react-form`, and utilities in `apps/web`. Implement SSR-safe QueryClient factory in `apps/web/src/lib/query-client.ts` with typed query keys. |
| **P3** | **Reusable UI & DataTable Primitives** | Implement Base UI / shadcn style UI primitives (`button`, `input`, `badge`, `dialog`, `table`) and reusable `DataTable` components (`toolbar`, `filters`, `pagination`, `column-visibility`, `bulk-actions`, `export`). |
| **P4** | **Reference Pages** | 1. Implement `/findings` page with TanStack Query, TanStack Table, URL-synced search/filters, row selection, and CSV/JSON export.<br>2. Implement `/inventory` (SAP Object Inventory) with TanStack Virtual handling large object catalogs and search. |
| **P5** | **TanStack Form Implementations** | Implement type-safe form abstractions with Zod validation for New Project creation and Preflight Run configuration. |
| **P6** | **Frontend Test Runner & Test Suite** | Configure Vitest + React Testing Library in `apps/web`. Add unit/component tests for QueryClient SSR safety, Table sorting/filtering/virtualization, and Form validation. |

---

## 5. Verification Method

To independently verify the baseline findings:

1. **Verify Root Playbooks & AGENTS.md Absence**:
   ```powershell
   Test-Path H:/erppreflight/AGENTS.md
   Test-Path H:/erppreflight/.agents/skills
   ```
   *Expected result*: Both return `False`.

2. **Verify Typecheck Baseline**:
   ```powershell
   $env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"
   pnpm run typecheck
   ```
   *Expected result*: 12 tasks pass with 0 errors across 7 packages.

3. **Verify API Vitest Test Suite**:
   ```powershell
   $env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"
   pnpm --filter @erppreflight/api test
   ```
   *Expected result*: 12 test files pass, 124 tests pass.

4. **Verify Python Analysis Test Suite**:
   ```powershell
   $env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"
   pnpm run test:python
   ```
   *Expected result*: 101 tests pass in `services/analysis-python`.

5. **Verify Apps/Web Test & TanStack Package Absence**:
   ```powershell
   Get-Content H:/erppreflight/apps/web/package.json | ConvertFrom-Json | Select-Object -ExpandProperty scripts
   Get-Content H:/erppreflight/apps/web/package.json | ConvertFrom-Json | Select-Object -ExpandProperty dependencies
   ```
   *Expected result*: Scripts show no `"test"`, and dependencies contain no `@tanstack/*` packages.
