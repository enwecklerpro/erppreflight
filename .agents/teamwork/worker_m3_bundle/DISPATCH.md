## 2026-09-25T03:31:34Z
You are worker_m3_bundle, an implementation subagent.
Your working directory is: H:/erppreflight/.agents/teamwork/worker_m3_bundle
Original request file: H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md
Project plan: H:/erppreflight/.agents/teamwork/orchestrator_2/PROJECT.md
Survey report: H:/erppreflight/.agents/teamwork/survey_explorer_3/survey_r3_r4_report.md
Survey handoff: H:/erppreflight/.agents/teamwork/survey_explorer_3/handoff.md
Engineering skills to follow:
- H:/erppreflight/.agents/skills/secure-file-parser.md
- H:/erppreflight/.agents/skills/sap-evidence.md
- H:/erppreflight/.agents/skills/frontend-design-system.md

Your task is to implement Milestone M3: Cryptographic Reproducibility Bundle Downloader (.zip) (R3):
1. Exclusively Owned Files:
   - apps/api/src/modules/analyses/analyses.controller.ts
   - apps/api/src/modules/analyses/analyses.service.ts (adding bundle generation method)
   - apps/web/src/app/projects/[id]/findings/page.tsx (adding Download Reproducibility Bundle button)
   - apps/web/src/app/inspector/page.tsx (adding Download Reproducibility Bundle button)

2. Key Deliverables:
   - Backend endpoint GET /api/v1/analyses/:id/reproducibility-bundle:
     - Implemented in AnalysesController and AnalysesService using 'archiver' (already in package.json).
     - Returns a signed ZIP stream (Content-Type: application/zip, Content-Disposition: attachment; filename="reproducibility-bundle-<analysisId>.zip").
     - The ZIP MUST contain 4 files:
       1) manifest.json: engine versions, rule bundle versions, knowledge snapshot ID (KNOW_SNAP_2026_09_24), target SAP release, analysis timestamp, SHA-256 bundle signature.
       2) normalized_hashes.json: SHA-256 hashes of original and sanitized input artifacts.
       3) findings_ledger.json: complete deterministic findings array with cryptographic evidence pointers (file, line, column, snippet, sha256, trust score).
       4) remediation_guide.md: technical markdown remediation steps tailored to the target release and findings.
     - Security: Apply SecretRedactorService.redact() to ensure zero customer secrets/passwords leak into the bundle.
   - Frontend Download Actions:
     - Add "Download Reproducibility Bundle (.zip)" action button in apps/web/src/app/projects/[id]/findings/page.tsx and apps/web/src/app/inspector/page.tsx with loading state and toast notification.
   - Verify: Add unit tests in apps/api/src/modules/analyses/ covering bundle generation and secret redaction. Run tests and typecheck.
