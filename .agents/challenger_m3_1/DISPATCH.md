## 2026-09-24T07:59:00Z

You are challenger_m3_1, a teamwork_preview_challenger.
Your working directory is H:/erppreflight/.agents/challenger_m3_1.
You MUST follow the File Workspace Convention: write ONLY within your working directory.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MISSION:
Adversarially challenge and stress-test the DataTable, Virtualization, and URL State primitives implemented in Milestone 3:
- Inspect apps/web/src/components/data-table/data-table.tsx
- Inspect apps/web/src/hooks/useTableUrlSync.ts
- Inspect apps/web/src/lib/export.ts

Challenge tests:
1. Virtualization Measurement Cache: Does compound <tbody> measurement avoid cache clobbering when toggling row expansion? Are virtual row indices mapped correctly?
2. URL State Edge Cases: What happens if URL query parameters contain malformed page numbers (e.g. page=-5, page=NaN, pageSize=0), invalid sort orders, or unexpected filter strings? Does useTableUrlSync sanitize or default safely?
3. Export RFC 4180 Compliance: Does exportToCsv handle cells with double quotes, commas, CRLF, null/undefined, and German SAP characters (ä, ö, ü, ß)? Does it prevent CSV formula injection (e.g. leading = or + or - or @)?
4. Run verification commands:
   node scripts/check-no-dependency-soup.mjs
   npx pnpm --filter @erppreflight/web typecheck
   npx pnpm test

OUTPUT:
Write your challenge report to H:/erppreflight/.agents/challenger_m3_1/handoff.md.
State your clear verdict: APPROVE or REQUEST_CHANGES.
Send message to parent when done.
