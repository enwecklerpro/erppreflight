# Milestone 2: Orval Codegen & Monorepo Build Pipeline — Empirical Challenge Report

**Agent**: `challenger_m2_2`  
**Working Directory**: `H:/erppreflight/.agents/challenger_m2_2`  
**Parent Agent**: `66440be0-c7ee-4a74-8a17-61e13b963df1`  
**Milestone**: Milestone 2 — Curated Library Standardization & Alignment  
**Verdict**: **`REQUEST_CHANGES`**  
**Timestamp**: 2026-09-24T05:30:00Z  

---

## 1. Observation

### 1.1 Monorepo Build & Typecheck Verification (PASS)
Empirical verification of compiler and packaging pipelines across all 7 packages and 8 workspaces:

1. **Monorepo Typecheck**:
   - Command:
     ```powershell
     $env:PATH = "$env:APPDATA\npm;$env:PATH"
     pnpm exec turbo run typecheck --force
     ```
   - Verbatim Output:
     ```
     • turbo 2.11.3
        • Packages in scope: @erppreflight/api, @erppreflight/auth, @erppreflight/database, @erppreflight/evidence, @erppreflight/schemas, @erppreflight/tenancy, @erppreflight/web
        • Running typecheck in 7 packages
      Tasks:    12 successful, 12 total
     Cached:    0 cached, 12 total
       Time:    7.666s
     ```
   - Exit code: `0` (Zero TypeScript compilation errors).

2. **Monorepo Production Build**:
   - Command:
     ```powershell
     $env:PATH = "$env:APPDATA\npm;$env:PATH"
     pnpm exec turbo run build --force
     ```
   - Verbatim Output:
     ```
     • turbo 2.11.3
        • Packages in scope: @erppreflight/api, @erppreflight/auth, @erppreflight/database, @erppreflight/evidence, @erppreflight/schemas, @erppreflight/tenancy, @erppreflight/web
        • Running build in 7 packages
     @erppreflight/web:build:    ▲ Next.js 15.5.26
     @erppreflight/web:build:    Creating an optimized production build ...
     @erppreflight/web:build:  ✓ Compiled successfully in 2.9s
     @erppreflight/web:build:    Linting and checking validity of types ...
     @erppreflight/web:build:    Collecting page data ...
     @erppreflight/web:build:  ✓ Generating static pages (6/6)
     @erppreflight/web:build:    Finalizing page optimization ...
     @erppreflight/web:build:    Collecting build traces ...
      Tasks:    7 successful, 7 total
     Cached:    0 cached, 7 total
       Time:    19.357s
     ```
   - Exit code: `0` (Zero build failures).

3. **Dependency & Package Alignment Verification**:
   - `pnpm run check:deps` passed with exit code `0` (100% compliant with No-Dependency-Soup standard).
   - `pnpm install --frozen-lockfile` completed with exit code `0` (`Lockfile is up to date, resolution step is skipped`).
   - `pnpm ls -r` confirmed zero package version mismatches:
     - `typescript`: 5.9.3 across all packages.
     - `@types/node`: 22.20.4 across all packages.
     - `zod`: 3.25.76 identical across `@erppreflight/schemas`, `@erppreflight/evidence`, `@erppreflight/api`, and `@erppreflight/web`.
     - `rimraf`: 6.1.3 across all packages.
   - `pnpm test` (vitest): 15 test files passed, 335 passed (100% pass rate).
   - `pnpm run test:python`: 251 passed, 17 xfailed (100% pass rate).

---

### 1.2 EMPIRICAL BUG 1: Double Body Stream Consumption Crash on Non-JSON Errors (CRITICAL)

- **Target File**: `H:/erppreflight/apps/web/src/lib/api/custom-instance.ts`
- **Lines**: 162–170
- **Existing Implementation**:
  ```typescript
  162:   if (!response.ok) {
  163:     let errorData: ApiErrorResponse | string;
  164:     try {
  165:       errorData = await response.json();
  166:     } catch {
  167:       errorData = await response.text();
  168:     }
  169:     throw new ApiError(response.status, errorData);
  170:   }
  ```
