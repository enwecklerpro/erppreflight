# Empirical Challenge Report — Milestone 2 Remediation Verification

**Agent**: `challenger_m2_rem_1` (teamwork_preview_challenger)  
**Date**: 2026-09-24  
**Working Directory**: `H:/erppreflight/.agents/challenger_m2_rem_1`  
**Verdict**: **APPROVE**  
**Overall Risk Assessment**: **LOW**

---

## 1. Observation

Direct, empirical observations recorded across all four mandated test targets:

### Item 1: `customInstance` 502 HTML & Stream Double-Consumption Handling
- **Implementation File**: `apps/web/src/lib/api/custom-instance.ts` (lines 162–171)
```typescript
162:   if (!response.ok) {
163:     const text = await response.text();
164:     let errorData: ApiErrorResponse | string;
165:     try {
166:       errorData = text ? (JSON.parse(text) as ApiErrorResponse) : `HTTP ${response.status}`;
167:     } catch {
168:       errorData = text || `HTTP ${response.status}`;
169:     }
170:     throw new ApiError(response.status, errorData);
171:   }
```
- **Empirical Execution**: Executed in-memory test suite via Node.js v22.20.0 native ESM engine (`node --experimental-strip-types --input-type=module`).
- **Assertion Results**:
  - `PASS [1]`: 502 HTML response throws `ApiError` instance (`err instanceof ApiError === true`).
  - `PASS [2]`: `err.statusCode === 502`.
  - `PASS [3]`: No stream double-consumption error occurs (`!err.message.includes("stream") && !err.message.includes("already read")`).
  - `PASS [4]`: 502 HTML raw content captured in `err.message`.
  - `PASS [5]`: `rawResponse.bodyUsed === true` (read exactly once).
  - `PASS [6]`: Strict `ReadableStream` locking test confirms `ApiError` is thrown, NOT a `TypeError: Body has already been consumed`.
  - `PASS [7]`: Strict `ReadableStream` statusCode is 502.
  - `PASS [8]`: Strict `ReadableStream` consumed exactly once (`responseWithStream.bodyUsed === true`).
  - `PASS [9-13]`: Structured NestJS JSON error (500) correctly extracts `statusCode`, `message`, `correlationId`, `path`, and `timestamp`.
  - `PASS [14-15]`: 400 Bad Request validation array correctly joined into message and stored in `details`.
  - `PASS [16-17]`: 503 empty response gracefully falls back to `HTTP 503`.
  - `PASS [18]`: HTTP 204 No Content returns `undefined`.
  - `PASS [19]`: HTTP 200 empty body returns `undefined`.
  - `PASS [20]`: HTTP 200 JSON payload parsed correctly.
  - `PASS [21]`: HTTP 200 plain text returns raw text.
  - `PASS [22-24]`: `resolveApiUrl` strips duplicate `/api/v1` prefixes and preserves external absolute URLs.
  - **Stress Test**: 50 concurrent 502 HTML requests all succeeded and threw `ApiError` with status 502 simultaneously; `AbortSignal` cancellation forwarded properly; malformed JSON error payload gracefully fell back without uncaught exception.
  - Total: 28/28 checks passed (100%).

### Item 2: `pnpm run codegen:api` Out-of-the-Box Execution
- **Command**: `pnpm run codegen:api` (invoking `pnpm --filter @erppreflight/web codegen:api` -> `orval`)
- **OpenAPI Spec Source**: `H:/erppreflight/apps/api/openapi.json`
- **Configuration**: `H:/erppreflight/apps/web/orval.config.ts` targeting `../../apps/api/openapi.json`
- **Output**:
```text
> @erppreflight/web@0.1.0 codegen:api H:\erppreflight\apps\web
> orval

🍻 orval v8.37.0 - A swagger client generator for typescript
api - 🎉 ERP Preflight Core API - Your OpenAPI spec has been converted into ready to use orval!
```
- **Exit Code**: 0 (0 warnings, 0 missing file errors).
- Generated endpoints in `apps/web/src/lib/api/generated/endpoints/` properly bind to mutator `customInstance` in `apps/web/src/lib/api/custom-instance.ts`.

