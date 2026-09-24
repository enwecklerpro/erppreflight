# Milestone 4 SAP Object Inventory & Virtualization Challenge Report

**Agent**: `challenger_m4_2`  
**Verdict**: **`REQUEST_CHANGES`**  
**Working Directory**: `H:/erppreflight/.agents/challenger_m4_2`  
**Date**: 2026-09-24T07:11:00Z  

---

## 1. Observation

### 1.1 Large Dataset Virtualization & Schema Conformance Benchmark
- **Test Command**: `node H:/erppreflight/.agents/challenger_m4_2/test-large-dataset-schema.mjs`
- **Output Metrics** (recorded in `H:/erppreflight/.agents/challenger_m4_2/schema-test-results.json`):
  - Total records generated: **10,000** objects (`generateMockSapObjects(10000)`) in **28.34 ms**.
  - Validation against `SapObjectSchema` (`packages/schemas/src/sap-object.ts:105`): **10,000 / 10,000 valid (100.00% pass rate, 0 invalid records)**.
  - Total parse/validation time: **67.09 ms**.
  - Average parse time per record: **0.0067 ms**.
  - Validation throughput: **149,050 objects/sec**.
  - Memory consumption:
    - Base heap used before generation: **27.14 MB**
    - Heap used after 10,000 object generation: **35.40 MB** (+8.26 MB)
    - Heap used after full validation: **47.20 MB** (Delta: **+20.06 MB**)
    - Process RSS: **115.00 MB**
  - Adversarial corruption checks (UUID invalidation, unknown object type, invalid enum tier, negative lines-of-code, invalid severity): **5/5 properly rejected** with Zod validation errors.

### 1.2 URL Synchronization & Hostile Input Resilience
- **Test Command**: `node H:/erppreflight/.agents/challenger_m4_2/test-url-sync-resilience.mjs`
- **Hostile Deserialization**: **11/11 test cases passed**:
  - Empty string query defaults to `page=1, pageSize=50`.
  - Negative `page=-99` and `pageSize=-500` safely clamped to `page=1, pageSize=10`.
  - Excessive `pageSize=100000000` clamped to max `500`.
  - `page=NaN` safely parsed to `1`.
  - Malformed `sort=objectType` without direction defaults safely to `asc`.
  - Malformed `sort=` with empty string results in `sortField=undefined`.
  - Dangling commas and empty values (`objectType=,,,&&cleanCoreTier=&package=Z_SALES_ORDER,,$TMP,`) correctly filtered into `['Z_SALES_ORDER', '$TMP']`.
  - Repeated query parameters (`?objectType=PROG&objectType=CLAS,TABL`) merged into `['PROG', 'CLAS', 'TABL']`.
  - XSS/SQLi payload strings parsed and preserved safely without runtime errors.
- **Serialization Cleanliness**: **4/4 test cases passed**:
  - Default values (`page=1`, `pageSize=50`) deleted from URL string to prevent cluttered query strings.
  - Emptied filters removed from URL.

### 1.3 Critical Defect: Modulus Domain Collapse in `generateMockSapObjects`
- **File**: `H:/erppreflight/apps/web/src/components/objects/types.ts`
- **Lines 51 & 62**:
  ```typescript
  51: const TIERS: CleanCoreTier[] = ['TIER_1_CLOUD', 'TIER_2_DEVELOPER', 'TIER_3_CLASSIC'];
  ...
  62: const tier = TIERS[(i * 3) % TIERS.length];
  ```
- **Observed Empirical Behavior**:
  - `TIERS.length` is `3`.
  - For any integer `i >= 1`, `(i * 3) % 3 === 0` identically.
  - Therefore, `tier` is evaluated as `TIERS[0]` (`'TIER_1_CLOUD'`) for **100% of generated objects**.
  - Execution check on 10,000 objects:
    ```
    Tier distribution over 10,000 objects: { TIER_1_CLOUD: 10000 }
    TIER_2_DEVELOPER: 0
    TIER_3_CLASSIC: 0
    Objects with blockers: 0
    Objects with dependencies: 0
    ```
  - **Cascading Defects in Lines 65, 98–101, and 113–126**:
    - Line 65: `const blockerCount = hasFindings && tier === 'TIER_3_CLASSIC' ? (i % 3) + 1 : 0;`  
      Because `tier === 'TIER_3_CLASSIC'` is never true, `blockerCount` is `0` across all 10,000 objects.
    - Lines 98–101: Rule `CLEAN_CORE_TIER3_DIRECT_DB_MUTATION` is never generated.
    - Lines 113–126: `dependencies` array is empty `[]` for 10,000 out of 10,000 objects.
    - `fetchProjectObjects` with `cleanCoreTier: ['TIER_3_CLASSIC']` returns `totalCount: 0`, directly contradicting the page header in `apps/web/src/app/projects/[id]/objects/page.tsx:146` ("Classic Modifications: 142 Tier 3 direct DB / SSCR keys").

### 1.4 No-Dependency-Soup Compliance
- **Test Command**: `node scripts/check-no-dependency-soup.mjs`
- **Output**:
  - Scanned 8 `package.json` files and 175 source files across monorepo.
  - Zero prohibited duplicate libraries found.
  - 100% compliant with standard.

