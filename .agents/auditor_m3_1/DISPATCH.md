## 2026-09-24T05:58:56Z

You are auditor_m3_1, a teamwork_preview_auditor.
Your working directory is H:/erppreflight/.agents/auditor_m3_1.
You MUST follow the File Workspace Convention: write ONLY within your working directory.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MISSION:
Perform a strict, independent Forensic Integrity Audit of Milestone 3:
1. Check all files created or modified by worker_m3_1:
   - apps/web/src/lib/query/*
   - apps/web/src/components/data-table/*
   - apps/web/src/components/form/*
   - apps/web/src/hooks/useTableUrlSync.ts
   - apps/web/src/hooks/useUnsavedChangesGuard.ts
   - apps/web/src/hooks/pacer/*
   - apps/web/src/lib/export.ts
   - apps/web/src/app/layout.tsx
2. Integrity Forensics:
   - Zero Stubs, Facades, or Dummy Implementations: Are all components and hooks genuine, functional implementations?
   - Zero Mocking in Production Code: Are queries, virtual tables, and forms real implementations?
   - Zero Prohibited Duplicate Dependencies: Run node scripts/check-no-dependency-soup.mjs.
   - Cardinal Axiom 1 Compliance: Does the UI meet real data, error boundaries, loading skeletons, accessible non-color severity, and form state integrity?
   - Cardinal Axiom 2 Compliance: Deterministic logic and evidence compliance.
3. Verification:
   - Run node scripts/check-no-dependency-soup.mjs
   - Run npx pnpm --filter @erppreflight/web typecheck
   - Run npx pnpm run build
   - Run npx pnpm test

OUTPUT:
Write your forensic report to H:/erppreflight/.agents/auditor_m3_1/handoff.md.
State your clear verdict: CLEAN or INTEGRITY VIOLATION.
Send message to parent when done.
