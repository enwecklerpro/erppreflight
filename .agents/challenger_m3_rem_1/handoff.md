# Adversarial Challenge & Stress-Test Report: Milestone 3 Remediations

**Author**: `challenger_m3_rem_1` (Empirical Challenger)  
**Target Milestone**: Milestone 3 Remediation Verification (DataTable, Virtualization, URL State, Export, Batch Queue)  
**Evaluated Components**:
- `apps/web/src/lib/export.ts` & `apps/web/src/components/data-table/export.ts`
- `apps/web/src/hooks/useTableUrlSync.ts`
- `apps/web/src/components/data-table/data-table.tsx`
- `apps/web/src/hooks/pacer/useBatchQueue.ts`

**Verdict**: **APPROVE**  
**Overall Risk Assessment**: **LOW** (All 6 previous vulnerabilities successfully resolved and hardened)

---

## 1. Observation

Direct empirical observations from codebase inspection, empirical stress-test execution, and repository quality gate runs:

### 1.1 CSV Formula Injection & Header Escaping (`apps/web/src/lib/export.ts`)
- In lines 17–19 of `apps/web/src/lib/export.ts`:
  ```typescript
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  ```
- In lines 64 and 142:
  ```typescript
  fileContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rowsContent].join('\r\n');
  ```
- **Empirical Execution** (`.agents/challenger_m3_rem_1/test_stress_export.mjs`):
  - Executed against required formula injection vectors:
    - `=1+1` -> `'=1+1` (neutralized)
    - `=cmd|'/C calc'!A0` -> `'=cmd|'/C calc'!A0` (neutralized)
    - `@SUM(A1:A10)` -> `'@SUM(A1:A10)` (neutralized)
    - `+12345` -> `'+12345` (neutralized)
    - `-5+2` -> `'-5+2` (neutralized)
    - `\t=cmd` -> `'\t=cmd` (neutralized)
    - `\r=cmd` -> `"'\\r=cmd"` (RFC 4180 double-quoted, single quote prepended)
  - Adversarial formula vectors (`=HYPERLINK(...)`, `+A1+B1`, `-A1*B1`, `@AVERAGE(...)`, `=2+5*cmd|...`) were all neutralized.
  - CSV header with commas (`'Rule, Category'`) was quoted as `'"Rule, Category"'`.
  - CSV header with quotes (`'SAP Object "Type"'`) was escaped as `'"SAP Object ""Type"""'`.
  - CSV header with formula prefix (`'=FormulaHeader'`) was neutralized as `"'=FormulaHeader"`.
  - Joining escaped headers prevented column shifting and maintained 1:1 column alignment with row cells across all rows.
  - 30 out of 30 tests passed with 100% success rate.

### 1.2 URL Query Parameter Parsing & Clamping (`apps/web/src/hooks/useTableUrlSync.ts`)
- In lines 28–37 of `apps/web/src/hooks/useTableUrlSync.ts`:
  ```typescript
  const parsedPage = parseInt(searchParams.get('page') || '1', 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const parsedPageSize = parseInt(
    searchParams.get('pageSize') || String(defaultPageSize),
    10
  );
  const pageSize = Number.isFinite(parsedPageSize)
    ? Math.min(500, Math.max(10, parsedPageSize))
    : defaultPageSize;
  ```
- In lines 54–57:
  ```typescript
  const parts = value.split(',').filter(Boolean);
  if (parts.length > 0) {
    filters[key] = filters[key] ? [...filters[key], ...parts] : parts;
  }
  ```
- **Empirical Execution** (`.agents/challenger_m3_rem_1/test_stress_url_sync.mjs`):
  - `?page=NaN` -> sanitized to `page: 1`, `pagination.pageIndex: 0`.
  - `?page=invalid` -> sanitized to `page: 1`, `pagination.pageIndex: 0`.
  - `?page=-5` -> sanitized to `page: 1`, `pagination.pageIndex: 0`.
  - `?page=0` -> sanitized to `page: 1`, `pagination.pageIndex: 0`.
  - `?pageSize=NaN` -> sanitized to `defaultPageSize: 50`.
  - `?pageSize=invalid` -> sanitized to `defaultPageSize: 50`.
  - `?pageSize=-100` -> clamped to min `10`.
  - `?pageSize=0` -> clamped to min `10`.
  - `?pageSize=999999` -> clamped to max `500`.
  - `?pageSize=250` -> preserved at `250`.
  - `?status=,,,,` -> `parts.length === 0`; no entry registered in `filters`, `columnFilters` is `[]`.
  - `?status=` -> no entry registered in `filters`, `columnFilters` is `[]`.
  - `?status=,,OPEN,,CLOSED,,` -> filters out empty tokens and keeps `['OPEN', 'CLOSED']`.
  - Simulated TanStack Table pagination slice with `?page=NaN` correctly sliced `data.slice(0, 50)`, rendering all 50 expected rows without grid blanking.
  - 17 out of 17 tests passed with 100% success rate.

