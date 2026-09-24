# Milestone 2: Curated Library Standardization & Alignment — Handoff Report

**Agent**: `worker_m2_1`  
**Working Directory**: `H:/erppreflight/.agents/worker_m2_1`  
**Parent Agent**: `66440be0-c7ee-4a74-8a17-61e13b963df1`  
**Milestone**: Milestone 2 — Curated Library Standardization, Orval Architecture, and Dependency Governance  
**Timestamp**: 2026-09-24T05:22:00Z  

---

## 1. Observation

### 1.1 Modified & Created File Inventory (Exclusive Write Ownership)
All changes strictly respected exclusive write boundaries:
1. `H:/erppreflight/apps/web/package.json`:
   - Added dependencies:
     - `"@base-ui-components/react": "1.0.0-rc.0"`
     - `"@tanstack/react-form": "^1.33.5"`
     - `"@tanstack/react-pacer": "^0.23.0"`
     - `"@tanstack/react-query": "^5.66.0"`
     - `"@tanstack/react-table": "^8.21.3"`
     - `"@tanstack/react-virtual": "^3.14.0"`
     - `"@xyflow/react": "^12.11.6"`
     - `"elkjs": "^0.12.0"`
     - `"motion": "^12.43.0"`
   - Added devDependencies:
     - `"@tanstack/react-query-devtools": "^5.66.0"`
     - `"orval": "^8.37.0"`
   - Added script:
     - `"codegen:api": "orval"`
2. `H:/erppreflight/apps/web/src/lib/api/custom-instance.ts`:
   - Production custom fetch mutator for Orval and TanStack Query v5.
   - Normalizes base URLs by stripping redundant `/api/v1` prefixes.
   - Automatically injects `X-Tenant-Id` from local storage or request options.
   - Automatically injects `Authorization: Bearer <token>` from local storage or request options.
   - Forwards `AbortSignal` for query cancellation.
   - Handles HTTP 204 No Content and empty response bodies cleanly.
   - Emits structured `ApiError` instances matching the NestJS `HttpExceptionFilter` error contract.
3. `H:/erppreflight/apps/web/orval.config.ts`:
   - Configures Orval codegen with `mode: 'tags-split'`, target client `'react-query'`, TanStack Query `version: 5`, `signal: true`, and custom mutator pointing to `./src/lib/api/custom-instance.ts`.
4. `H:/erppreflight/orval.config.ts`:
   - Root Orval configuration with identical tag-split and react-query v5 settings pointing to `./apps/web/src/lib/api/custom-instance.ts`.
5. `H:/erppreflight/scripts/check-no-dependency-soup.mjs`:
   - Automated compliance auditor validating 10 concern categories across all 8 monorepo `package.json` files and all source files.
6. `H:/erppreflight/package.json`:
   - Added scripts:
     - `"check:deps": "node scripts/check-no-dependency-soup.mjs"`
     - `"codegen:api": "pnpm --filter @erppreflight/web codegen:api"`
7. `H:/erppreflight/pnpm-lock.yaml`:
   - Updated lockfile resolving and linking all new dependencies (+141 packages).

### 1.2 Direct Execution & Verification Observations
Verbatim execution results in the repository environment:

1. **Anti-Duplication Dependency Check**:
   - Command: `pnpm run check:deps`
   - Output:
     ```
     === ERP Preflight: No-Dependency-Soup Compliance Audit ===
     Scanning 8 package.json files across monorepo...
     Scanning 132 TypeScript/JavaScript source files...

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
     Zero prohibited duplicate libraries detected across all 8 package.json files and 132 source files.
     ```
   - Exit code: 0

2. **TypeScript Monorepo Typecheck**:
   - Command: `pnpm exec turbo run typecheck --force`
   - Output:
     ```
     • turbo 2.11.3
        • Packages in scope: @erppreflight/api, @erppreflight/auth, @erppreflight/database, @erppreflight/evidence, @erppreflight/schemas, @erppreflight/tenancy, @erppreflight/web
        • Running typecheck in 7 packages
      Tasks:    12 successful, 12 total
     Cached:    0 cached, 12 total
       Time:    6.797s
     ```
   - Exit code: 0 (zero TypeScript errors).

3. **Full Monorepo Build**:
   - Command: `pnpm exec turbo run build --force`
   - Output:
     ```
     • turbo 2.11.3
        • Packages in scope: @erppreflight/api, @erppreflight/auth, @erppreflight/database, @erppreflight/evidence, @erppreflight/schemas, @erppreflight/tenancy, @erppreflight/web
        • Running build in 7 packages
      @erppreflight/web:build:    ▲ Next.js 15.5.26
      @erppreflight/web:build:    Creating an optimized production build ...
      @erppreflight/web:build:  ✓ Compiled successfully in 1038ms
      @erppreflight/web:build:  ✓ Generating static pages (6/6)
      Tasks:    7 successful, 7 total
     Cached:    0 cached, 7 total
       Time:    15.709s
     ```
   - Exit code: 0.

