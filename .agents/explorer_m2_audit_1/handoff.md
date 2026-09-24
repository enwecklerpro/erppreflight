# Milestone 2: Monorepo Zero-Duplication Audit, Script Alignment & Build/Typecheck Baseline Report

**Agent**: `explorer_m2_audit_1`  
**Milestone**: Milestone 2 — Curated Library Standardization & Alignment  
**Working Directory**: `H:/erppreflight/.agents/explorer_m2_audit_1`  
**Target Repository**: `H:/erppreflight`  

---

## 1. Observation

### 1.1 Scope & Package Inventory
Exact file paths inspected across the repository:
1. `H:/erppreflight/package.json` (Root monorepo)
2. `H:/erppreflight/apps/web/package.json` (`@erppreflight/web`, Next.js 15 App Router)
3. `H:/erppreflight/apps/api/package.json` (`@erppreflight/api`, NestJS 11 backend)
4. `H:/erppreflight/packages/auth/package.json` (`@erppreflight/auth`)
5. `H:/erppreflight/packages/database/package.json` (`@erppreflight/database`)
6. `H:/erppreflight/packages/evidence/package.json` (`@erppreflight/evidence`)
7. `H:/erppreflight/packages/schemas/package.json` (`@erppreflight/schemas`)
8. `H:/erppreflight/packages/tenancy/package.json` (`@erppreflight/tenancy`)
9. `H:/erppreflight/turbo.json` (Turborepo task pipeline definition)
10. `H:/erppreflight/pnpm-workspace.yaml` (Workspace package glob declarations)
11. `H:/erppreflight/pnpm-lock.yaml` (Lockfile)

### 1.2 Zero-Duplication & Prohibited Packages Audit
Direct grep and package analysis across all 8 `package.json` files and 112 source files:

| Concern | Approved Standard (AGENTS.md §4.2, Part 21) | Prohibited Competing Packages | Audit Observation Across All `package.json` Files | Status |
|---|---|---|---|---|
| **Form Management** | TanStack Form (`@tanstack/react-form` + Zod) | `react-hook-form`, `formik`, `redux-form`, `final-form` | **0 found**. Neither `react-hook-form` nor `formik` appears in any `package.json` or source file. | **CLEAN** |
| **Client State Management** | URL Parameters + React State / scoped Zustand | `redux`, `@reduxjs/toolkit`, `mobx`, `mobx-react`, `recoil`, `jotai` | **0 found**. No Redux, MobX, or Recoil references in dependencies or source code. | **CLEAN** |
| **Server State & Caching** | TanStack Query (`@tanstack/react-query`) | `swr`, `@apollo/client`, `apollo-boost`, `urql`, `rtk-query` | **0 found**. Zero competing server-cache libraries. | **CLEAN** |
| **Database ORM** | Drizzle ORM (`drizzle-orm` + `pg`) | `prisma`, `@prisma/client`, `typeorm`, `sequelize`, `bookshelf` | **0 found** in `package.json`. `packages/database` declares `"drizzle-orm": "^0.45.3"`. (See lockfile finding below). | **CLEAN** |
| **Interactive Graph Canvas** | `@xyflow/react` (React Flow) + `elkjs` | `cytoscape`, `vis.js`, `vis-network`, `mxgraph`, `sigma` | **0 found**. Zero legacy/competing graph frameworks. | **CLEAN** |
| **Data Grid / Large Tables** | TanStack Table + TanStack Virtual | `ag-grid`, `ag-grid-react`, `react-data-grid`, `tabulator-tables` | **0 found**. Zero competing data grid packages. | **CLEAN** |
| **Analytics & Charts** | Apache ECharts (`echarts`) | `chart.js`, `react-chartjs-2`, `recharts`, `victory`, `apexcharts` | **0 found**. Zero unapproved chart libraries. | **CLEAN** |
| **Job Queue & Tasks** | BullMQ (`bullmq`, `@nestjs/bullmq`) | `kue`, `bee-queue`, `celery-node` | **0 found**. Only BullMQ is declared in `apps/api`. | **CLEAN** |
| **Runtime Validation** | Zod (`zod: ^3.24.2`) | `joi`, `yup`, `superstruct` | **0 found**. Only Zod is present across boundaries. | **CLEAN** |
| **Headless UI Primitives** | Base UI (`@base-ui-components/react`) | `@ark-ui/react`, `@chakra-ui/react` | **0 found**. `apps/web/package.json` currently has `@radix-ui/react-*` for initial templates, but 0 imports in `apps/web/src/components`. | **FLAGGED FOR M2** |

