## 2026-09-24T06:26:10Z
You are worker_m3_2, a teamwork_preview_worker.
Your working directory is H:/erppreflight/.agents/worker_m3_2.
You MUST follow the File Workspace Convention: write metadata only in your working directory. For target files, see Exclusive Write Ownership below.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
You own exclusively:
1. apps/web/src/lib/export.ts
2. apps/web/src/components/data-table/export.ts (if exists or references export logic)
3. apps/web/src/hooks/useTableUrlSync.ts
4. apps/web/src/components/data-table/data-table.tsx
5. apps/web/src/hooks/pacer/useBatchQueue.ts

INPUT BLUEPRINTS:
Read the exact vulnerability findings and code fixes in:
- H:/erppreflight/.agents/challenger_m3_1/handoff.md
- H:/erppreflight/.agents/reviewer_m3_1/handoff.md (Finding 1)

REMEDIATION TASKS:
1. apps/web/src/lib/export.ts (and components/data-table/export.ts):
   - In escapeCsvCell(value):
     Neutralize CSV Formula Injection (CWE-1236): if string begins with =, +, -, @, \t, or \r, prepend a single quote `'` before standard RFC 4180 quoting:
     if (/^[=+\-@\t\r]/.test(str)) { str = `'${str}`; }
   - In exportRawData and triggerExport:
     Escape header row values via headers.map(escapeCsvCell).join(',') instead of raw headers.join(',').
2. apps/web/src/hooks/useTableUrlSync.ts:
   - Handle NaN query params: validate parsedPage with Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : 1.
   - Validate parsedPageSize with Number.isFinite and clamp: Math.min(500, Math.max(10, parsedPageSize)).
   - Empty filter protection: only assign filters[key] if parts.length > 0 (do not populate empty [] when query param is e.g. ?status=,,,,).
3. apps/web/src/components/data-table/data-table.tsx:
   - In useVirtualizer: pass getItemKey: React.useCallback((index: number) => rows[index]?.id ?? index, [rows]) to eliminate measurement cache clobbering when sorting/filtering with expanded rows.
   - In handleKeyDown: support row navigation across compound <tbody> elements when enableVirtualization is true by traversing tbody siblings (closest('tbody')?.nextElementSibling?.querySelector('tr[tabindex="0"]')).
4. apps/web/src/hooks/pacer/useBatchQueue.ts:
   - In parseBatchDelimitedInput: add defensive runtime check if (!rawText || typeof rawText !== 'string' || !rawText.trim()) return [];.

VERIFICATION:
Run the following verification commands:
- node scripts/check-no-dependency-soup.mjs
- npx pnpm --filter @erppreflight/web typecheck
- npx pnpm run build
- npx pnpm test

Write your report to H:/erppreflight/.agents/worker_m3_2/handoff.md. Send a message to parent when done.
