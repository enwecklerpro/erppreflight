# Milestone 2 Technical Exploration Handoff: Ingestion Security Pipeline & Storage

**Agent**: `m2_explorer_1` (Teamwork Explorer)  
**Parent Conversation ID**: `b18c0539-d6d7-4a41-968f-58324775ab38`  
**Working Directory**: `H:/erppreflight/.agents/m2_explorer_1`  
**Primary Deliverable**: `H:/erppreflight/.agents/m2_explorer_1/ingestion_plan.md`  
**Date**: 2026-09-24  

---

## 1. Observation

Direct observations from the ERP Preflight repository and specification documents:

1. **Mandatory Specifications & Requirements**:
   - `H:/erppreflight/.agents/ORIGINAL_REQUEST.md` (Line 35):
     > "Ingestion pipeline with file format validation (XML, JSON, CSV, ZIP, ABAP/text), quarantine scanning, and secret/credential redaction."
     > Line 36: "Signed, short-lived URLs for file storage and generated preflight audit reports (PDF/JSON/CSV)."
   - `H:/erppreflight/.agents/orchestrator_main/PROJECT.md` (Line 31):
     > "4. **Security & Ingestion Invariant**: Untrusted files enter quarantine, undergo magic-byte MIME validation, Zip bomb/slip checks, XXE protection, ClamAV scanning, and automatic credential/secret redaction before parser consumption."
     > Line 49-52: Feature 9 ("File Format & MIME Validation"), Feature 10 ("Archive Safety & Quarantine"), Feature 12 ("Pre-signed S3 Storage URLs").
     > Line 164: "Raw Upload -> Magic Byte Sniffer -> Archive Inspector (Zip bomb/slip checks) -> ClamAV Quarantine -> Regex & Shannon Entropy Secret Redactor -> Clean S3 Storage -> Redis Analysis Queue."
   - `H:/erppreflight/.agents/spec_miner_survey_2/platform_spec.md` (Lines 54-58):
     > Features 16, 17, 18, 20 define strict format whitelisting, temporary quarantine storage, archive safety limits (<500MB uncompressed, <100:1 ratio, nesting <= 2), and pre-signed S3 URLs with TTL of 15 to 60 minutes.
     > Lines 71-76: Edge cases 1-4 detail recursive entity defense (`defusedxml`), Zip Slip path traversal abort, Zip Bomb 10KB -> 100GB abort, and spoofed `malware.exe` as `.csv` rejection.

2. **Existing Codebase State**:
   - `H:/erppreflight/packages/database/migrations/001_initial_schema.sql` (Lines 79-93):
     `uploaded_files` table is already defined with columns:
     ```sql
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     file_name VARCHAR(500) NOT NULL,
     file_size BIGINT NOT NULL,
     mime_type VARCHAR(255) NOT NULL,
     storage_path VARCHAR(1000) NOT NULL,
     checksum_sha256 VARCHAR(64) NOT NULL,
     quarantine_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_SCAN',
     redaction_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
     metadata JSONB NOT NULL DEFAULT '{}',
     uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     ```
   - `H:/erppreflight/packages/schemas/src/project.ts` (Lines 21-36):
     `UploadedFileSchema` defines schema contracts matching the database table with `quarantineStatus` enum (`PENDING_SCAN`, `CLEAN`, `QUARANTINED`) and `redactionStatus` enum (`PENDING`, `REDACTED`, `PASSED`).
   - `H:/erppreflight/.env.example` (Lines 32-39):
     Configures dual buckets:
     ```env
     S3_ENDPOINT=http://localhost:9000
     S3_ACCESS_KEY=minioadmin
     S3_SECRET_KEY=minioadmin
     S3_REGION=us-east-1
     S3_BUCKET_QUARANTINE=erppreflight-quarantine
     S3_BUCKET_CLEAN=erppreflight-clean
     S3_BUCKET_REPORTS=erppreflight-reports
     ```
   - `H:/erppreflight/apps/api/src/config/env.validation.ts`:
     `envSchema` currently only validates Node, DB, Redis, and JWT keys; lacks validation for S3 storage keys and ClamAV keys.
   - `H:/erppreflight/tests/e2e/evaluators.py` (Lines 43-137):
     `IngestionEvaluator` contains baseline validation functions: `validate_file_format` and `check_archive_safety` enforcing `PK\x03\x04` magic bytes, XML `<?xml`, JSON parsing, CSV delimiter checks, Zip Slip path traversal checks, and Zip Bomb thresholds (500MB, 100:1 ratio).
   - `H:/erppreflight/tests/e2e/test_tier1_features.py` (Lines 53-125):
     `TestFeature01_IngestionMimeValidation` and `TestFeature02_ArchiveSafety` provide verification baselines for MIME and archive evaluation.