#### Lockfile Investigation for `prisma`:
- Lines 2833 & 2850 of `pnpm-lock.yaml` contain `@prisma/client: '*'` and `prisma: '*'`.
- Investigation verified these lines reside exclusively inside the `peerDependencies` block of `drizzle-orm@0.45.3` (lines 2820–2853) with `peerDependenciesMeta.prisma.optional = true`.
- Neither `@prisma/client` nor `prisma` is installed into any `node_modules` or declared in any workspace `package.json`.

### 1.3 Package Script Alignment Matrix
Analysis of package scripts across all workspace projects:

```
+---------------------+-------------------+---------------------+---------------------------+---------------------+-------------------------+--------------------+
| Package             | build             | typecheck           | lint                      | test                | dev / start             | clean              |
+---------------------+-------------------+---------------------+---------------------------+---------------------+-------------------------+--------------------+
| Root (package.json) | turbo run build   | turbo run typecheck | turbo run lint            | turbo run test      | turbo run dev           | turbo run clean    |
| apps/web            | next build        | tsc --noEmit        | tsc --noEmit (ANOMALY)    | [MISSING]           | dev: next dev --port 3000| rimraf .next dist |
| apps/api            | nest build        | tsc --noEmit        | [MISSING]                 | vitest run          | [MISSING 'dev']         | rimraf dist        |
| packages/auth       | tsc               | tsc --noEmit        | [MISSING]                 | [MISSING]           | N/A (library)           | rimraf dist        |
| packages/database   | tsc               | tsc --noEmit        | [MISSING]                 | [MISSING]           | N/A (library)           | rimraf dist        |
| packages/evidence   | tsc               | tsc --noEmit        | [MISSING]                 | [MISSING]           | N/A (library)           | rimraf dist        |
| packages/schemas    | tsc               | tsc --noEmit        | [MISSING]                 | [MISSING]           | N/A (library)           | rimraf dist        |
| packages/tenancy    | tsc               | tsc --noEmit        | [MISSING]                 | [MISSING]           | N/A (library)           | rimraf dist        |
+---------------------+-------------------+---------------------+---------------------------+---------------------+-------------------------+--------------------+
```

Key Anomalies Observed:
1. `apps/api` lacks a `"dev"` script. It defines `"start:dev": "nest start --watch"`. When running root `pnpm run dev` (`turbo run dev`), Turborepo starts `apps/web` but completely ignores `apps/api`.
2. `apps/api` lacks a `"lint"` script. When running root `pnpm run lint` (`turbo run lint`), `apps/api` is skipped.
3. `apps/web` defines `"lint": "tsc --noEmit"`. This is an alias for `typecheck` and completely bypasses ESLint (`next lint`).
4. `apps/web` has no `"test"` script. When running root `pnpm run test`, only `apps/api:test` runs. (Component testing is scheduled for Milestone 5).

### 1.4 Baseline Verification Results
Executed in Windows PowerShell environment:

1. **Environment Tooling**:
   - Node: `v22.13.0` (`C:\Program Files\nodejs\node.exe`)
   - pnpm: `10.20.0` located at `C:\Users\SKAF\AppData\Roaming\npm\pnpm.CMD` (`$env:APPDATA\npm\pnpm.cmd`).
   - *Operational Finding*: In non-interactive child shells, `$env:APPDATA\npm` may not be present in `$env:PATH`. Prepending `$env:PATH = "$env:APPDATA\npm;$env:PATH"` ensures standard `pnpm` command invocation.

2. **`pnpm run typecheck` (Forced without cache)**:
   - Command: `turbo run typecheck --force`
   - Scope: 7 packages (`@erppreflight/api`, `@erppreflight/auth`, `@erppreflight/database`, `@erppreflight/evidence`, `@erppreflight/schemas`, `@erppreflight/tenancy`, `@erppreflight/web`)
   - Duration: `8.113s`
   - Result: **12 successful tasks, 0 type errors** (100% pass).