### 1.5 Monorepo Build
- **Test Command**: `npx pnpm exec turbo run build --force`
- **Output**:
  - 7 packages in scope: `@erppreflight/api`, `@erppreflight/auth`, `@erppreflight/database`, `@erppreflight/evidence`, `@erppreflight/schemas`, `@erppreflight/tenancy`, `@erppreflight/web`.
  - All 7 packages compiled successfully from scratch with 0 cache hits.
  - Next.js 15.5.26 production build succeeded; route `/projects/[id]/objects` generated with First Load JS size 163 kB.
  - Total build time: **19.03s**, exit code `0`.

---

## 2. Logic Chain

1. **Axiom 1 & Axiom 2 Evaluation**:
   - Cardinal Axiom 1 requires that UI features function with real data/contracts, accessible indicators, and non-empty/functioning filter facets.
   - Cardinal Axiom 2 requires deterministic evidence and fixtures that represent actual enterprise domain models.
2. **Schema and Virtualization Capability**:
   - The memory and parse performance of `SapObjectSchema` easily handles 10,000 records in 67.09 ms with only 20.06 MB heap growth. The data grid virtualization architecture is sound.
3. **URL State Synchronization**:
   - `useTableUrlSync.ts` handles hostile, malformed, out-of-bounds, and injection inputs without crashing or corrupting state.
4. **Impact of Modulus Bug (`(i * 3) % 3`)**:
   - In `apps/web/src/components/objects/types.ts:62`, multiplying index `i` by the modulus `3` prior to taking `% 3` guarantees the remainder is 0 for all records.
   - This results in complete erasure of Tier 2 and Tier 3 data from the 10,000 object catalog.
   - When users click the "Tier 3: Classic Modification" faceted filter in the UI, the table displays 0 records, breaking user exploration of classic modifications and blockers.
   - Furthermore, all 10,000 objects have 0 dependencies and 0 blocker findings, rendering the Object Detail Drawer's dependency graph view and blocker badges empty.
5. **Deduction**:
   - Because the core mock dataset powering Milestone 4 is mathematically broken and disables two of the three Clean Core tiers, the implementation does not meet the Definition of Done. A simple 1-line formula fix is required.

---

## 3. Caveats

- End-to-end interactive Playwright tests inside a live Chromium browser were not run during this turn (headless Node verification used).
- In `apps/web/src/app/projects/[id]/objects/page.tsx:42`, the `queryKey` passes `urlState.filters.cleanCoreTier?.[0]` (indexing only the first selected item), while `fetchProjectObjects` receives the full array. If multi-select is enabled, this could lead to TanStack Query cache key collisions across different multi-selection combinations.

---

## 4. Conclusion

**Verdict: `REQUEST_CHANGES`**

The implementation is high quality, builds cleanly, strictly respects the No-Dependency-Soup standard, and exhibits excellent schema parsing performance (>140,000 objects/sec). However, it cannot be approved in its current state due to the modulus domain collapse in `generateMockSapObjects`:

### Required Remediation:
1. **Fix `apps/web/src/components/objects/types.ts:62`**:
   Change:
   ```typescript
   const tier = TIERS[(i * 3) % TIERS.length];
   ```
   To:
   ```typescript
   const tier = TIERS[i % TIERS.length];
   ```
   *(or `TIERS[(i + 1) % TIERS.length]` or a weighted distribution that produces a realistic 70% Tier 1, 20% Tier 2, 10% Tier 3 split)*.
2. Verify that `fetchProjectObjects({ filters: { cleanCoreTier: ['TIER_3_CLASSIC'] } })` returns > 0 items with blocker findings and non-empty `dependencies`.

---

## 5. Verification Method

To independently verify the observations and this finding:

1. **Run the 10,000-object schema and memory benchmark**:
   ```bash
   node H:/erppreflight/.agents/challenger_m4_2/test-large-dataset-schema.mjs
   ```
   Expected: 10,000 records validated in < 150 ms with 0 errors.

2. **Run empirical proof of the modulus defect**:
   ```bash
   node -e "const { generateMockSapObjects } = require('./apps/web/src/components/objects/types.ts'); const objs = generateMockSapObjects(100); console.log(new Set(objs.map(o => o.cleanCoreTier)));"
   ```
   Observed: `Set(1) { 'TIER_1_CLOUD' }` (Tier 2 and Tier 3 missing).

3. **Run URL resilience and filter execution test harness**:
   ```bash
   node H:/erppreflight/.agents/challenger_m4_2/test-url-sync-resilience.mjs
   ```
   Observed: 11/11 deserialization passed, 4/4 serialization passed, defect flagged for `TIER_3_CLASSIC`.

4. **Run dependency compliance audit**:
   ```bash
   node scripts/check-no-dependency-soup.mjs
   ```
   Observed: Zero violations across 8 packages and 175 files.

5. **Run monorepo clean build**:
   ```bash
   npx pnpm exec turbo run build --force
   ```
   Observed: 7/7 packages succeed.