### 1.3 Virtualizer Dynamic Height Cache Coherence (`apps/web/src/components/data-table/data-table.tsx`)
- In lines 105–114 of `apps/web/src/components/data-table/data-table.tsx`:
  ```tsx
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: estimateRowHeight,
    getItemKey: React.useCallback(
      (index: number) => rows[index]?.id ?? index,
      [rows]
    ),
    overscan,
  });
  ```
- **Empirical Execution** (`.agents/challenger_m3_rem_1/test_stress_virtualizer.mjs`):
  - Tested `@tanstack/react-virtual` `Virtualizer` with both unkeyed and keyed configurations:
    - **Without `getItemKey` (reproduced defect)**: expanding row 'c' to 250px and reverse-sorting `[c, b, a]` caused index 0 (row 'c') to receive 50px and index 2 (row 'a') to receive 250px (swapped sizes, blank gap on collapsed row, clipped expanded row).
    - **With `getItemKey: (i) => rows[i]?.id ?? i` (worker fix)**: expanding row 'c' to 250px and reverse-sorting `[c, b, a]` preserved 250px on row 'c' at index 0, 50px on row 'b' at index 1, and 50px on row 'a' at index 2.
    - Filtering rows to keep only `[c, d]` preserved 300px on row 'c' at index 0 and 50px on row 'd' at index 1.
  - 8 out of 8 tests passed with 100% success rate.

### 1.4 Keyboard Navigation Across Compound `<tbody>` Elements (`apps/web/src/components/data-table/data-table.tsx`)
- In lines 124–176 of `apps/web/src/components/data-table/data-table.tsx`:
  - In virtualized mode (`enableVirtualization = true`), `handleKeyDown` walks `currentTbody.nextElementSibling` / `previousElementSibling` using `tbody.querySelector<HTMLElement>('tr[tabindex="0"]')`.
  - Non-focusable rows (expanded finding details `<tr>` without `tabindex="0"`) and padding rows (padding-top and padding-bottom `<tbody>` without `tr[tabindex="0"]`) are skipped.
- **Empirical Execution** (`.agents/challenger_m3_rem_1/test_stress_keyboard_nav.mjs`):
  - Navigating with `ArrowDown` moved focus from row-0 (`tbody_0`) to row-1 (`tbody_1`).
  - Navigating with `ArrowDown` from row-1 (`tbody_1`) skipped the non-indexed expanded details `<tr>` and focused row-2 (`tbody_2`).
  - Navigating with `ArrowDown` at the bottom edge cleanly handled the padding-bottom `<tbody>` and preserved focus on row-2 without throwing errors or losing focus.
  - Navigating with `ArrowUp` moved focus from row-2 to row-1, and from row-1 to row-0.
  - Navigating with `ArrowUp` at the top edge cleanly handled the padding-top `<tbody>` and preserved focus on row-0.
  - Non-virtualized mode navigation similarly moved between focusable rows and skipped expanded rows.
  - 10 out of 10 tests passed with 100% success rate.

### 1.5 Batch Input Parser Runtime Robustness (`apps/web/src/hooks/pacer/useBatchQueue.ts`)
- In line 113:
  ```typescript
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return [];
  ```
- **Empirical Execution** (`.agents/challenger_m3_rem_1/test_stress_batch_queue.mjs`):
  - Tested with `null`, `undefined`, `123`, `0`, `true`, `false`, `{}`, `[]`, `Symbol()`, and functions: all returned `[]` cleanly without throwing `TypeError`.
  - Mixed delimiters (`MARA, MARC; MARD \n VBAK\r\nVBAP\tLIKP`), uppercase normalization, and deduplication executed cleanly.
  - 15 out of 15 tests passed with 100% success rate.

### 1.6 Verification Quality Gates
All required quality gate commands were executed directly from the repository root:
1. `node scripts/check-no-dependency-soup.mjs`: Exit code 0 (100% compliant, 0 prohibited duplicate libraries).
2. `npx pnpm --filter @erppreflight/web typecheck`: Exit code 0 (0 TypeScript errors under strict mode).
3. `npx pnpm test`: Exit code 0 (8 packages in scope, 8 successful, 17 test suites, 394 automated tests passed).
4. `py -m pytest services/analysis-python/tests -q`: Exit code 0 (337 tests passed in 0.37s).

