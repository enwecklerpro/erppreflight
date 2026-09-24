# Handoff Report: Monorepo Architecture & Dependency Inventory

**Agent**: `explorer_monorepo_1`  
**Role**: `teamwork_preview_explorer`  
**Timestamp**: 2026-09-24T02:57:00Z  
**Target Repository**: `H:/erppreflight`  

---

## 1. Observation

### 1.1 Workspace Layout & Packages
- **Root `pnpm-workspace.yaml`** (`H:/erppreflight/pnpm-workspace.yaml:1-7`):
  ```yaml
  packages:
    - 'apps/*'
    - 'packages/*'
    - 'services/*'
    - 'engines/*'
    - 'integrations/*'
  ```
- **Discovered Workspace Packages** (via `pnpm ls -r --depth -1`):
  - Root: `erppreflight-monorepo@0.1.0` (`H:/erppreflight`)
  - Apps:
    - `@erppreflight/api@0.1.0` (`H:/erppreflight/apps/api`)
    - `@erppreflight/web@0.1.0` (`H:/erppreflight/apps/web`)
  - Packages:
    - `@erppreflight/auth@0.1.0` (`H:/erppreflight/packages/auth`)
    - `@erppreflight/database@0.1.0` (`H:/erppreflight/packages/database`)
    - `@erppreflight/evidence@0.1.0` (`H:/erppreflight/packages/evidence`)
    - `@erppreflight/schemas@0.1.0` (`H:/erppreflight/packages/schemas`)
    - `@erppreflight/tenancy@0.1.0` (`H:/erppreflight/packages/tenancy`)
  - Python Microservice:
    - `services/analysis-python` (FastAPI microservice; Python 3.12+, `pyproject.toml`, 101 pytest tests passing). Not a pnpm package.
  - Non-existent directories declared in workspace config:
    - `packages/ui` does NOT exist.
    - `engines/*` does NOT exist.
    - `integrations/*` does NOT exist.

### 1.2 Package Linking & Internal Dependencies
All internal packages are consumed via `"workspace:*"`:
- `@erppreflight/web`: depends on `@erppreflight/schemas: workspace:*`, `@erppreflight/evidence: workspace:*`.
- `@erppreflight/api`: depends on `@erppreflight/auth`, `@erppreflight/database`, `@erppreflight/evidence`, `@erppreflight/schemas`, `@erppreflight/tenancy` (all `workspace:*`).
- `@erppreflight/database`: depends on `@erppreflight/schemas`, `@erppreflight/tenancy`.
- `@erppreflight/auth`: depends on `@erppreflight/schemas`.
- `@erppreflight/tenancy`: depends on `@erppreflight/schemas`.
- `@erppreflight/evidence`: depends on `@erppreflight/schemas`.
- `@erppreflight/schemas`: zero internal dependencies (leaf node).
Internal symlinks verified present in each package's local `node_modules/@erppreflight/`.

