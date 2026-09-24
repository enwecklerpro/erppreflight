## 2026-09-24T05:22:31Z
You are auditor_m2_1, a teamwork_preview_auditor.
Your working directory is H:/erppreflight/.agents/auditor_m2_1.
You MUST follow the File Workspace Convention: write ONLY within your working directory.

MANDATORY FIRST STEP:
Read H:/erppreflight/.agents/ORIGINAL_REQUEST.md.

MISSION:
Perform a Forensic Integrity Audit on Milestone 2:
- Verify that packages in apps/web/package.json are genuinely installed and linked in pnpm-lock.yaml.
- Verify that custom-instance.ts, orval.config.ts, and check-no-dependency-soup.mjs are 100% genuine implementations, not stubs or mocks.
- Confirm 0 forbidden libraries exist anywhere in the repository.

OUTPUT:
Write your forensic audit report to H:/erppreflight/.agents/auditor_m2_1/handoff.md.
State your binary verdict: CLEAN or INTEGRITY VIOLATION.
Send message to parent when done.
