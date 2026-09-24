# Milestone 2 Remediation Handoff Report

**Agent**: `worker_m2_2`  
**Working Directory**: `H:/erppreflight/.agents/worker_m2_2`  
**Parent Agent**: `66440be0-c7ee-4a74-8a17-61e13b963df1`  
**Milestone**: Milestone 2 — Curated Library Standardization & Alignment (Remediation Iteration 2)  
**Timestamp**: 2026-09-24T05:35:00Z  

---

## 1. Observation

### 1.1 Pre-Remediation Issues Identified by Challengers
1. **Stream Double-Consumption Crash in `custom-instance.ts`**:
   - Location: `apps/web/src/lib/api/custom-instance.ts:162-170`
   - Code before fix:
     ```typescript
     if (!response.ok) {
       let errorData: ApiErrorResponse | string;
       try {
         errorData = await response.json();
       } catch {
         errorData = await response.text();
       }
       throw new ApiError(response.status, errorData);
     }
     ```
   - Verbatim Reproduction Command:
     ```powershell
     node --experimental-strip-types H:/erppreflight/.agents/challenger_m2_2/reproduce_stream_bug.mjs
     ```
   - Verbatim Output Before Fix:
     ```
     Caught error name: TypeError
     Caught error message: Body is unusable: Body has already been read
     Is ApiError?: false
     ```

2. **OpenAPI Spec Missing & Destructive Codegen in `orval.config.ts`**:
   - Running `pnpm run codegen:api` without manual environment overrides crashed with:
     ```
     api - Cleaning output folder
     api - 🛑 ENOENT: no such file or directory, open 'H:\erppreflight\apps\api\openapi.json'
     ```
   - Because `clean: true` was configured, the failure wiped out `apps/web/src/lib/api/generated/endpoints` and `models`.

3. **Linter Coverage Blind Spot in `scripts/check-no-dependency-soup.mjs`**:
   - `FORBIDDEN_RULES` lacked the `Application Router` category (`@tanstack/react-router`, `@tanstack/start`, `react-router`, `react-router-dom`) specified in `AGENTS.md §4.2`.
   - `importRegex` did not capture dynamic imports (`await import(...)`) or re-exports (`export ... from '...'`).

---

### 1.2 Remediations Implemented
1. **`apps/web/src/lib/api/custom-instance.ts`**:
   Replaced error parsing with a single-read stream consumption followed by in-memory JSON parsing:
   ```typescript
   if (!response.ok) {
     const text = await response.text();
     let errorData: ApiErrorResponse | string;
     try {
       errorData = text ? (JSON.parse(text) as ApiErrorResponse) : `HTTP ${response.status}`;
     } catch {
       errorData = text || `HTTP ${response.status}`;
     }
     throw new ApiError(response.status, errorData);
   }
   ```
   Post-fix reproduction test execution:
   ```
   node --experimental-strip-types H:/erppreflight/.agents/challenger_m2_2/reproduce_stream_bug.mjs
   --- REPRODUCING FETCH STREAM CONSUMPTION BUG ---
   Caught error name: ApiError
   Caught error message: <html><body>502 Bad Gateway</body></html>
   Caught error constructor: ApiError
   Is ApiError?: true
   ```

2. **`apps/api/openapi.json`**:
   Created permanent canonical OpenAPI 3.0.0 contract containing all 21 core API endpoints (Auth, Workspaces, Projects, Jobs, Health, Files, Audit, Export) and DTO schemas.

3. **`apps/web/orval.config.ts` & `orval.config.ts`**:
   - Updated `clean: false` in both configuration files to prevent destructive output wiping on transient failures.
   - Pointed `input.target` to permanent `apps/api/openapi.json`.
   - Out-of-the-box verification:
     ```powershell
     pnpm run codegen:api
     ```
     Verbatim output:
     ```
     > erppreflight-monorepo@0.1.0 codegen:api H:\erppreflight
     > pnpm --filter @erppreflight/web codegen:api

     > @erppreflight/web@0.1.0 codegen:api H:\erppreflight\apps\web
     > orval

     🍻 orval v8.37.0 - A swagger client generator for typescript
     api - 🎉 ERP Preflight Core API - Your OpenAPI spec has been converted into ready to use orval!
     ```

4. **`scripts/check-no-dependency-soup.mjs`**:
   - Added category `'Application Router'` to `FORBIDDEN_RULES`:
     ```javascript
     {
       category: 'Application Router',
       approved: 'Next.js App Router',
       forbidden: [
         '@tanstack/react-router',
         '@tanstack/start',
         'react-router',
         'react-router-dom'
       ],
       ruleRef: 'AGENTS.md §4.2, Part 21.16 / 21.42'
     },
     ```
   - Hardened `importRegex` to capture static imports, re-exports, dynamic imports, and CommonJS require:
     ```javascript
     const importRegex = /(?:(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
     ```
   - Verified via unit test suite (`test_regex.mjs` and `test_linter_detection.mjs`).