- **Empirical Test**: Executed `reproduce_stream_bug.mjs` against a standard non-JSON error (e.g., HTTP 502 Bad Gateway HTML from Coolify/Nginx/Traefik reverse proxy or 504 Gateway Timeout):
  - Command:
    ```powershell
    node --experimental-strip-types H:/erppreflight/.agents/challenger_m2_2/reproduce_stream_bug.mjs
    ```
  - Verbatim Output:
    ```
    --- REPRODUCING FETCH STREAM CONSUMPTION BUG ---
    Caught error name: TypeError
    Caught error message: Body is unusable: Body has already been read
    Caught error constructor: TypeError
    Is ApiError?: false
    ```
- **Observation**:
  In accordance with the WHATWG Fetch specification, calling `await response.json()` consumes the underlying body stream. If the payload is HTML or plain text (e.g. 502 Bad Gateway), JSON parsing fails. The catch handler then attempts `await response.text()`, which immediately crashes with `TypeError: Body is unusable: Body has already been read`.
  As a direct result:
  1. `new ApiError(response.status, errorData)` is **never reached**.
  2. The caller receives an unhandled `TypeError` with **zero HTTP status code**, **zero correlationId**, and **zero error message**.
  3. UI Error Boundaries and retry policies cannot inspect `error.statusCode` (violating Cardinal Axiom 1: *"Error Boundaries & Resilience: Comprehensive error handling, including contextual error states, query retry policies, and user-actionable retry triggers"*).

---

### 1.3 EMPIRICAL BUG 2: Default `pnpm run codegen:api` Crashes and Destructively Deletes Generated Code (HIGH SEVERITY)

- **Target Files**:
  - `H:/erppreflight/orval.config.ts` (lines 7–8)
  - `H:/erppreflight/apps/web/orval.config.ts` (lines 7–8)
  - `H:/erppreflight/package.json` (line 15)
- **Lines in `orval.config.ts`**:
  ```typescript
  input: {
    target:
      process.env.OPENAPI_SPEC_URL ||
      './apps/api/openapi.json',
  },
  output: {
    clean: true,
    ...
  }
  ```
- **Empirical Execution**: Executed `pnpm run codegen:api` without manually defining `$env:OPENAPI_SPEC_URL`:
  - Command:
    ```powershell
    $env:PATH = "$env:APPDATA\npm;$env:PATH"
    pnpm run codegen:api
    ```
  - Verbatim Output:
    ```
    > erppreflight-monorepo@0.1.0 codegen:api H:\erppreflight
    > pnpm --filter @erppreflight/web codegen:api

    > @erppreflight/web@0.1.0 codegen:api H:\erppreflight\apps\web
    > orval

    🍻 orval v8.37.0 - A swagger client generator for typescript
    api - Cleaning output folder
    api - 🛑 ENOENT: no such file or directory, open 'H:\erppreflight\apps\api\openapi.json'
    🛑 One or more project failed, see above for details
    H:\erppreflight\apps\web:
     ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @erppreflight/web@0.1.0 codegen:api: `orval`
    Exit status 1
    ```
- **Observation**:
  1. Neither `H:/erppreflight/apps/api/openapi.json` nor `../../apps/api/openapi.json` exists in the repository.
  2. Worker `worker_m2_1` only tested codegen by passing `$env:OPENAPI_SPEC_URL = "H:/erppreflight/.agents/explorer_m2_orval_1/openapi-sample.json"`.
  3. However, `.agents/` is gitignored and prohibited from storing production code or assets (`AGENTS.md §2.2 Item 5`: *"The .agents/ directory is reserved strictly for agent coordination metadata... Source code, tests, and production assets must NEVER be placed inside .agents/"*).
  4. Crucially, because `clean: true` is configured in `orval.config.ts`, Orval wipes `apps/web/src/lib/api/generated/endpoints` and `models` **before** attempting to open the spec file. When it crashes with `ENOENT`, the generated code directory is left completely empty, destroying previous working state.

---

## 2. Logic Chain

1. **Compiler & Type System Health**:
   - `turbo run typecheck --force` ran 12 tasks across 7 packages and completed in 7.66s with 0 errors.
   - `turbo run build --force` ran 7 package builds, generated all static pages for Next.js App Router, and completed in 19.35s with 0 errors.
   - All monorepo dependencies are harmonized with zero peer or lockfile drift.