4. **Codegen Validation**:
   - Command: `$env:OPENAPI_SPEC_URL = "H:/erppreflight/.agents/explorer_m2_orval_1/openapi-sample.json"; pnpm --filter @erppreflight/web codegen:api`
   - Output:
     ```
     > @erppreflight/web@0.1.0 codegen:api H:\erppreflight\apps\web
     > orval
     🍻 orval v8.37.0 - A swagger client generator for typescript
     api - Cleaning output folder
     api - 🎉 ERP Preflight Core API - Your OpenAPI spec has been converted into ready to use orval!
     ```
   - Verified generated files: `apps/web/src/lib/api/generated/endpoints/projects/projects.ts` generated with `customInstance` mutator, TanStack Query v5 `useQuery` for GET and `useMutation` for POST/PUT/DELETE.

5. **Test Suite Baseline Regressions**:
   - `pnpm run test` (NestJS / Vitest): 14 test files passed, 237 passed in 1.19s (100% pass rate).
   - `pnpm run test:python` (Python pytest): 131 passed, 11 xfailed in 0.34s (100% pass rate).

---

## 2. Logic Chain

1. **Standardization Adherence**:
   - `ORIGINAL_REQUEST.md` and `AGENTS.md §4.2` mandate strict single-curated-library per concern (No-Dependency-Soup).
   - All specified libraries (`@tanstack/react-query@^5.66.0`, `@tanstack/react-table@^8.21.3`, `@tanstack/react-virtual@^3.14.0`, `@tanstack/react-form@^1.33.5`, `@tanstack/react-pacer@^0.23.0`, `@base-ui-components/react@1.0.0-rc.0`, `@xyflow/react@^12.11.6`, `elkjs@^0.12.0`, `motion@^12.43.0`, `orval@^8.37.0`) were added to `apps/web/package.json`.
2. **React 19 Compatibility**:
   - By installing these verified versions, `pnpm install` resolved all dependencies without peer dependency conflicts on React 19.3.0 and Next.js 15.5.26.
3. **Orval Mutator Integration**:
   - `custom-instance.ts` implements base URL normalization to prevent duplicate `/api/v1/api/v1` path concatenation, provides tenant header isolation (`X-Tenant-Id`), bearer authentication, abort signal forwarding, and safe error parsing with `ApiError`.
4. **Configuration Safety**:
   - Setting `mock: false` in `orval.config.ts` ensures that codegen produces query and mutation hooks and TypeScript models without generating MSW mock handlers that require the uninstalled `msw` dependency.
5. **Zero-Error Quality Gate**:
   - `pnpm run check:deps`, `pnpm run typecheck --force`, and `pnpm run build --force` all executed cleanly with exit code 0.

---

## 3. Caveats

1. **MSW Mock Generation**:
   - If mock generation (`.msw.ts`) is desired in future testing milestones, `msw@^2.7.0` should be installed into `apps/web` devDependencies and `mock: true` enabled.
2. **Server-Side API Calls**:
   - `custom-instance.ts` safely guards `window` and `localStorage` checks for Next.js SSR. In SSR Server Components, auth headers or tenant IDs must be supplied via `options.headers` (e.g. from cookies).
3. **Shell Environment**:
   - When executing commands in PowerShell subshells that do not load interactive profiles, ensure `$env:APPDATA\npm` is in `$env:PATH` to invoke `pnpm`.

---

## 4. Conclusion

Milestone 2 implementation is 100% complete and verified:
- All required TanStack, Base UI, XYFlow, Elk, and Motion dependencies are installed and locked.
- Production fetch mutator `custom-instance.ts` and `orval.config.ts` are in place and verified with Orval codegen.
- Anti-duplication checker `scripts/check-no-dependency-soup.mjs` is implemented and wired into root `package.json` under `check:deps`.
- Zero TypeScript compilation errors, zero build errors, zero test regressions.

---

## 5. Verification Method

To independently verify all work:

1. **Verify No-Dependency-Soup Compliance**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm run check:deps
   ```
   *Expected*: Prints `✔ SUCCESS: 100% compliant with No-Dependency-Soup standard!` and exits with code 0.

2. **Verify Monorepo TypeScript Compilation**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm exec turbo run typecheck --force
   ```
   *Expected*: 12 successful tasks, 0 type errors.

3. **Verify Monorepo Production Build**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm exec turbo run build --force
   ```
   *Expected*: 7 packages build cleanly with 0 errors.

4. **Verify Orval Codegen**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   $env:OPENAPI_SPEC_URL = "H:/erppreflight/.agents/explorer_m2_orval_1/openapi-sample.json"
   pnpm --filter @erppreflight/web codegen:api
   ```
   *Expected*: Orval prints conversion success message and creates typed endpoints in `apps/web/src/lib/api/generated`.
