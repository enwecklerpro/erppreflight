# Milestone 2: Curated Library Standardization & Alignment
## Dependency Strategy & Compatibility Report for `apps/web`

**Author**: `explorer_m2_deps_1`  
**Date**: 2026-09-24  
**Target Monorepo**: `H:/erppreflight`  
**Scope**: `apps/web/package.json`, root `package.json`, React 19 & Next.js 15 alignment

---

## 1. Observation

### 1.1 Existing Repository Foundation
- **Root `package.json`** (`H:/erppreflight/package.json`):
  - `packageManager`: `"pnpm@10.20.0"`
  - `engines`: Node `>=20.0.0`, pnpm `>=9.0.0`
  - Node version installed: `v22.20.0`
  - pnpm version active: `10.20.0` (accessible via `npx pnpm` or `$env:APPDATA\npm\pnpm`)
- **Web App `apps/web/package.json`** (`H:/erppreflight/apps/web/package.json`):
  - Framework: `"next": "^15.1.7"` (resolved in lockfile to `15.5.26`)
  - UI Library: `"react": "^19.0.0"`, `"react-dom": "^19.0.0"` (resolved to `19.3.0`)
  - Typing: `"@types/react": "^19.0.8"`, `"@types/react-dom": "^19.0.3"`
  - Styling & Helpers: `"tailwindcss": "^3.4.17"`, `"class-variance-authority": "^0.7.1"`, `"clsx": "^2.1.1"`, `"tailwind-merge": "^3.0.1"`, `"lucide-react": "^0.475.0"`
  - Validation: `"zod": "^3.24.2"` (resolved to `3.25.76`)
  - Current Radix primitives: `@radix-ui/react-dialog@^1.1.6`, `@radix-ui/react-dropdown-menu@^2.1.6`, `@radix-ui/react-select@^2.1.6`, `@radix-ui/react-slot@^1.1.2`, `@radix-ui/react-tabs@^1.1.3`, `@radix-ui/react-tooltip@^1.1.8`
- **Prohibited Libraries Audit**:
  - `explorer_m2_audit_1` verified: 0 occurrences of `react-hook-form`, `formik`, `redux`, `mobx`, `recoil`, `prisma`, `typeorm`, `cytoscape`, `vis.js`, `ag-grid`, `recharts`, `swr`, `joi`, `yup` across all 8 `package.json` files and 112 source files.
  - Current baseline builds cleanly: `pnpm run typecheck` (12 tasks, 0 errors), `pnpm run build` (7 packages succeed).

### 1.2 Target Library Registry Investigation Results
Queried directly against the official npm registry (`registry.npmjs.org`):

1. **`@tanstack/react-query`**:
   - Latest release: `5.103.2` (recommended range: `^5.66.0` or `^5.103.0`)
   - `peerDependencies`: `{ "react": "^18 || ^19" }`
   - Companion Devtools: `@tanstack/react-query-devtools@5.103.2` (peerDeps: `{ "react": "^18 || ^19", "@types/react": "^18 || ^19", "@tanstack/react-query": "^5.103.2" }`)
2. **`@tanstack/react-table`**:
   - Latest v8 release: `8.21.3` (recommended range: `^8.21.2` or `^8.21.3`)
   - `peerDependencies`: `{ "react": ">=16.8", "react-dom": ">=16.8" }`
   - *Note on v9*: npm `latest` dist-tag points to `9.2.4`. However, Part 21 and the shadcn/ui ecosystem explicitly specify Table v8. Pinned to `^8.21.3`.
3. **`@tanstack/react-virtual`**:
   - Latest v3 release: `3.14.13` (recommended range: `^3.14.0`)
   - `peerDependencies`: `{ "react": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0", "react-dom": "^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0" }`
4. **`@tanstack/react-form`**:
   - Latest release: `1.33.5` (recommended range: `^1.33.5`)
   - `peerDependencies`: `{ "react": "^17.0.0 || ^18.0.0 || ^19.0.0" }`
   - Dependencies: `{"@tanstack/form-core": "1.33.5", "@tanstack/react-store": "^0.11.0"}`
   - Export analysis: Exports `standardSchemaValidators` from `./standardSchemaValidator.js` adhering to **Standard Schema v1** (`~standard`).
