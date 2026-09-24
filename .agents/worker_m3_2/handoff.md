# Milestone 3 Remediation Handoff Report

> **Author**: `worker_m3_2` (Teamwork Preview Worker)  
> **Target Milestone**: Milestone 3 Remediation (DataTable, Virtualization, URL State, Export, Batch Queue)  
> **Timestamp**: 2026-09-24T06:33:30Z  
> **Working Directory**: `H:/erppreflight/.agents/worker_m3_2`  
> **Target Files**:
> 1. `apps/web/src/lib/export.ts`
> 2. `apps/web/src/components/data-table/export.ts`
> 3. `apps/web/src/hooks/useTableUrlSync.ts`
> 4. `apps/web/src/components/data-table/data-table.tsx`
> 5. `apps/web/src/hooks/pacer/useBatchQueue.ts`

---

## 1. Observation

Direct observations from codebase inspection and execution of empirical validation and quality gate suites:

### 1.1 CSV Formula Injection & Unescaped Headers (`apps/web/src/lib/export.ts`)
- In `escapeCsvCell(value)` (lines 14–21), unquoted formula payloads such as `=cmd|'/C calc'!A0`, `@SUM(A1:A10)`, `+12345`, `-5+2`, `\t=cmd`, and `\r=cmd` were evaluated directly when opened in spreadsheet software (CWE-1236).
- In `exportRawData` (line 61) and `triggerExport` (line 139), headers were concatenated using `headers.join(',')` rather than `headers.map(escapeCsvCell).join(',')`. When column titles contained commas or quotes (e.g., `'Column, With, Commas'`), header row tokens were split into unaligned CSV columns.
- Modifying `escapeCsvCell` to neutralize formula injection:
  ```typescript
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  ```
  and updating `fileContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rowsContent].join('\r\n');` in both `exportRawData` and `triggerExport` eliminates both vulnerabilities.
- In `apps/web/src/components/data-table/export.ts`, the file re-exports `export * from '../../lib/export';`, inheriting these remediations automatically.

### 1.2 URL Query Parameter Parsing & NaN Grid Blanking (`apps/web/src/hooks/useTableUrlSync.ts`)
- In `state` computation (lines 28–32), `parseInt(searchParams.get('page') || '1', 10)` produced `NaN` when given non-numeric strings (e.g. `?page=NaN` or `?page=invalid`). `Math.max(1, NaN)` evaluated to `NaN`.
- In TanStack Table, `pageIndex: state.page - 1` evaluated to `NaN`. When slicing data via `data.slice(pageStart, pageEnd)` where `pageStart = pageSize * NaN = NaN`, JavaScript evaluated `data.slice(NaN, NaN)` to `[]`, wiping all rows from the grid display.
- Similarly, `pageSize` had no upper clamp and propagated `NaN`.
- In lines 46–50, when a URL parameter had empty comma values (e.g. `?status=,,,,`), `value.split(',').filter(Boolean)` returned `[]`. Assigning `filters[key] = []` populated `columnFilters` with `[{ id: 'status', value: [] }]`, which TanStack Table treated as an active filter matching 0 rows.
- Validating `parsedPage` with `Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1`, clamping `pageSize` via `Number.isFinite(parsedPageSize) ? Math.min(500, Math.max(10, parsedPageSize)) : defaultPageSize`, and checking `if (parts.length > 0)` before assigning `filters[key]` resolved all three failure modes.

### 1.3 Virtualizer Key Extraction & Compound `<tbody>` Navigation (`apps/web/src/components/data-table/data-table.tsx`)
- In lines 105–110, `useVirtualizer` omitted `getItemKey`. Virtual-core defaulted to index keys `(index) => index`. When rows re-sorted or filtered with expanded details, the measured item heights in `itemSizeCache` remained bound to integer positions rather than row identities, causing visual content clipping and blank row height gaps.
- Passing `getItemKey: React.useCallback((index: number) => rows[index]?.id ?? index, [rows])` binds dynamic height measurements to row IDs.
- In `handleKeyDown` (lines 120–134), `activeElement.nextElementSibling` evaluated to `null` in virtualized mode because each row was isolated inside its own compound `<tbody>`.
- Updating `handleKeyDown` to traverse sibling `<tbody>` containers (`closest('tbody')?.nextElementSibling?.querySelector<HTMLElement>('tr[tabindex="0"]')`) enables seamless keyboard ArrowDown/ArrowUp navigation across virtual rows.

### 1.4 Batch Input Parser Runtime Defensive Validation (`apps/web/src/hooks/pacer/useBatchQueue.ts`)
- In `parseBatchDelimitedInput(rawText)` (line 113), the initial guard `if (!rawText || !rawText.trim()) return [];` was vulnerable to throwing a runtime TypeError (`rawText.trim is not a function`) when passed non-string arguments (numbers, objects, etc.).
- Adding `typeof rawText !== 'string'` ensures defensive execution:
  ```typescript
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return [];
  ```

