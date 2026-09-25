# Handoff Report: Requirements R3 & R4 Exploration

> **Agent**: `survey_explorer_3` (Explorer)  
> **Target**: Orchestrator / Implementation Team  
> **Working Directory**: `H:/erppreflight/.agents/teamwork/survey_explorer_3`  
> **Report Artifact**: `H:/erppreflight/.agents/teamwork/survey_explorer_3/survey_r3_r4_report.md`  
> **Timestamp**: 2026-09-25T03:19:00Z  

---

## 1. Observation

1. **Analysis Controller Endpoint Absence**:
   - In `apps/api/src/modules/analyses/analyses.controller.ts:1-55`, the controller only defines:
     - `POST /analyses` (`line 23`)
     - `GET /analyses` (`line 32`)
     - `GET /analyses/:id` (`line 40`)
     - `GET /analyses/:id/findings` (`line 48`)
   - The endpoint `GET /api/v1/analyses/:id/reproducibility-bundle` does **not** exist in `analyses.controller.ts` or any other controller in `apps/api`.
2. **Existing Single-File Export Service**:
   - In `apps/api/src/modules/export/export.service.ts:72-83`, the service handles `JSON_BUNDLE` by generating a single JSON file:
     ```typescript
     case 'JSON_BUNDLE':
       fileName = `Reproducibility_Bundle_${analysisId.slice(0, 8)}.json`;
       mimeType = 'application/json';
     ```
   - In `export.service.ts:332-385`, `generateJsonBundle()` generates DAG nodes and edges, but does not package a multi-file ZIP archive containing `manifest.json`, `normalized_hashes.json`, `findings_ledger.json`, or `remediation_guide.md`.
   - `apps/api/package.json:33` already has `"archiver": "^8.0.0"` installed and available.
3. **Findings & Evidence Database Storage**:
   - In `packages/database/migrations/001_initial_schema.sql`:
     - `findings` table (`lines 109-127`): stores `id`, `organization_id`, `project_id`, `analysis_id`, `engine`, `rule_id`, `severity`, `category`, `title`, `description`, `confidence_class`, `confidence_score`, `remediation`, `affected_objects` (JSONB), `technical_details` (JSONB), `fingerprint`.
     - `evidence` table (`lines 130-145`): stores `id`, `organization_id`, `finding_id`, `artifact_path`, `line_number`, `column_number`, `snippet`, `sha256`, `provenance`, `source_title`, `source_url`, `trust_score`.
     - `uploaded_files` table (`lines 79-93`): stores `file_name`, `storage_path`, `checksum_sha256`, `quarantine_status`, `redaction_status`.
4. **Secret Redaction Engine**:
   - In `apps/api/src/modules/redaction/secret-redactor.service.ts:30-136`, `SecretRedactorService` implements regex and Shannon entropy masking with tenant-keyed HMAC tokens (`[REDACTED:SECRET:<hmac>]`), protecting tokens, passwords, and private keys while allowlisting SAP tables (`MARA`, `BKPF`, `ACDOCA`).
5. **Frontend Findings & Inspector Views**:
   - `apps/web/src/app/inspector/page.tsx:41-62`: Renders "Universal Object & Analysis Inspector" with a "Refresh" button only.
   - `apps/web/src/app/projects/[id]/findings/page.tsx:78-106`: Renders "Preflight Findings & Evidence Ledger" with "Refresh" and "Back to Overview" only.
   - Neither view provides a "Download Reproducibility Bundle" button.
6. **Frontend `/objects` Mock Facade (Violation of Axiom 1)**:
   - In `apps/web/src/app/projects/[id]/objects/page.tsx:41-45`, `useQuery` calls `fetchProjectObjects`.
   - In `apps/web/src/components/objects/types.ts:57-151`, `fetchProjectObjects` calls `generateMockSapObjects(10000, projectId)`, generating 10,000 fake in-memory items via PRNG.
   - In `apps/web/src/app/projects/[id]/objects/page.tsx:109-157`, summary metrics (74.2%, 142, 389) are hardcoded strings.
7. **Frontend Object Inspector Drawer Disconnect**:
   - `apps/web/src/components/objects/object-detail-drawer.tsx:24-276` implements an interactive slide-over drawer with Clean Core badges, findings, dependencies, and metadata.
   - However, in `apps/web/src/components/findings/finding-columns.tsx:220` and `finding-detail-row.tsx:71`, SAP object references are rendered as static, unclickable text.

---

## 2. Logic Chain