5. **`@tanstack/zod-form-adapter` (Status & Discovery)**:
   - Latest release: `0.42.1` (published Feb 2025; no 1.x release exists).
   - Dependencies: `{"@tanstack/form-core": "0.42.1"}`
   - Runtime test on repo's `zod@3.25.76`: `z.string()['~standard']` outputs `{ version: 1, vendor: 'zod', validate: [Function: validate] }`.
6. **TanStack Pacer (`@tanstack/react-pacer`)**:
   - Latest release: `0.23.0` (with `@tanstack/pacer@0.22.0`)
   - `peerDependencies`: `{ "react": ">=16.8", "react-dom": ">=16.8" }`
   - Subpath exports: `./debouncer`, `./throttler`, `./batcher`, `./async-debouncer`, `./async-throttler`, `./rate-limiter`, `./queuer`, `./provider`.
7. **`@base-ui-components/react`**:
   - Latest release: `1.0.0-rc.0`
   - `peerDependencies`: `{ "react": "^17 || ^18 || ^19", "react-dom": "^17 || ^18 || ^19", "@types/react": "^17 || ^18 || ^19" }`
8. **`@xyflow/react`**:
   - Latest release: `12.11.6`
   - `peerDependencies`: `{ "react": ">=17", "react-dom": ">=17", "@types/react": ">=17", "@types/react-dom": ">=17" }`
   - Layout companion: `elkjs@0.12.0` (types bundled directly in package).
9. **`motion` (`motion/react`)**:
   - Latest release: `12.43.0` (v12 line) / `13.4.2`
   - `peerDependencies`: `{ "react": "^18.0.0 || ^19.0.0", "react-dom": "^18.0.0 || ^19.0.0" }`
   - Canonical export: `motion/react` (e.g., `import { motion, AnimatePresence } from 'motion/react'`).
10. **`orval`**:
    - Latest release: `8.37.0` (devDependencies in `apps/web`)
    - Role: Generates typed API clients and TanStack Query hooks from OpenAPI specifications.

---

## 2. Logic Chain

1. **Monorepo Baseline Integrity**:
   - Observation 1.1 shows that `apps/web` uses React 19.3.0 and Next.js 15.1.7 with TypeScript 5.7.3 in strict mode. All new dependencies must declare compatibility with React 19 in `peerDependencies` to avoid pnpm resolution errors or duplicate React instance hazards during SSR.
2. **React 19 Compatibility Validation**:
   - Observations 1.2.1 through 1.2.9 confirm that `@tanstack/react-query` (`^18 || ^19`), `@tanstack/react-table` (`>=16.8`), `@tanstack/react-virtual` (`^19.0.0`), `@tanstack/react-form` (`^19.0.0`), `@tanstack/react-pacer` (`>=16.8`), `@base-ui-components/react` (`^19`), `@xyflow/react` (`>=17`), and `motion` (`^19.0.0`) all formally support React 19. None of them generate peer dependency conflicts.
3. **TanStack Table Version Pinning**:
   - Observation 1.2.2 shows npm `latest` is `9.2.4`, but Part 21.3 and the mission specification mandate `v8` (`@tanstack/react-table (v8)`). Table v8 (`8.21.3`) is mature, stable, supports React 19, and is the foundation for shadcn/ui data tables. Therefore, `apps/web` must install `@tanstack/react-table@^8.21.3`.
4. **TanStack Form & Zod Validation Architecture**:
   - Observation 1.2.4 & 1.2.5 reveal that TanStack Form 1.x has transitioned to **Standard Schema v1**. In `apps/web`, `zod@^3.24.2` (resolved to `3.25.76`) natively exposes `['~standard']`.
   - Therefore, `@tanstack/react-form` validates Zod schemas out of the box without any external adapter package.
   - Installing `@tanstack/zod-form-adapter@0.42.1` is **counter-productive** because it is an orphaned package pinning `@tanstack/form-core@0.42.1`, which would introduce conflicting duplicate form cores.
   - For complete backward compatibility with code expecting a `zodValidator()` helper, a lightweight wrapper in `apps/web/src/lib/form/zod-adapter.ts` can be provided without pulling in deprecated packages.