---

## 2. Logic Chain

1. **Security Vulnerability Remediated (CWE-1236 CSV Formula Injection)**:
   - Observation 1.1 confirms that any cell value starting with `=, +, -, @, \t, \r` has a single quote `'` prepended prior to RFC 4180 escaping.
   - When opened in Microsoft Excel or LibreOffice Calc, the single quote instructs the spreadsheet parser to treat the cell strictly as literal text, preventing formula evaluation, DDE command execution, and hyperlink exfiltration.
   - Escaping column headers via `headers.map(escapeCsvCell).join(',')` ensures headers with commas, quotes, or formula characters do not shift or desynchronize CSV columns.

2. **Functional Resilience Confirmed (URL Parameter Parsing & Pagination)**:
   - Observation 1.2 confirms that `Number.isFinite(...)` prevents `NaN` from contaminating `state.page` and `state.pageSize`.
   - Defaulting `page` to 1 and clamping `pageSize` between 10 and 500 prevents `data.slice(NaN, NaN) -> []` grid blanking and guards against unbounded memory allocation attacks.
   - Filtering out empty tokens and checking `parts.length > 0` ensures `?status=,,,,` does not generate `[{ id: 'status', value: [] }]`, eliminating the bug where empty query parameters wiped all rows from display.

3. **Virtualization Dynamic Height Cache Coherence Confirmed**:
   - Observation 1.3 directly proved that omitting `getItemKey` caused height cache swapping upon table re-sort.
   - Supplying `getItemKey: React.useCallback((index) => rows[index]?.id ?? index, [rows])` binds dynamic height measurements to the persistent row identifier, ensuring that expanded rows retain their expanded height and collapsed rows retain their compact height across all sorting and filtering operations.

4. **Accessibility (WCAG 2.2 AA) Keyboard Traversal Confirmed**:
   - Observation 1.4 confirms that compound `<tbody>` rows can be traversed seamlessly using `ArrowDown` and `ArrowUp`.
   - The query selector specifically targets `tr[tabindex="0"]`, preventing focus from being captured by unindexed expanded details rows or virtualizer padding rows.

---

## 3. Caveats

- "No caveats." All 6 failure modes previously identified in `challenger_m3_1/handoff.md` were re-tested with rigorous empirical test scripts and confirmed resolved. No new regressions were introduced into the codebase.

---

## 4. Conclusion

**VERDICT: APPROVE**

Worker `worker_m3_2` has completely, defensively, and cleanly resolved all 6 defects:
1. CSV Formula Injection is neutralized (`'`) and RFC 4180 compliant.
2. CSV headers are escaped, preventing column misalignment.
3. URL `NaN` parameters are sanitized, defaulting safely to valid integers, and `pageSize` is clamped to `[10, 500]`.
4. Empty filter query strings (`?status=,,,,`) do not register empty filter arrays and do not wipe table rows.
5. Virtualizer dynamic height caching is keyed by `row.id`, maintaining stable row heights across sort and filter operations.
6. Keyboard navigation traverses compound `<tbody>` elements smoothly, respecting focusable row boundaries.
7. Batch input parsing defensively handles non-string arguments without throwing runtime errors.

All automated monorepo quality gates (`check-no-dependency-soup.mjs`, web `typecheck`, and `pnpm test`) pass cleanly with 100% success rate. Milestone 3 is ready for integration.

---

## 5. Verification Method

To independently verify these findings, run the following commands from repository root (`H:/erppreflight`):

```bash
# 1. Run empirical challenger test suites:
node --experimental-strip-types .agents/challenger_m3_rem_1/test_stress_export.mjs
node .agents/challenger_m3_rem_1/test_stress_url_sync.mjs
node .agents/challenger_m3_rem_1/test_stress_virtualizer.mjs
node .agents/challenger_m3_rem_1/test_stress_keyboard_nav.mjs
node --experimental-strip-types .agents/challenger_m3_rem_1/test_stress_batch_queue.mjs

# 2. Run repository quality gates:
node scripts/check-no-dependency-soup.mjs
npx pnpm --filter @erppreflight/web typecheck
npx pnpm test
py -m pytest services/analysis-python/tests -q
```

### Invalidation Conditions
- If any formula starting with `[=+\-@\t\r]` is emitted without a prepended `'`, CSV formula injection protection is invalid.
- If `?page=NaN` or `?pageSize=NaN` causes `data.slice` to return `[]`, URL parameter sanitization is invalid.
- If sorting an expanded virtualized table assigns the expanded height to a collapsed row, virtualizer keying is invalid.