3. **`pnpm run build`**:
   - Command: `turbo run build`
   - Scope: 7 packages
   - Result: **7 successful tasks, 0 build errors**.
   - `apps/web`: Next.js 15.5.26 production build succeeds in 1074ms, generating 6 static routes (`/`, `/_not-found`, `/inspector`, `/projects`, `/projects/[id]`), shared First Load JS: 102 kB.
   - `apps/api`: `nest build` compiles cleanly to `dist/`.
   - All 5 shared packages compile cleanly via `tsc`.

4. **`pnpm run test`**:
   - Command: `turbo run test`
   - Scope: `apps/api` (Vitest v2.1.9)
   - Result: **12 test files passed, 132 tests passed** (100% pass rate in 1.06s).

5. **`pnpm run test:python`**:
   - Command: `py -m pytest services/analysis-python/tests -v`
   - Result: **107 passed in 0.18s** (100% pass rate).

### 1.5 Automated No-Dependency-Soup Enforcement Tool Design & Test
Created prototype script `H:/erppreflight/.agents/explorer_m2_audit_1/check-no-dependency-soup.mjs`:
- Tested via: `node .agents/explorer_m2_audit_1/check-no-dependency-soup.mjs`
- Execution output:
  ```
  === ERP Preflight: No-Dependency-Soup Compliance Audit ===
  Scanning 8 package.json files across monorepo...
  Scanning 112 TypeScript/JavaScript source files...

  --- Category Compliance Matrix ---
   ✔ Form Management                          [Approved: TanStack Form (@tanstack/react-form + Zod)]
   ✔ Client State Management                  [Approved: URL Parameters + React State / scoped Zustand]
   ✔ Server State & Caching                   [Approved: TanStack Query (@tanstack/react-query)]
   ✔ Database ORM                             [Approved: Drizzle ORM (drizzle-orm + pg)]
   ✔ Interactive Graph Canvas                 [Approved: @xyflow/react (React Flow) + ELK.js]
   ✔ Data Grid / Large Tables                 [Approved: TanStack Table (@tanstack/react-table) + TanStack Virtual (@tanstack/react-virtual)]
   ✔ Analytics & Charts                       [Approved: Apache ECharts (echarts)]
   ✔ Job Queue & Background Tasks             [Approved: BullMQ (bullmq / @nestjs/bullmq)]
   ✔ Runtime Schema Validation                [Approved: Zod 4 (zod)]
   ✔ Headless UI Primitives (New Components)  [Approved: Base UI (@base-ui-components/react) + shadcn/ui]

  ✔ SUCCESS: 100% compliant with No-Dependency-Soup standard!
  Zero prohibited duplicate libraries detected across all 8 package.json files and 112 source files.
  ```

---

## 2. Logic Chain

1. **Premise 1 (Axiom 2 & AGENTS.md §4.2)**: ERP Preflight mandates a strict single curated library per concern to prevent architectural drift, bundle bloat, and dependency soup. Specifically: no React Hook Form/Formik, no Redux/MobX/Recoil, no Prisma/TypeORM, no Cytoscape/Vis.js, no AG Grid/React Data Grid.
2. **Step 2 (Exhaustive Workspace Traversal)**: By inspecting all 8 `package.json` files and 112 source files across `apps/` and `packages/`, we evaluated `dependencies`, `devDependencies`, `peerDependencies`, and import statements against the prohibited matrix.
3. **Inference 1**: The codebase currently contains **0 prohibited duplicate packages**. The foundation is completely clean of competing frameworks.
4. **Step 3 (Script Pipeline Alignment)**: Turborepo uses `turbo.json` task declarations. A monorepo pipeline is only as reliable as the underlying package scripts:
   - When running `turbo run dev`, if `apps/api` has `"start:dev"` rather than `"dev"`, `apps/api` will not start alongside `apps/web`.
   - When running `turbo run lint`, if `apps/api` and `packages/*` omit `"lint"`, code quality checks are bypassed for those packages.
   - When running `apps/web:lint`, having it execute `"tsc --noEmit"` duplicates `typecheck` and omits Next.js / React hooks linting.