2. **Runtime Resilience Breakdown (Bug 1)**:
   - In production enterprise SaaS, reverse proxies (Coolify Traefik/Nginx, AWS ALB, Cloudflare) emit standard HTML error pages on gateway timeout, connection reset, or deployment restarts (HTTP 502/503/504).
   - In `custom-instance.ts`, `response.json()` consumes the stream. When `JSON.parse` fails on HTML, the stream is already drained and locked. The subsequent `response.text()` throws a fatal `TypeError`.
   - Contrast this with lines 178–187 of the same file, where successful responses correctly call `await response.text()` once and then use in-memory `JSON.parse(text)`. The error handler failed to follow the same pattern.
3. **Codegen Pipeline Fragility (Bug 2)**:
   - Orval is intended to run as a reliable development and CI script (`pnpm run codegen:api`).
   - Because `apps/api/openapi.json` was never exported to disk or checked into `apps/api/`, running `pnpm run codegen:api` fails 100% of the time on clean checkout.
   - Furthermore, `clean: true` in Orval causes data destruction on every failed invocation.
   - For codegen to be reproducible across CI and agent environments without depending on gitignored ephemeral agent scratch directories, `apps/api` must export a canonical `openapi.json` into `apps/api/openapi.json` (or provide an automated `pnpm --filter @erppreflight/api export:openapi` script).

---

## 3. Caveats

1. **Typecheck Masking**:
   - Because `apps/web` pages do not yet import from `src/lib/api/generated` (scheduled for Milestone 3 UI integration), `turbo run typecheck` passed even when `endpoints` and `models` were wiped out by the failed Orval run. Once frontend components import Orval hooks in Milestone 3, a failed Orval run will break the entire monorepo typecheck.
2. **No Mocking Rule**:
   - As per `AGENTS.md §4.1`, MSW mock generation is properly disabled (`mock: false`), ensuring production paths do not leak mock constants.

---

## 4. Conclusion

**Verdict: `REQUEST_CHANGES`**

While monorepo TypeScript compilation, production build, and dependency locks are completely green, two critical defects in the Orval and API integration layer must be remediated before Milestone 2 can be approved:

1. **Remediation 1 (CRITICAL)**: Fix response stream double-consumption in `apps/web/src/lib/api/custom-instance.ts` by reading `response.text()` once and parsing JSON safely in-memory:
   ```typescript
   if (!response.ok) {
     let errorData: ApiErrorResponse | string;
     const errorText = await response.text();
     try {
       errorData = JSON.parse(errorText);
     } catch {
       errorData = errorText;
     }
     throw new ApiError(response.status, errorData);
   }
   ```
2. **Remediation 2 (HIGH SEVERITY)**:
   - Provide the canonical OpenAPI spec at `H:/erppreflight/apps/api/openapi.json` (exported from NestJS Swagger) so that `pnpm run codegen:api` works out-of-the-box without requiring ephemeral `.agents/` env overrides.
   - Add `"export:openapi"` script to `apps/api/package.json` that regenerates `apps/api/openapi.json` deterministically.

---

## 5. Verification Method

### 5.1 Verification of Bug 1 Remediation (Stream Double-Consumption)
Run the empirical reproduction test:
```powershell
node --experimental-strip-types H:/erppreflight/.agents/challenger_m2_2/reproduce_stream_bug.mjs
```
- **Current Failure**: Throws `TypeError: Body is unusable: Body has already been read`, `Is ApiError?: false`.
- **Expected Success**: Must catch `ApiError` with `statusCode: 502`, `message: <html><body>502 Bad Gateway</body></html>`, and `Is ApiError?: true`.

### 5.2 Verification of Bug 2 Remediation (Out-of-the-box Codegen)
Execute root codegen without any environment variables:
```powershell
$env:PATH = "$env:APPDATA\npm;$env:PATH"
pnpm run codegen:api
```
- **Current Failure**: Exits with code 1 (`ENOENT: no such file or directory, open '.../apps/api/openapi.json'`).
- **Expected Success**: Exits with code 0 (`Your OpenAPI spec has been converted into ready to use orval!`) and populates `apps/web/src/lib/api/generated/endpoints` and `models`.

### 5.3 Monorepo Regression Gate
```powershell
$env:PATH = "$env:APPDATA\npm;$env:PATH"
pnpm exec turbo run typecheck --force
pnpm exec turbo run build --force
pnpm run check:deps
```
- **Expected Result**: All commands exit with code 0.