---

## 2. Logic Chain

1. **Storage Segregation Requirement**:
   From `PROJECT.md` line 31, `platform_spec.md` line 55, and `.env.example` lines 37-38, untrusted client uploads cannot be placed directly into storage accessible by analysis parsers. Two physically separate buckets must be maintained: `erppreflight-quarantine` and `erppreflight-clean`.
2. **Pre-signed Upload Security**:
   From `platform_spec.md` line 58 and `ORIGINAL_REQUEST.md` line 36, pre-signed upload URLs must point exclusively to the quarantine bucket with a short TTL (15 minutes). This allows clients to stream large files (up to 500 MB) directly to S3/MinIO without passing through or exhausting NestJS API server memory.
3. **MIME Magic-Byte Sniffing & Extension Cross-Validation**:
   From `platform_spec.md` edge case 4 and `evaluators.py` line 61, file extensions cannot be trusted. Executable binary headers (Windows PE `MZ`, Linux ELF `\x7fELF`, Mach-O, Java class) must be blacklisted and immediately rejected. Whitelisted formats (XML `<?xml`, JSON `{`/`[`, CSV delimiter sniff, ZIP `PK\x03\x04`, PDF `%PDF-`, ABAP plain text with zero null bytes, XDP with Adobe namespace) must match declared extensions; any discrepancy produces HTTP 422 `SPOOFED_FILE_EXTENSION`.