5. **Inference 2**: Minor package script alignment adjustments in `apps/api/package.json` and `apps/web/package.json` are required to ensure the Turborepo developer workflow (`pnpm run dev`, `pnpm run lint`) functions seamlessly.
6. **Step 4 (Automated Compliance Tooling)**: Relying solely on manual inspection allows regressions. Designing a dedicated Node.js script (`check-no-dependency-soup.mjs`) provides an automated, deterministic quality gate (AGENTS.md Gate 2) that can execute in CI and pre-commit hooks in <100ms.
7. **Step 5 (Baseline Confirmation)**: Executing `turbo run typecheck --force` and `turbo run build` proved that the existing TypeScript code across all 7 workspace packages compiles with zero errors, validating the baseline before Milestone 2 dependencies (`@tanstack/*`, `@xyflow/react`, `motion`) are introduced.

---

## 3. Caveats

1. **Radix UI Primitives in `apps/web`**: `apps/web/package.json` contains several `@radix-ui/react-*` packages installed during initial project initialization. While `AGENTS.md §4.2` and `Part 21.1` mandate **Base UI** for new components, Part 21.1 explicitly states: *"Existing/third-party components using Radix may be accepted where migration provides no value, but the design system must expose one consistent ERP Preflight component API."* As new Base UI primitives are introduced in Milestone 3, unused Radix packages should be pruned.
2. **Windows Shell Execution Environment**: Because `pnpm` is installed under `%APPDATA%\npm`, any subagent or automated task that opens a bare PowerShell session without inheriting the user's interactive profile must prepend `$env:APPDATA\npm` to `$env:PATH` or invoke `$env:APPDATA\npm\pnpm.CMD`.
3. **Web Testing Scheduled for M5**: `apps/web` currently does not run unit/component tests in `pnpm run test`. Per `PROJECT.md` Feature 20, Vitest + React Testing Library integration is planned for Milestone 5.

---

## 4. Conclusion

1. **Zero-Duplication Audit**: **PASSED**. Monorepo is 100% compliant with No-Dependency-Soup standards. Zero prohibited form, state, ORM, graph, grid, or chart libraries exist.
2. **Build & Typecheck Baselines**: **VERIFIED CLEAN**. 
   - `pnpm run typecheck` (forced without cache): 12 tasks passed, 0 errors.
   - `pnpm run build`: 7 packages passed, 0 errors.
   - `pnpm run test`: 132 tests passed (100% pass rate).
   - `pnpm run test:python`: 107 tests passed (100% pass rate).
3. **Automated Enforcement Tool**: Fully implemented and tested at `H:/erppreflight/.agents/explorer_m2_audit_1/check-no-dependency-soup.mjs`. Ready for migration into `H:/erppreflight/scripts/check-no-dependency-soup.mjs` and root `package.json` as `"check:deps": "node scripts/check-no-dependency-soup.mjs"`.
4. **Actionable Recommendations for M2 Worker**:
   - Add `"dev": "nest start --watch"` to `apps/api/package.json` so `turbo run dev` boots both web and API.
   - Update `apps/web/package.json` `"lint"` to `"next lint"` (or configure monorepo ESLint).
   - Add `"lint"` to `apps/api/package.json`.
   - Place `check-no-dependency-soup.mjs` into `scripts/` and wire into root `package.json` under `"check:deps"`.

---

## 5. Verification Method

To independently reproduce and verify this assessment:

1. **Verify No Prohibited Duplicate Libraries via Automated Checker**:
   ```powershell
   node H:/erppreflight/.agents/explorer_m2_audit_1/check-no-dependency-soup.mjs
   ```
   *Expected Result*: Exits with code 0 and prints `✔ SUCCESS: 100% compliant with No-Dependency-Soup standard!`.

2. **Verify Monorepo Typecheck Baseline**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm exec turbo run typecheck --force
   ```
   *Expected Result*: 12 tasks successful, 0 errors.

3. **Verify Monorepo Build Baseline**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm run build
   ```
   *Expected Result*: 7 packages build cleanly with 0 errors.

4. **Verify Backend and Python Test Suites**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm run test
   pnpm run test:python
   ```
   *Expected Result*: 132 NestJS tests pass; 107 Python pytest tests pass.

5. **Invalidation Conditions**:
   - Any commit adding `react-hook-form`, `formik`, `redux`, `mobx`, `recoil`, `prisma`, `typeorm`, `cytoscape`, `vis.js`, `ag-grid`, or `react-data-grid` to any `package.json` will cause `check-no-dependency-soup.mjs` to exit with code 1.
   - Any TypeScript compiler error in `apps/` or `packages/` invalidates the zero-error typecheck baseline.