### 1.3 TypeScript & Turborepo Configuration
- **Root `tsconfig.base.json`** (`H:/erppreflight/tsconfig.base.json:1-18`):
  - `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `strict: true`, `declaration: true`.
- **Root `tsconfig.json`** (`H:/erppreflight/tsconfig.json:1-25`):
  - Extends `./tsconfig.base.json`. Defines `paths` mapping `@erppreflight/*` directly to `packages/*/src/index.ts`.
- **App/Package `tsconfig.json`**:
  - `apps/web/tsconfig.json`: extends `../../tsconfig.base.json`, `module: esnext`, `moduleResolution: bundler`, `jsx: preserve`, `plugins: [{ name: "next" }]`, `paths: { "@/*": ["./src/*"] }`. It does NOT define path aliases for `@erppreflight/*`, relying on built package output via pnpm symlinks.
  - `apps/api/tsconfig.json` & all `packages/*/tsconfig.json`: extend `../../tsconfig.base.json`, use `module: CommonJS`, `moduleResolution: Node`, `outDir: ./dist`.
- **Turborepo (`turbo.json`)**:
  - `turbo@2.11.3` is installed in root `devDependencies`.
  - Defines pipelines: `build` (depends on `^build`), `typecheck` (depends on `^build`), `lint`, `test` (depends on `build`), `dev`, `clean`.
  - Execution test: `$env:PATH = "$env:APPDATA\npm;$env:PATH"; pnpm run typecheck` returned exit code 0 (12 tasks cached/successful).

### 1.4 Dependency Inventory vs. Part 21 Specification

| Library / Category | Part 21 Requirement | Currently Installed? | Installed Version | Status / Notes |
|---|---|---|---|---|
| **@tanstack/react-query** | Required (Server state, caching) | ❌ NO | None | Missing completely from all packages and `pnpm-lock.yaml`. |
| **@tanstack/react-table** | Required (Data tables) | ❌ NO | None | Missing completely from all packages and `pnpm-lock.yaml`. |
| **@tanstack/react-virtual** | Required (Large list/table virtualization) | ❌ NO | None | Missing completely from all packages and `pnpm-lock.yaml`. |
| **@tanstack/react-form** | Required (Forms) | ❌ NO | None | Missing completely from all packages and `pnpm-lock.yaml`. |
| **@tanstack/pacer** | Required (Debounce, throttle, batching) | ❌ NO | None | Missing completely from all packages and `pnpm-lock.yaml`. |
| **zod** | Required (Zod 4 runtime validation) | ⚠️ PARTIAL | `3.25.76` (`^3.24.2`) | Installed in `web`, `api`, `schemas`, `evidence`. Still Zod v3, not Zod v4. |
| **base-ui** (`@base-ui-components`) | Preferred headless primitive foundation | ❌ NO | None | Not installed. |
| **shadcn/ui** | Product component layer | ❌ NO | None | No `components.json`, no `components/ui` folder. |
| **@radix-ui/react-*** | Acceptable legacy primitives | ⚠️ UNUSED | Dialog `1.1.23`, Dropdown `2.1.24`, Select `2.3.7`, Slot `1.3.3`, Tabs `1.1.21`, Tooltip `1.2.16` | Present in `apps/web/package.json`, but ZERO imports found in `apps/web/src/`. Modals use custom divs. |
| **orval** | OpenAPI client & hook generator | ❌ NO | None | Not installed; no `orval.config.ts`. `apps/web/src/lib/api-client.ts` is hand-written. |
| **@xyflow/react** (React Flow) | Dependency & change graphs | ❌ NO | None | Not installed. |
| **tailwindcss** | CSS foundation | ✅ YES | `3.4.19` (`^3.4.17`) | In `apps/web/devDependencies`. Configured with `postcss` and `autoprefixer`. |
| **lucide-react** | Icon system | ✅ YES | `0.475.0` (`^0.475.0`) | In `apps/web/dependencies`. Actively imported across 8 files in `apps/web`. |
| **motion** / **framer-motion** | Intentional micro-interactions | ❌ NO | None | Not installed. |
| **class-variance-authority** | Design system variant helper | ⚠️ UNUSED | `0.7.1` | Present in `apps/web/package.json`, not yet imported in `src/`. |
| **clsx** & **tailwind-merge** | Class merging | ⚠️ UNUSED | `clsx@2.1.1`, `tailwind-merge@3.7.0` | Present in `apps/web/package.json`, not yet imported in `src/`. |
| **drizzle-orm** | Part 21.19 recommended ORM | ❌ NO | None | Current database layer uses raw `pg` (`8.23.0`) in `packages/database`. |

### 1.5 Forbidden / Duplicate Packages Audit
- **`react-hook-form`**: Verified **NOT INSTALLED** (0 matches across `package.json` files and `pnpm-lock.yaml`).
- **`redux` / `@reduxjs/toolkit`**: Verified **NOT INSTALLED** (0 matches).
- **`formik`**: Verified **NOT INSTALLED** (0 matches).
- **`zustand` / `jotai` / `recoil` / `mobx`**: Verified **NOT INSTALLED** (0 matches).
- **`swr`**: Verified **NOT INSTALLED** (0 matches).
- **`axios`**: Verified **NOT INSTALLED** (0 matches). `apps/web` uses native `fetch()`.
- **`prisma`**: Verified **NOT INSTALLED** (0 matches).
- **`TanStack Router` / `TanStack Start`**: Verified **NOT INSTALLED** (Next.js is the sole router).
- **Finding**: Repo is 100% clean of forbidden state/form/table duplicates. There are no competing form or state libraries to remove.

### 1.6 Scripts Audit Across Workspace

| Package / App | `build` | `lint` | `test` | `typecheck` | `clean` | Other Scripts |
|---|---|---|---|---|---|---|
| **Root** (`package.json`) | `turbo run build` | `turbo run lint` | `turbo run test` | `turbo run typecheck` | `turbo run clean` | `dev`, `test:python` |
| **`apps/web`** | `next build` | `tsc --noEmit` | ❌ None | `tsc --noEmit` | `rimraf .next dist` | `dev`, `start` |
| **`apps/api`** | `nest build` | ❌ None | `vitest run` | `tsc --noEmit` | `rimraf dist` | `start`, `start:dev`, `start:prod`, `test:watch`, `test:cov` |
| **`packages/schemas`** | `tsc` | ❌ None | ❌ None | `tsc --noEmit` | `rimraf dist` | None |
| **`packages/database`** | `tsc` | ❌ None | ❌ None | `tsc --noEmit` | `rimraf dist` | None |
| **`packages/auth`** | `tsc` | ❌ None | ❌ None | `tsc --noEmit` | `rimraf dist` | None |
| **`packages/tenancy`** | `tsc` | ❌ None | ❌ None | `tsc --noEmit` | `rimraf dist` | None |
| **`packages/evidence`** | `tsc` | ❌ None | ❌ None | `tsc --noEmit` | `rimraf dist` | None |

#### Script Discrepancies Observed:
1. **`lint` gap**: Only `apps/web` defines `"lint": "tsc --noEmit"`. ESLint (`eslint@8.57.1`, `eslint-config-next@16.3.6`) is installed in `apps/web` devDependencies, but no `.eslintrc*` exists and `eslint` is never invoked. `apps/api` and `packages/*` define no `lint` script at all.
2. **`test` gap**: Only `apps/api` defines `"test": "vitest run"`. `apps/web` has no test framework (no Vitest, Jest, or Playwright). `packages/*` have no test scripts (their tests are currently driven via `apps/api/test` integration suites).
3. **`test:python`**: Root defines `"py -m pytest services/analysis-python/tests -v"`, which passes 101 tests.

---

## 2. Logic Chain

1. **Premise**: The user request and Milestone 2 require implementing the curated Part 21 library stack and TanStack suite architecture in `H:/erppreflight`.
2. **Observation**: Searching all package.json files and `pnpm-lock.yaml` reveals that 0 TanStack packages (`@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `@tanstack/react-form`, `@tanstack/pacer`) are currently installed.
3. **Inference**: The frontend (`apps/web`) is currently built with primitive Next.js state (`useState` + `useEffect` in `apps/web/src/app/inspector/page.tsx:23-25` and `apps/web/src/app/projects/page.tsx:13-18`). No query client, caching layer, or table virtualization exists.
4. **Observation**: The forbidden packages check (`react-hook-form`, `redux`, `@reduxjs/toolkit`, `zustand`, `formik`, `prisma`) yielded zero occurrences in the codebase.
5. **Inference**: There is zero legacy cleanup needed for forbidden libraries; the repository is in an ideal greenfield state for pure TanStack suite installation without migration collisions.
6. **Observation**: `apps/web/package.json` contains `@radix-ui/react-*` dependencies, but grep across `apps/web/src` confirmed 0 imports. Modals and dropdowns are implemented with raw DOM elements and Tailwind.
7. **Inference**: Adopting Base UI or standardizing shadcn/ui components will not break existing Radix UI implementations, as Radix is completely unused despite being in `package.json`.
8. **Observation**: `pnpm-workspace.yaml` declares `packages/*`, `apps/*`, `services/*`, `engines/*`, `integrations/*`. Discovered packages match the 7 active TypeScript projects. `pnpm ls -r --depth 0` confirms all 7 packages resolve workspace dependencies via `link:` without version conflicts.
9. **Inference**: The monorepo workspace linking is robust. Adding a new workspace package (such as `packages/ui` for shared TanStack table, form, or design system components) or adding TanStack dependencies directly to `apps/web` will fit cleanly into the existing pnpm and turbo setup.

---

## 3. Caveats

1. **`pnpm` in Windows PATH**: `pnpm` is not in the default Windows system PATH; it is managed by Corepack. Running `pnpm` directly in a fresh shell requires adding `$env:APPDATA\npm` to `$env:PATH` or running through `corepack pnpm`.
2. **Packages Build Output (`dist`)**: Monorepo packages (`schemas`, `database`, `auth`, `tenancy`, `evidence`) do not use source-linking in `apps/web`; `apps/web` imports from their built `dist` folders. Turborepo handles this via `dependsOn: ["^build"]`. Whenever a package is modified, `pnpm run build` must be executed to refresh `dist/`.
3. **Zod 3 vs Zod 4**: Part 21 references Zod 4, but current packages use `zod@^3.24.2` (resolving to `3.25.76`). Zod 4 is currently in pre-release/alpha upstream; any migration to Zod 4 should verify compatibility with NestJS, class-validator, and Next.js.
4. **`packages/ui`**: No `packages/ui` currently exists. If shared components are required across apps, `packages/ui` would need to be created, or UI components should be housed in `apps/web/src/components/`.

---

## 4. Conclusion

1. **Architecture Status**: The monorepo has a clean Turborepo + pnpm workspace structure with 2 apps (`api`, `web`) and 5 core packages (`auth`, `database`, `evidence`, `schemas`, `tenancy`), plus the Python microservice (`services/analysis-python`).
2. **TanStack Stack Status**: 0% implemented. No `@tanstack/*` packages exist in the repository.
3. **Zero Duplication Verified**: No forbidden state/form/table libraries (`react-hook-form`, `redux`, `@reduxjs/toolkit`, `zustand`, `formik`) exist anywhere in the repository.
4. **Radix UI Clean State**: 6 Radix packages are installed in `apps/web/package.json` but have 0 imports in `apps/web/src/`.
5. **Next Steps for Implementation Team**:
   - Install TanStack suite in `apps/web`: `@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `@tanstack/react-form`, and TanStack Pacer utilities.
   - Establish QueryClient factory with SSR hydration safety for Next.js App Router.
   - Replace manual `useState`/`useEffect` in `apps/web/src/app/projects/page.tsx` and `apps/web/src/app/inspector/page.tsx` with TanStack Query hooks and TanStack Table/Virtual data grids.
   - Install `@xyflow/react` and `orval` per Part 21 requirements.
   - Add Playwright / Vitest for `apps/web` and configure proper `lint` scripts running ESLint.

---

## 5. Verification Method

To independently verify these findings, run the following commands from repository root `H:/erppreflight`:

1. **Verify Workspace Structure**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm ls -r --depth -1
   ```
   *Expected output*: 8 entries (root + 2 apps + 5 packages).

2. **Verify TanStack Absence**:
   ```powershell
   rg -i "@tanstack" H:/erppreflight/package.json H:/erppreflight/apps/*/package.json H:/erppreflight/packages/*/package.json H:/erppreflight/pnpm-lock.yaml
   ```
   *Expected output*: No matches.

3. **Verify Forbidden Packages Absence**:
   ```powershell
   rg -i "(react-hook-form|@reduxjs|redux|formik|zustand)" H:/erppreflight/package.json H:/erppreflight/apps/*/package.json H:/erppreflight/packages/*/package.json
   ```
   *Expected output*: No matches.

4. **Verify Typecheck and Build**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm run typecheck
   pnpm run build
   pnpm run test
   ```
   *Expected output*: All turbo tasks pass cleanly.