4. **Archive Safety Limits**:
   From `evaluators.py` lines 106-136, archive extraction presents Zip Slip and Zip Bomb attack vectors. To guarantee application safety:
   - Zip Slip is neutralized by raw pattern checks (`../`, `..\`, absolute paths) and canonical path verification (`resolvedPath.startsWith(destinationDir + path.sep)`).
   - Zip Bombs are blocked by 5 enforced thresholds: max 500 MB uncompressed, max 100:1 compression ratio (evaluated once uncompressed data > 10MB), max 10,000 files, max 250 MB per single file, and max 2 archive nesting levels. Stream inspection aborts extraction and deletes temporary files the instant any quota is breached.
5. **Quarantine Antivirus Scanning**:
   From `platform_spec.md` line 299, files staged in `erppreflight-quarantine` must undergo ClamAV malware scanning. Implementing the ClamAV daemon `INSTREAM` TCP protocol (port 3310) paired with an EICAR-aware mock scanner enables production-ready scanning and zero-dependency, deterministic local/CI testing.
6. **Promotion & Download Flow**:
   Only after passing magic-byte sniffing, archive safety checks, ClamAV scanning, and secret redaction is an artifact promoted from `erppreflight-quarantine` to `erppreflight-clean`. Pre-signed download URLs (30-minute TTL) are issued strictly for clean artifacts (`quarantine_status = 'CLEAN'`), and access is denied for any file still in quarantine.

---

## 3. Caveats

1. **Secret Redaction & Report Export Separation**:
   In accordance with the division of labor across Milestone 2 explorer agents, regex and Shannon entropy secret redaction patterns and report export generation (PDF/JSON/CSV) were explored and formulated by `m2_explorer_2` (`redaction_export_plan.md`). Our pipeline defines the exact integration handoff where clean uncompressed text is routed to the redaction engine before promotion.
2. **Evidence Engine & AI Problem Router Separation**:
   Evidence chain hashing, provenance classification (`VERIFIED`, `RULE_DERIVED`, `INFERRED`), and deterministic intent routing were explored and formulated by `m2_explorer_3` (`platform_services_plan.md`). Our pipeline supplies the clean S3 storage key and SHA-256 checksum to the job context consumed by the AI router.
3. **Environment Assumptions**:
   MinIO is assumed for local development and Coolify environments, requiring `forcePathStyle: true`. AWS S3 is fully compatible using standard AWS credentials and region settings. ClamAV mock mode (`CLAMAV_MOCK_MODE=true`) is assumed for unit/CI test execution.

---

## 4. Conclusion

The technical exploration for Milestone 2 Ingestion Security Pipeline & Storage is complete. All architectural mechanisms, protocol specifications, data models, and edge-case defenses have been formulated into a production-grade blueprint located at:
`H:/erppreflight/.agents/m2_explorer_1/ingestion_plan.md`

### Summary of Blueprint Contents
1. **MIME Magic-Byte Validation**: Specifications and code for XML, JSON, CSV, ZIP, ABAP, PDF, and XDP, including immediate rejection of spoofed extensions and executable binaries (`MZ`, `ELF`, Mach-O).
2. **Archive Safety Guard**: Stream-based inspection protecting against Zip Slip path traversal and Zip Bombs with strict ceilings: 500 MB uncompressed, 100:1 ratio, 10,000 files, and max nesting depth of 2.
3. **Quarantine Staging & ClamAV**: Physical bucket segregation (`erppreflight-quarantine` vs `erppreflight-clean`), TCP `INSTREAM` ClamAV daemon integration, and high-fidelity EICAR-aware mock scanner.
4. **Pre-signed S3 Storage URLs**: AWS SDK v3 client integration, short-lived signed PUT (15 min) and GET (30 min) URLs, and strict tenant boundary isolation.
5. **NestJS Ingestion Module Architecture**: DTOs, controller endpoints, BullMQ `ingestion-queue` processor, and Python analysis engine clean artifact fetcher.

---

## 5. Verification Method

To independently verify the architecture, schemas, and test expectations:

1. **Inspect Blueprint and Database Schema**:
   - Blueprint: `H:/erppreflight/.agents/m2_explorer_1/ingestion_plan.md`
   - Database Schema: `H:/erppreflight/packages/database/migrations/001_initial_schema.sql` (lines 79-93)
   - Zod Schema: `H:/erppreflight/packages/schemas/src/project.ts` (lines 21-36)
   - Evaluator Logic: `H:/erppreflight/tests/e2e/evaluators.py` (lines 43-137)

2. **Run Test Suites**:
   - Run current E2E Feature Ingestion and Archive Safety tests:
     ```powershell
     py -m pytest tests/e2e/test_tier1_features.py -k "Feature01 or Feature02" -v
     py -m pytest tests/e2e/test_tier2_boundaries.py -v
     ```
   - Run API unit and isolation tests:
     ```powershell
     npx pnpm --filter @erppreflight/api test
     ```

3. **Invalidation Conditions**:
   - The design is invalidated if untrusted files can be written directly to `erppreflight-clean` by a client.
   - The design is invalidated if an executable file (e.g. `malware.exe`) renamed as `.csv` passes magic-byte validation.
   - The design is invalidated if an archive with path traversal (e.g. `../../etc/passwd`) or exceeding 500 MB extracts without an error.
   - The design is invalidated if a pre-signed download URL is issued for a file whose `quarantine_status` is not `CLEAN`.
