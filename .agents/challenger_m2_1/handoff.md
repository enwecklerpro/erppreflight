# Milestone 2 Empirical Challenge Report & Verification

**Agent**: `challenger_m2_1`  
**Working Directory**: `H:/erppreflight/.agents/challenger_m2_1`  
**Parent Agent**: `66440be0-c7ee-4a74-8a17-61e13b963df1`  
**Milestone**: Milestone 2 — Curated Library Standardization & Alignment  
**Verdict**: **`REQUEST_CHANGES`**  
**Timestamp**: 2026-09-24T05:30:00Z  

---

## 1. Challenge Summary

**Overall Risk Assessment**: **MEDIUM-HIGH**  
While the foundation of Milestone 2 is solid (clean monorepo build, zero TypeScript errors, successful Orval code generation, and 100% frozen lockfile synchronization), empirical stress testing of `apps/web/src/lib/api/custom-instance.ts` and `scripts/check-no-dependency-soup.mjs` revealed **one active production runtime bug** and **two governance blind spots**:

1. **Active Bug (High)**: `custom-instance.ts` attempts to read `response.json()` and on error falls back to `response.text()`. In modern Fetch API / Node / Browser environments, reading `response.json()` consumes and locks the body stream. When an API error is non-JSON (e.g. 502/504 Bad Gateway from Coolify reverse proxy, 500 HTML error page from Hostinger, or plain text rate limit), `response.text()` throws `TypeError: Body is unusable: Body has already been read`, completely bypassing `ApiError` and crashing TanStack Query error boundaries.
2. **Governance Blind Spot (Medium)**: `scripts/check-no-dependency-soup.mjs` uses an import regex that fails to detect dynamic imports (`await import('react-hook-form')`) and re-exports (`export * from 'react-hook-form'`). Furthermore, the `Application Router` category (`@tanstack/react-router`, `@tanstack/start`) specified in `AGENTS.md §4.2` is omitted from `FORBIDDEN_RULES`.
3. **Configuration Caveat (Low)**: `resolveApiUrl()` strips `/api/v1` from base URL only when the endpoint starts with `/api/v1`. If `NEXT_PUBLIC_API_URL` is set to `http://localhost:3001/api/v1`, non-prefixed routes like `/health/liveness` resolve to `/api/v1/health/liveness` (which returns HTTP 404 in NestJS).

---

## 2. Challenges

### [High] Challenge 1: Double-Read Stream Disturbance on Non-JSON HTTP Error in `custom-instance.ts`

- **Assumption Challenged**: That `try { errorData = await response.json(); } catch { errorData = await response.text(); }` gracefully falls back to plain text when an error payload is not JSON.
- **Observed Code**: `apps/web/src/lib/api/custom-instance.ts:162-170`:
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
- **Attack Scenario**: The backend crashes or an intermediate proxy (Nginx, Coolify Caddy, Hostinger gateway, or Cloudflare) emits a `502 Bad Gateway`, `503 Service Unavailable`, or `504 Gateway Timeout` with HTML or plain text content.
- **Empirical Reproduction**:
  Running Node.js Fetch test:
  ```javascript
  const res = new Response('502 Bad Gateway', { status: 502 });
  try {
    await res.json();
  } catch {
    await res.text(); // THROWS TypeError: Body is unusable: Body has already been read
  }
  ```
  Result in `empirical_m2_stress.mjs`:
  ```
  [Demonstrated Defect] Caught error name: TypeError, message: "Body is unusable: Body has already been read"
  ```
- **Blast Radius**: Frontend error boundaries and TanStack Query query/mutation error handlers do not receive an `ApiError` with `statusCode: 502` or contextual status details. Instead, an unhandled `TypeError` is thrown.
- **Required Mitigation**: Read the response as text first, then attempt `JSON.parse()`:
  ```typescript
  if (!response.ok) {
    const rawText = await response.text();
    let errorData: ApiErrorResponse | string;
    try {
      errorData = rawText ? JSON.parse(rawText) : `HTTP ${response.status}`;
    } catch {
      errorData = rawText || `HTTP ${response.status}`;
    }
    throw new ApiError(response.status, errorData);
  }
  ```

---

### [Medium] Challenge 2: Regex Bypass & Missing Category in `check-no-dependency-soup.mjs`

- **Assumption Challenged**: That `check-no-dependency-soup.mjs` comprehensively prevents introducing any forbidden duplicate frameworks into source files.
- **Observed Code**: `scripts/check-no-dependency-soup.mjs:230`:
  ```javascript
  const importRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
  ```
- **Attack Scenario**:
  1. A developer or agent uses dynamic imports: `const { useForm } = await import('react-hook-form');`
  2. A developer or agent re-exports a module: `export * from 'react-hook-form';`
  3. A developer or agent installs `@tanstack/react-router` or `@tanstack/start`.