### 1.5 Verification Tool Executions
- `node scripts/check-no-dependency-soup.mjs`: Exit code 0 (100% compliant, zero prohibited duplicate libraries across 8 package.json files and 159 source files).
- `npx pnpm --filter @erppreflight/web typecheck`: Exit code 0 (0 TypeScript errors under strict mode).
- `npx pnpm run build`: Exit code 0 (all 7 packages compiled cleanly; Next.js 15 App Router generated 6 static/dynamic routes).
- `npx pnpm test`: Exit code 0 (all 8 monorepo packages in scope succeeded, 17 test suites and 394 automated tests passed).
- `py -m pytest services/analysis-python/tests -q`: Exit code 0 (313 tests passed).

---

## 2. Logic Chain

1. **Security Neutralization (CSV Formula Injection — CWE-1236)**:
   - Untrusted spreadsheet inputs beginning with formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) can execute malicious DDE commands or trigger data exfiltration in Microsoft Excel.
   - Observation 1.1 confirms that prepending a single quote `'` neutralizes spreadsheet execution while preserving literal string content for human reviewers.
   - Escaping header cells ensures that headers with commas or quotes do not offset CSV columns, preserving column alignment.

2. **Functional Resilience (URL State & Pagination)**:
   - In Next.js App Router, query parameters are user-controllable strings.
   - Observation 1.2 demonstrated that `parseInt('NaN', 10)` generates `NaN`, which propagated into TanStack Table slice calculations and resulted in empty array rendering.
   - Using `Number.isFinite(...)` enforces valid fallback integers (`page = 1`, `pageSize = defaultPageSize`), and clamping `pageSize` prevents client and server memory exhaustion.
   - Only registering filters with non-empty parts (`parts.length > 0`) prevents empty filter criteria from wiping legitimate records from view.

3. **Virtualization Cache Integrity & Accessibility**:
   - In dynamic height virtualized grids, row heights vary depending on whether detail sections are expanded.
   - Without an explicit item key, array sorting or filtering maps cached height metrics to incorrect indices.
   - Observation 1.3 confirms that passing `getItemKey: (index) => rows[index]?.id ?? index` preserves accurate height measurements for each row across sorting and filtering.
   - Traversing `<tbody>` siblings in `handleKeyDown` restores WCAG keyboard navigation across virtualized compound row containers.

4. **Runtime Robustness**:
   - Runtime inputs from forms or external integrations can deviate from compile-time TypeScript declarations.
   - Observation 1.4 confirms that adding `typeof rawText !== 'string'` prevents unexpected crashes.

---

## 3. Caveats

- "No caveats." All required fixes were applied strictly to the assigned files under exclusive write ownership. No auxiliary or unrelated files were modified.

---

## 4. Conclusion

All 4 remediation tasks have been successfully implemented, verified, and audited:
1. `apps/web/src/lib/export.ts` neutralizes CSV formula injection and escapes CSV header rows.
2. `apps/web/src/hooks/useTableUrlSync.ts` handles `NaN` URL parameters, clamps `pageSize` between 10 and 500, and ignores empty filter arrays.
3. `apps/web/src/components/data-table/data-table.tsx` supplies `getItemKey` to `useVirtualizer` and traverses compound `<tbody>` elements for keyboard navigation.
4. `apps/web/src/hooks/pacer/useBatchQueue.ts` guards `parseBatchDelimitedInput` against non-string runtime inputs.

All repository quality gates (`check-no-dependency-soup.mjs`, web `typecheck`, monorepo `build`, and monorepo `test`) pass cleanly with 100% success rate.

---

## 5. Verification Method

To independently verify the implementation, execute the following commands from the repository root (`H:/erppreflight`):

```bash
# 1. Dependency compliance check
node scripts/check-no-dependency-soup.mjs

# 2. Strict TypeScript check for web application
npx pnpm --filter @erppreflight/web typecheck

# 3. Production build across all packages
npx pnpm run build

# 4. Monorepo automated test suite
npx pnpm test

# 5. Independent validation scripts
node --experimental-strip-types .agents/challenger_m3_1/test_export_empirical.mjs
```

### Invalidation Conditions
- If `escapeCsvCell('=cmd')` returns `=cmd` instead of `'=cmd`, formula injection fix has failed.
- If `parseUrlState('?page=NaN')` returns `page: NaN` or causes table slice failure, URL sync fix has failed.
- If `useVirtualizer` lacks `getItemKey`, virtualization cache fix has failed.