5. **TanStack Pacer Strategy**:
   - `@tanstack/react-pacer@^0.23.0` is published and available.
   - In addition, to guarantee zero bundle overhead and zero SSR hydration quirks in Next.js 15, a local hook implementation (`apps/web/src/hooks/use-pacer.ts`) provides `useDebounce`, `useThrottle`, and `useBatcher` matching TanStack Pacer API contracts.
6. **Headless UI Coexistence**:
   - Part 21.1 states: "Existing/third-party components using Radix may be accepted where migration provides no value, but the design system must expose one consistent ERP Preflight component API."
   - Retaining the existing `@radix-ui/*` packages while adding `@base-ui-components/react@1.0.0-rc.0` ensures existing UI continues rendering while all new components are built on Base UI primitives.
7. **Next.js 15 App Router Boundary Rules**:
   - Next.js 15 App Router defaults to Server Components (RSC).
   - TanStack Query hooks, TanStack Table, TanStack Form, Base UI primitives, Motion, and `@xyflow/react` all require browser DOM or React state.
   - All components wrapping these libraries must include the `"use client";` directive at the top of the file.
   - `@xyflow/react` should be dynamically imported (`next/dynamic` with `{ ssr: false }`) in route pages to avoid server evaluation of canvas/DOM measurements.
   - The QueryClient factory must strictly follow the SSR-safe pattern: instantiate a new `QueryClient` per request on the server, and maintain a shared singleton in the browser window.

---

## 3. Caveats

1. **`@tanstack/zod-form-adapter` Deprecation**:
   - The prompt asks for `"@tanstack/react-form (and @tanstack/zod-form-adapter)"`. As proved in Observation 1.2.5, `@tanstack/zod-form-adapter` was frozen at `0.42.1` for Form v0.42. Do NOT install `0.42.1` in production alongside `@tanstack/react-form@^1.33.5`. TanStack Form 1.x supports Zod natively via Standard Schema v1.
2. **`@xyflow/react` Canvas in SSR**:
   - `@xyflow/react` depends on DOM dimensions and `ResizeObserver`. Server-side rendering will throw `window is not defined` if rendered directly in a Server Component without dynamic loading or `"use client"`.
3. **`motion/react` vs `framer-motion`**:
   - Motion v12+ deprecates importing from `framer-motion`. Developers must import exclusively from `"motion/react"`.
4. **`orval` DevDependency Classification**:
   - `orval` is a build-time codegen tool. It must be in `devDependencies` to avoid polluting the frontend production bundle.

---

## 4. Conclusion & Actionable Execution Plan

### 4.1 Recommended Version Matrix

| Library / Tool | Target Version | Type | Peer Requirements | React 19 Status | Next.js 15 Note |
|---|---|---|---|---|---|
| **`@tanstack/react-query`** | `^5.66.0` | `dependencies` | `react: '^18 \|\| ^19'` | Verified | SSR factory + HydrationBoundary |
| **`@tanstack/react-query-devtools`** | `^5.66.0` | `devDependencies` | `react: '^18 \|\| ^19'` | Verified | Dev-only conditional render |
| **`@tanstack/react-table`** | `^8.21.3` | `dependencies` | `react: '>=16.8'` | Verified | Pinned to v8 per spec |
| **`@tanstack/react-virtual`** | `^3.14.0` | `dependencies` | `react: '^19.0.0'` | Verified | Client-side list virtualization |
| **`@tanstack/react-form`** | `^1.33.5` | `dependencies` | `react: '^19.0.0'` | Verified | Native Standard Schema Zod |
| **`@tanstack/react-pacer`** | `^0.23.0` | `dependencies` | `react: '>=16.8'` | Verified | Debounce/throttle primitives |
| **`@base-ui-components/react`** | `1.0.0-rc.0` | `dependencies` | `react: '^19'` | Verified | Preferred headless foundation |
| **`@xyflow/react`** | `^12.11.6` | `dependencies` | `react: '>=17'` | Verified | Dynamic import (`ssr: false`) |
| **`elkjs`** | `^0.12.0` | `dependencies` | none | Verified | Automatic graph layout engine |
| **`motion`** | `^12.43.0` | `dependencies` | `react: '^19.0.0'` | Verified | Import from `motion/react` |
| **`orval`** | `^8.37.0` | `devDependencies` | none | Verified | OpenAPI typed hook codegen |