### Item 3: `pnpm run check:deps` (11 Forbidden Categories)
- **Command**: `pnpm run check:deps` (`node scripts/check-no-dependency-soup.mjs`)
- **Scope Scanned**: 8 `package.json` files and 134 source files across monorepo (`apps/` and `packages/`).
- **Matrix Output**:
```text
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
- **Exit Code**: 0 (0 violations).

### Item 4: `pnpm exec turbo run typecheck`
- **Command**: `pnpm exec turbo run typecheck --force`
- **Scope**: 7 packages (`@erppreflight/api`, `@erppreflight/auth`, `@erppreflight/database`, `@erppreflight/evidence`, `@erppreflight/schemas`, `@erppreflight/tenancy`, `@erppreflight/web`)
- **Output**:
```text
 Tasks:    12 successful, 12 total
Cached:    0 cached, 12 total
  Time:    7.197s 
```
- **Exit Code**: 0 (0 TypeScript errors across the entire codebase).

### Ancillary Verifications
- **Monorepo Build**: `pnpm run build -- --force` -> 7 successful, 0 errors. Next.js 15 App Router compiled all 6 routes in 1063ms; NestJS API compiled cleanly.
- **Monorepo Linting**: `pnpm run lint` -> 0 errors.
- **TypeScript API Tests**: `pnpm test` -> 16 test suites, 366 tests passed in `@erppreflight/api`.
- **Python Engine Tests**: `pnpm run test:python` -> 251 tests passed, 17 xfailed (100% pass rate).

---

## 2. Logic Chain

1. **Premise**: In standard WHATWG `fetch` implementations (including Node.js undici and modern browsers), a `Response` body is backed by a `ReadableStream`. Reading a stream via `response.json()` locks and consumes the stream (`bodyUsed = true`). If parsing fails (such as when an upstream gateway returns `502 Bad Gateway` as an HTML document) and the code attempts a fallback `response.text()` on the same un-cloned `Response`, runtime engines throw `TypeError: Body has already been consumed` or `TypeError: Response body object should not be disturbed or locked`.
2. **Observation Reference**: In `apps/web/src/lib/api/custom-instance.ts` line 163, `customInstance` reads `const text = await response.text()` *first*. It performs `JSON.parse(text)` in memory within a `try/catch` block. If parsing succeeds, `errorData` is the typed JSON; if parsing throws a `SyntaxError`, the catch block assigns `errorData = text || HTTP ${response.status}`.
3. **Inference**: Because the body stream is read exactly once as text and subsequent parsing operates purely on the in-memory string variable, `response.body` is never consumed twice, and no stream disturbance can ever occur regardless of whether the response is valid JSON, malformed JSON, HTML, or empty.
4. **Empirical Verification**: Feeding a native `ReadableStream` configured to throw on secondary reads or disturbance confirmed that `customInstance` throws `ApiError` with `statusCode: 502` and does not throw any stream-related errors.
5. **Tooling Invariants**:
   - `codegen:api` relies on `apps/api/openapi.json`. The file is present, schema-compliant, and Orval generates all query/mutation hooks successfully out-of-the-box.
   - `check:deps` audits all 11 architectural categories against 8 packages and 134 source files, proving adherence to Part 21 and AGENTS.md §4.2.
   - `turbo run typecheck --force` compiles all 7 packages under TypeScript strict mode with 0 errors.

---

## 3. Caveats

- Node environment: Under Windows PowerShell, `pnpm` is located in `C:\Users\SKAF\AppData\Roaming\npm`, which requires PATH inclusion in non-interactive shells. This is an environment configuration detail, not a code defect.
- No other caveats. All four deliverables were empirically tested and confirmed.

---

## 4. Conclusion

All four Milestone 2 remediation deliverables satisfy their specification contracts completely:
1. `customInstance` handles 502 HTML responses cleanly, throws `ApiError` with status 502, and exhibits zero stream double-consumption defects under normal and high-concurrency loads.
2. `pnpm run codegen:api` runs out-of-the-box with 0 errors.
3. `pnpm run check:deps` verifies all 11 forbidden categories with 0 violations.
4. `pnpm exec turbo run typecheck` passes with 0 type errors across all packages.

**Final Verdict**: **APPROVE**.

---

## 5. Verification Method

To independently verify these results, execute the following commands in `H:/erppreflight`:

```powershell
# Ensure pnpm is on PATH
$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;C:\Users\SKAF\AppData\Local\pnpm;$env:PATH"

# 1. Dependency compliance check (11 categories)
pnpm run check:deps

# 2. Out-of-the-box Orval code generation
pnpm run codegen:api

# 3. Typecheck across all 7 packages
pnpm exec turbo run typecheck --force

# 4. Monorepo clean build
pnpm run build -- --force

# 5. Full test suites
pnpm test
pnpm run test:python
```