---

### 1.3 Verbatim Quality Gate Results
1. **Dependency Compliance Check (`pnpm run check:deps`)**:
   ```
   === ERP Preflight: No-Dependency-Soup Compliance Audit ===

   Scanning 8 package.json files across monorepo...
   Scanning 134 TypeScript/JavaScript source files...

   --- Category Compliance Matrix ---
    ✔ Application Router                       [Approved: Next.js App Router]
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

   --------------------------------------------------------------

   ✔ SUCCESS: 100% compliant with No-Dependency-Soup standard!
   Zero prohibited duplicate libraries detected across all 8 package.json files and 134 source files.
   ```
   Exit code: `0`.

2. **Monorepo Typecheck (`pnpm run typecheck`)**:
   ```
   Tasks:    12 successful, 12 total
   Cached:    10 cached, 12 total
     Time:    2.664s
   ```
   Exit code: `0`.

3. **Monorepo Build (`pnpm run build`)**:
   ```
   Tasks:    7 successful, 7 total
   Cached:    5 cached, 7 total
     Time:    13.809s
   ```
   Exit code: `0` (Next.js 15.5.26 production build succeeded, all 6 static pages generated).

4. **Monorepo Test Suite (`pnpm test`)**:
   ```
   Test Files  16 passed (16)
        Tests  366 passed (366)
   ```
   Exit code: `0` (100% test pass rate).

---

## 2. Logic Chain

1. **Resolution of Stream Double-Consumption (Challenge 1)**:
   - WHATWG Fetch specifications mandate that a body stream cannot be read a second time once consumed.
   - When the previous code attempted `response.json()` followed by `response.text()` in a catch block, any non-JSON response payload (HTML error page from reverse proxy or gateway) threw an unhandled `TypeError: Body is unusable: Body has already been read`.
   - By reading `const text = await response.text();` first and parsing in-memory, the stream is read exactly once. If parsing fails, the raw text is preserved, and a typed `ApiError` is thrown with the true HTTP status and raw response text.
   - Verified via `reproduce_stream_bug.mjs`, which now catches an `ApiError` instance with `statusCode: 502`.

2. **Resolution of Codegen Dependency on Ephemeral Path (Challenge 2)**:
   - Orval requires an accessible OpenAPI contract to generate typed hooks.
   - Committing `apps/api/openapi.json` into source control makes the contract permanently available across all environments and CI without depending on `.agents/` or a running API instance.
   - Switching `clean: false` prevents accidental data loss if codegen fails.
   - Verified by running `pnpm run codegen:api` with zero environment variable overrides.

3. **Resolution of Linter Gaps (Challenge 1 & 2)**:
   - `AGENTS.md §4.2` explicitly lists Next.js App Router as the single approved router standard, with `@tanstack/react-router`, `@tanstack/start`, and `react-router` prohibited. Adding this rule ensures automated prevention of router dilution.
   - Hardening the regex to `/(?:(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\))/g` closes the dynamic import and re-export blind spots.
   - Verified via `pnpm run check:deps` and automated unit test suite.

---

## 3. Caveats

- **No caveats**: All 5 tasks from the dispatch prompt, challenger handoffs, and `GATE_STATUS.md` have been addressed with zero regressions, maintaining full backward compatibility and strict type safety.

---

## 4. Conclusion

All reported defects and gaps from Milestone 2 Iteration 1 have been completely remediated:
1. `apps/web/src/lib/api/custom-instance.ts` safely handles all non-JSON HTTP errors without stream collision.
2. `apps/api/openapi.json` is committed as a permanent canonical contract.
3. `orval.config.ts` and `apps/web/orval.config.ts` generate cleanly out-of-the-box with `clean: false`.
4. `scripts/check-no-dependency-soup.mjs` enforces the `Application Router` policy and detects dynamic imports / re-exports.
5. All verification commands (`check:deps`, `typecheck`, `build`, `test`) pass cleanly with 100% success rate.

The codebase is fully ready for Milestone 2 approval and progression to Milestone 3.

---

## 5. Verification Method

To independently verify the implementation:

1. **Verify Stream Double-Consumption Fix**:
   ```powershell
   node --experimental-strip-types H:/erppreflight/.agents/challenger_m2_2/reproduce_stream_bug.mjs
   ```
   *Expected result*: Catches `ApiError` with `statusCode: 502`, `Is ApiError?: true`.

2. **Verify Out-of-the-Box Orval Codegen**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm run codegen:api
   ```
   *Expected result*: Exits with code 0 (`Your OpenAPI spec has been converted into ready to use orval!`).

3. **Verify No-Dependency-Soup Linter**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm run check:deps
   ```
   *Expected result*: 11 categories verified, 0 violations detected.

4. **Verify TypeScript Typecheck & Monorepo Build**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm run typecheck
   pnpm run build
   ```
   *Expected result*: 0 TypeScript errors, all package builds succeed.