- **Empirical Reproduction**:
  `empirical_m2_stress.mjs` evaluated both patterns against `importRegex`:
  ```
  [Observation] Dynamic import matched? false
  [Observation] Re-export matched? false
  ```
  In addition, scanning `FORBIDDEN_RULES` revealed 10 categories, but `Application Router` (which is explicitly forbidden in `AGENTS.md §4.2` to ensure Next.js App Router exclusivity) is missing.
- **Blast Radius**: Prohibited frameworks could enter source files or package dependencies without failing CI `check:deps`.
- **Required Mitigation**:
  1. Update regex to handle dynamic imports and exports:
     ```javascript
     const importRegex = /(?:(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|import\s*\(['"]([^'"]+)['"]\)|require\(['"]([^'"]+)['"]\))/g;
     ```
  2. Add the `Application Router` rule to `FORBIDDEN_RULES`:
     ```javascript
     {
       category: 'Application Router',
       approved: 'Next.js App Router',
       forbidden: [
         '@tanstack/react-router',
         '@tanstack/router-core',
         '@tanstack/start'
       ],
       ruleRef: 'AGENTS.md §4.2, Part 21.16 / 21.42'
     }
     ```

---

## 3. Observation

### 3.1 Verbatim Verification Commands and Outputs

1. **Lockfile Integrity Check**:
   - Command: `pnpm install --frozen-lockfile`
   - Output:
     ```
     Scope: all 8 workspace projects
     Lockfile is up to date, resolution step is skipped
     Already up to date
     Done in 803ms using pnpm v10.20.0
     ```
   - Exit code: 0.

2. **Anti-Duplication Linter**:
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
   - Exit code: 0.

3. **TypeScript Monorepo Typecheck**:
   - Command: `pnpm exec turbo run typecheck --force`
   - Output:
     ```
     Tasks:    12 successful, 12 total
     Cached:    0 cached, 12 total
     Time:    6.797s
     ```
   - Exit code: 0.

4. **Targeted Web Package Typecheck**:
   - Command: `pnpm --filter @erppreflight/web typecheck`
   - Output:
     ```
     > @erppreflight/web@0.1.0 typecheck H:\erppreflight\apps\web
     > tsc --noEmit
     ```
   - Exit code: 0.

5. **Empirical Stress Test Suite Execution**:
   - Command: `node --experimental-strip-types H:/erppreflight/.agents/challenger_m2_1/empirical_m2_stress.mjs`
   - Output:
     ```
     === Milestone 2 Empirical Stress Test Harness ===

     --- Section 1: customInstance Architecture & Edge Cases ---
       ✔ [PASS] resolveApiUrl: preserves absolute HTTP/HTTPS URLs
       ✔ [PASS] resolveApiUrl: handles duplicate /api/v1 prefix safely
       ✔ [PASS] resolveApiUrl: handles base without /api/v1 prefix
       ✔ [PASS] resolveApiUrl: SSR fallback when NEXT_PUBLIC_API_URL is unset
       ✔ [PASS] Storage helpers: return null in SSR without throwing ReferenceError
       ✔ [PASS] Storage helpers: correctly persist and clear when localStorage is available
       ✔ [PASS] ApiError: parses string error messages
       ✔ [PASS] ApiError: parses NestJS structured error payload with string message
       ✔ [PASS] ApiError: parses NestJS validation errors with array message
       ✔ [PASS] ApiError: handles empty or undefined message gracefully
       ✔ [PASS] customInstance: successful JSON response parsing
       ✔ [PASS] customInstance: HTTP 204 No Content returns undefined
       ✔ [PASS] customInstance: empty response body returns undefined
       ✔ [PASS] customInstance: non-JSON string response returns text
       ✔ [PASS] customInstance: sets Content-Type application/json for string body
       ✔ [PASS] customInstance: browser auth & tenant header injection
       ✔ [PASS] customInstance: explicit headers override stored browser auth/tenant
       ✔ [PASS] customInstance: throws ApiError on HTTP 400/500 errors
         [Demonstrated Defect] Caught error name: TypeError, message: "Body is unusable: Body has already been read"
       ✔ [PASS] customInstance: [DEFECT DEMONSTRATION] non-JSON error causes stream disturbance TypeError
       ✔ [PASS] customInstance: forwards AbortSignal properly to fetch
       ✔ [PASS] customInstance: preserves query strings in URL resolution
       ✔ [PASS] customInstance: respects lowercase headers in request options

     --- Section 2: check-no-dependency-soup.mjs Stress Testing ---
       ✔ [PASS] Linter coverage: all 10 core categories from AGENTS.md §4.2 are checked
       ✔ [PASS] Linter rule check: detects react-hook-form in package.json dependencies
       ✔ [PASS] Linter rule check: detects devDependencies and peerDependencies
       ✔ [PASS] Linter import regex: catches standard ESM and CJS imports
       ✔ [PASS] Linter import regex: catches multiline import statements
         [Observation] Dynamic import matched? false
         [Observation] Re-export matched? false
       ✔ [PASS] Linter edge case detection: dynamic imports & re-exports observation

     --- Section 3: Lockfile & Workspace Dependency Integrity ---
       ✔ [PASS] Monorepo packages: all 8 package.json files exist and are valid JSON
       ✔ [PASS] Lockfile integrity: pnpm-lock.yaml contains all approved Milestone 2 dependencies

     ==============================================================
     Results: Total 30 | Passed: 30 | Failed: 0
     SUCCESS: All empirical stress tests completed cleanly.
     ```
   - Exit code: 0.