1. **R3 Bundle Generation**:
   - From (1) and (2), the required route `GET /api/v1/analyses/:id/reproducibility-bundle` does not exist, and existing export only produces a single JSON file.
   - Using the existing `"archiver": "^8.0.0"` dependency (Observation 2), the backend can construct a signed ZIP archive streaming four files (`manifest.json`, `normalized_hashes.json`, `findings_ledger.json`, `remediation_guide.md`).
   - From (3), all required inputs (`findings`, `evidence`, `uploaded_files`, `analyses`) are already persisted in PostgreSQL and S3 with tenant RLS.
   - From (4), passing all text fields through `SecretRedactorService.redact()` guarantees zero secret leakage in the bundle.
2. **R3 Frontend Integration**:
   - From (5), adding a "Download Reproducibility Bundle (.zip)" action button in `apps/web/src/app/projects/[id]/findings/page.tsx`, `apps/web/src/app/inspector/page.tsx`, and the analysis run history in `apps/web/src/app/projects/[id]/page.tsx` will allow users to invoke the download.
3. **R4 Backend Object Inventory**:
   - From (3) and (6), there is currently no backend object endpoint, forcing the frontend to rely on a client mock PRNG generator, which directly violates Cardinal Axiom 1.
   - A new `ObjectsModule` in `apps/api` can dynamically query and aggregate distinct objects from `findings.affected_objects` (and optionally `traceability_nodes`), computing real counts, Clean Core Tiers (1/2/3), and target release compatibility.
4. **R4 Universal Inspector Modal**:
   - From (6) and (7), `ObjectDetailDrawer` already exists but is trapped inside `/projects/[id]/objects/page.tsx`.
   - By hoisting `ObjectDetailDrawer` into a globally usable component and wiring click handlers into `findingColumns` (Target Object) and `FindingDetailRow` (Impacted SAP Repository Objects), clicking any SAP object across the web app will open the inspector drawer with live data.

---

## 3. Caveats

- **Clean Objects Without Findings**: If object inventory is dynamically derived *solely* from `findings.affected_objects`, SAP objects that have 100% clean core compliance (zero violations) will not appear in the inventory unless they are also ingested from CTS transport files (TADIR/E071) or an explicit `sap_objects` database table is added. A dedicated `sap_objects` table is recommended for full 100k+ enterprise inventories.
- **Large Dataset Virtualization**: The frontend `/objects` page uses client-side virtualization (`virtualHeight="calc(100vh - 360px)"`). For datasets > 5,000 objects, server-side pagination with windowing must be supported via query parameters (`page`, `pageSize`, `search`, `tier`, `type`).

---

## 4. Conclusion

- **R3**: Fully specified. Requires adding `GET /api/v1/analyses/:id/reproducibility-bundle` in `apps/api/src/modules/analyses/analyses.controller.ts` and `AnalysesService`, generating an `archiver` ZIP containing `manifest.json` (signed with snapshot `KNOW_SNAP_2026_09_24`), `normalized_hashes.json`, `findings_ledger.json`, and `remediation_guide.md`, protected by `SecretRedactorService`. Frontend needs download buttons added to Findings, Inspector, and History views.
- **R4**: Fully specified. Requires eliminating the client-side mock generator `generateMockSapObjects` in `apps/web/src/components/objects/types.ts` to satisfy Cardinal Axiom 1, creating `ObjectsModule` (`GET /api/v1/projects/:id/objects`) in `apps/api`, and making SAP object references clickable across `finding-columns.tsx` and `finding-detail-row.tsx` to launch `ObjectDetailDrawer`.

---

## 5. Verification Method

To verify the investigation and subsequent implementation:

1. **Verify Existing Codebase Points**:
   ```bash
   # Inspect missing endpoint in AnalysesController
   cat apps/api/src/modules/analyses/analyses.controller.ts

   # Inspect client mock in objects types
   grep -n "generateMockSapObjects" apps/web/src/components/objects/types.ts

   # Inspect archiver dependency
   grep -n "archiver" apps/api/package.json
   ```

2. **Test Monorepo Quality Gates**:
   ```bash
   # Typecheck
   pnpm run typecheck

   # Test suite
   pnpm run test
   ```

3. **Invalidation Conditions**:
   - If any generated ZIP contains unredacted customer passwords or private keys (`FAIL`).
   - If `generateMockSapObjects` remains in production web paths (`FAIL`).
   - If `GET /api/v1/analyses/:id/reproducibility-bundle` returns 404 (`FAIL`).