---

### 4.2 Exact Installation & Modification Commands

#### Option 1: Using `pnpm` CLI via Terminal
Run the following commands from repository root (`H:/erppreflight`):

```bash
# 1. Install production dependencies in apps/web
npx pnpm --filter @erppreflight/web add @tanstack/react-query@^5.66.0 @tanstack/react-table@^8.21.3 @tanstack/react-virtual@^3.14.0 @tanstack/react-form@^1.33.5 @tanstack/react-pacer@^0.23.0 @base-ui-components/react@1.0.0-rc.0 @xyflow/react@^12.11.6 elkjs@^0.12.0 motion@^12.43.0

# 2. Install dev dependencies in apps/web
npx pnpm --filter @erppreflight/web add -D @tanstack/react-query-devtools@^5.66.0 orval@^8.37.0
```

#### Option 2: Direct Edit to `apps/web/package.json` + `pnpm install`
Update `apps/web/package.json` as follows:

```json
{
  "name": "@erppreflight/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf .next dist",
    "codegen:api": "orval"
  },
  "dependencies": {
    "@base-ui-components/react": "1.0.0-rc.0",
    "@erppreflight/evidence": "workspace:*",
    "@erppreflight/schemas": "workspace:*",
    "@radix-ui/react-dialog": "^1.1.6",
    "@radix-ui/react-dropdown-menu": "^2.1.6",
    "@radix-ui/react-select": "^2.1.6",
    "@radix-ui/react-slot": "^1.1.2",
    "@radix-ui/react-tabs": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.1.8",
    "@tanstack/react-form": "^1.33.5",
    "@tanstack/react-pacer": "^0.23.0",
    "@tanstack/react-query": "^5.66.0",
    "@tanstack/react-table": "^8.21.3",
    "@tanstack/react-virtual": "^3.14.0",
    "@xyflow/react": "^12.11.6",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "elkjs": "^0.12.0",
    "lucide-react": "^0.475.0",
    "motion": "^12.43.0",
    "next": "^15.1.7",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^3.0.1",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@tanstack/react-query-devtools": "^5.66.0",
    "@types/node": "^22.13.0",
    "@types/react": "^19.0.8",
    "@types/react-dom": "^19.0.3",
    "autoprefixer": "^10.4.20",
    "eslint": "^8.57.1",
    "eslint-config-next": "^16.3.6",
    "orval": "^8.37.0",
    "postcss": "^8.5.1",
    "rimraf": "^6.0.1",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.3"
  }
}
```

Then run:
```bash
npx pnpm install
```

---

## 5. Verification Method

To independently verify this strategy after application by the worker agent:

1. **Monorepo Lockfile Integrity & Peer Resolution**:
   ```powershell
   npx pnpm install --frozen-lockfile=false
   ```
   *Expected result*: Exits with code 0; zero peer dependency conflicts reported for React 19.

2. **TypeScript Compilation Check**:
   ```powershell
   npx pnpm run typecheck
   ```
   *Expected result*: All 12 packages/apps compile cleanly with 0 type errors.

3. **Production Next.js Build**:
   ```powershell
   npx pnpm --filter @erppreflight/web run build
   ```
   *Expected result*: Next.js 15 App Router production build succeeds, creating `.next/static`.

4. **No-Dependency-Soup Enforcement**:
   ```powershell
   node .agents/explorer_m2_audit_1/check-no-dependency-soup.mjs
   ```
   *Expected result*: PASS across all 10 dependency concern categories.

5. **Invalidation Conditions**:
   - Attempting to install `@tanstack/zod-form-adapter@0.42.1` causing duplicate `@tanstack/form-core` resolution.
   - Upgrading `@tanstack/react-table` to `v9` without updating table components to the v9 breaking changes.
   - Importing from `framer-motion` instead of `motion/react`.