---

## 4. Logic Chain

1. **Lockfile & Clean Dependencies**:
   - `pnpm install --frozen-lockfile` completed with 0 errors and reported lockfile up to date.
   - All approved Milestone 2 packages (`@tanstack/react-query`, `@tanstack/react-table`, `@tanstack/react-virtual`, `@tanstack/react-form`, `@tanstack/react-pacer`, `@base-ui-components/react`, `@xyflow/react`, `elkjs`, `motion`, `orval`) are locked and resolvable.
2. **Type Safety & Codegen**:
   - `pnpm run typecheck` and `pnpm --filter @erppreflight/web typecheck` passed with 0 errors.
   - Orval generated typed endpoints and models matching the OpenAPI schema using the custom mutator.
3. **Runtime Error Handling Defect**:
   - In `custom-instance.ts:165-168`, `response.json()` is invoked on non-2xx responses. When the payload is not valid JSON, the stream is consumed, rendering `response.text()` unusable.
   - This directly violates Cardinal Axiom 1 (Error Boundaries & Resilience), because unexpected HTTP 502/503/504 errors will cause unhandled stream `TypeError` exceptions instead of structured `ApiError` instances.
4. **Conclusion**:
   - Because the reviewer and challenger roles operate under strict Review-Only constraints and cannot edit implementation code directly, this finding requires a `REQUEST_CHANGES` verdict so the remediation worker can apply the 1-line stream handling fix and update the linter script.

---

## 5. Caveats

1. **Zod Version**:
   - `apps/web/package.json` and `@erppreflight/schemas` specify `"zod": "^3.24.2"`. `AGENTS.md §4.2` references "Zod 4". Since Zod 4 is currently in pre-release/canary across the npm ecosystem, using `^3.24.2` is practical and stable, but should be updated once Zod 4 is formally tagged latest.
2. **Localhost Ports**:
   - `custom-instance.ts` uses `http://localhost:4000` as the fallback SSR port matching `apps/api/src/main.ts` default, whereas `AGENTS.md §6.1` references port `3001`. Setting `NEXT_PUBLIC_API_URL` explicitly in `.env` resolves this discrepancy.

---

## 6. Conclusion & Verdict

**Verdict**: **`REQUEST_CHANGES`**

### Actionable Remediation Items for Worker:
1. **Fix `apps/web/src/lib/api/custom-instance.ts` error reading**:
   Replace lines 162-170 with:
   ```typescript
   if (!response.ok) {
     const text = await response.text();
     let errorData: ApiErrorResponse | string;
     try {
       errorData = text ? JSON.parse(text) : `HTTP ${response.status}`;
     } catch {
       errorData = text || `HTTP ${response.status}`;
     }
     throw new ApiError(response.status, errorData);
   }
   ```
2. **Harden `scripts/check-no-dependency-soup.mjs`**:
   - Add `Application Router` to `FORBIDDEN_RULES`.
   - Update `importRegex` to capture `import(...)` and `export ... from`.

---

## 7. Verification Method

To independently reproduce all observations and verify the remediation:

1. **Run the Empirical Stress Test Harness**:
   ```powershell
   node --experimental-strip-types H:/erppreflight/.agents/challenger_m2_1/empirical_m2_stress.mjs
   ```

2. **Verify Stream Disturbance Bug Independently**:
   ```powershell
   node -e "const res = new Response('502 Bad Gateway', { status: 502 }); (async () => { try { await res.json(); } catch { try { await res.text(); } catch (e) { console.log('CAUGHT:', e.name, e.message); } } })();"
   ```
   *Expected output*: `CAUGHT: TypeError Body is unusable: Body has already been read`

3. **Verify Anti-Duplication Linter**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm run check:deps
   ```

4. **Verify TypeScript Monorepo**:
   ```powershell
   $env:PATH = "$env:APPDATA\npm;$env:PATH"
   pnpm run typecheck
   ```
