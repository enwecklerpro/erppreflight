# Architectural Survey & Implementation Blueprint: Requirements R3 & R4

> **Target Repository**: `H:/erppreflight`  
> **Subagent**: `survey_explorer_3` (Teamwork Explorer)  
> **Date**: 2026-09-25T03:18:00Z  
> **Scope**:  
> - **R3**: Cryptographic Reproducibility Bundle Downloader (`.zip`)  
> - **R4**: Universal SAP Object Inspector (`/objects` & Modal)

---

## 1. Executive Summary

This investigation analyzed the backend architecture (`apps/api`), analysis pipeline (`services/analysis-python`), shared domain contracts (`packages/schemas`, `packages/evidence`, `packages/database`), and frontend applications (`apps/web`) to specify the implementation blueprint for Requirements **R3** and **R4**.

### Key Findings Matrix
| Component / Requirement | Current Codebase State | Identified Gap | Cardinal Axiom / Standard Impact |
|---|---|---|---|
| **R3: Reproducibility Bundle API** | `ExportService` in `apps/api/src/modules/export/export.service.ts:72-83` generates single-file JSON/PDF/CSV/XLSX. `AnalysesController` lacks `GET /analyses/:id/reproducibility-bundle`. | No signed `.zip` generation containing multi-file audit bundle (`manifest.json`, `normalized_hashes.json`, `findings_ledger.json`, `remediation_guide.md`). | Violates Part 14.11 & Master Spec requirement for offline audit reproducibility. |
| **R3: Bundle Secret Redaction** | `SecretRedactorService` in `apps/api/src/modules/redaction/` handles ingestion, but export bundle generation does not explicitly sanitize text fields. | Evidence snippets or technical parameters could expose customer secrets if raw files were bypassed. | Must enforce fail-closed zero-secret invariant on all exported zip streams. |
| **R3: Frontend Download Action** | Universal Inspector (`apps/web/src/app/inspector/page.tsx`) and Project Findings (`apps/web/src/app/projects/[id]/findings/page.tsx`) only feature "Refresh". | No "Download Reproducibility Bundle" button or hook integration exists. | User cannot trigger or download audit bundles from findings ledgers. |
| **R4: SAP Object Inventory API** | No `ObjectsController` or `ObjectsModule` exists in `apps/api`. `AppModule` does not register an object catalog service. | Objects are stored only implicitly inside `findings.affected_objects` JSONB; no API endpoint serves paginated object inventories. | Frontend has no backend endpoint to retrieve live project objects. |
| **R4: Frontend `/objects` Page** | `apps/web/src/app/projects/[id]/objects/page.tsx` exists with `DataTable` and `ObjectDetailDrawer`. | Uses `generateMockSapObjects(10000, projectId)` in `components/objects/types.ts:57` and hardcoded metric cards (74.2%, 142, 389). | **Direct violation of Cardinal Axiom 1** ("A page that renders is not a completed feature. No hardcoded client-side dummy arrays"). |
| **R4: Universal Object Modal** | `ObjectDetailDrawer` is only mounted on `/projects/[id]/objects`. Object names in `finding-columns.tsx:220` and `finding-detail-row.tsx:71` are unclickable plain text. | Clicking an SAP object in Findings or Universal Inspector does nothing. | Violates user requirement: "Clicking any known SAP object opens the detailed inspector drawer/modal." |

---

## 2. Requirement R3: Cryptographic Reproducibility Bundle Downloader (`.zip`)

### 2.1 Backend Architecture & Existing Endpoints

In `apps/api/src/main.ts:60`, the application sets the global API prefix to `api/v1`:
```typescript
app.setGlobalPrefix('api/v1', { ... });
```

Currently, `apps/api/src/modules/analyses/analyses.controller.ts` exposes:
- `POST /api/v1/analyses` (trigger analysis)
- `GET /api/v1/analyses` (list analyses)
- `GET /api/v1/analyses/:id` (get analysis status and finding count)
- `GET /api/v1/analyses/:id/findings` (get findings with nested evidence)

The endpoint mandated by R3:
```http
GET /api/v1/analyses/:id/reproducibility-bundle
```
is currently **missing** from `AnalysesController`.

Existing export functionality in `apps/api/src/modules/export/` (`ExportController` and `ExportService`):
- `POST /api/v1/projects/:projectId/analyses/:analysisId/export` generates PDF, XLSX, CSV, or a single-file JSON bundle (`JSON_BUNDLE`).
- `GET /api/v1/projects/:projectId/analyses/:analysisId/reports` lists generated reports.
- `GET /api/v1/reports/:reportId/download` generates a 30-minute presigned S3 download URL.

However, `ExportService.generateJsonBundle()` (`apps/api/src/modules/export/export.service.ts:332-385`) returns only a flat JSON structure containing DAG nodes and edges. It does not package a ZIP archive and omits `manifest.json`, `normalized_hashes.json`, and `remediation_guide.md`.

### 2.2 Storage Model: Findings, Evidence Hashes & Artifacts

The system stores analysis data across PostgreSQL and S3/MinIO as follows:

1. **Analysis Runs (`analyses` table)** (`packages/database/migrations/001_initial_schema.sql:96-106`):
   - Primary key: `id` (UUID)
   - Tenant isolation: `organization_id` (UUID with PostgreSQL RLS enabled)
   - Workspace reference: `project_id` (UUID)
   - Status: `status` (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `PARTIAL`)
   - Metadata: `engine_types` (JSONB), `target_release` (VARCHAR), `triggered_by` (UUID), `created_at`, `completed_at`
2. **Findings Ledger (`findings` table)** (`packages/database/migrations/001_initial_schema.sql:109-127`):
   - Columns: `id`, `organization_id`, `project_id`, `analysis_id`, `engine`, `rule_id`, `severity`, `category`, `title`, `description`, `confidence_class`, `confidence_score`, `remediation`, `affected_objects` (JSONB array), `technical_details` (JSONB object), `fingerprint` (SHA-256 deduplication hash).
3. **Cryptographic Evidence (`evidence` table)** (`packages/database/migrations/001_initial_schema.sql:130-145`):
   - Columns: `id`, `organization_id`, `finding_id`, `artifact_path`, `line_number`, `column_number`, `snippet`, `sha256` (64-char hexadecimal hash of the snippet/artifact), `provenance`, `source_title`, `source_url`, `trust_score`.
4. **Input Artifacts (`uploaded_files` table)** (`packages/database/migrations/001_initial_schema.sql:79-93`):
   - Columns: `id`, `organization_id`, `project_id`, `file_name`, `file_size`, `mime_type`, `storage_path`, `checksum_sha256`, `quarantine_status`, `redaction_status`, `metadata`.
5. **Artifact Object Storage (MinIO/S3)** (`apps/api/src/modules/storage/s3-storage.service.ts`):
   - Quarantine bucket (`erppreflight-quarantine`): `quarantine/{tenantId}/{projectId}/{fileId}/{fileName}`
   - Clean bucket (`erppreflight-clean`): `tenants/{tenantId}/projects/{projectId}/{fileId}/{fileName}`
   - Reports bucket (`erppreflight-reports`): `tenants/{tenantId}/projects/{projectId}/reports/{analysisId}/{reportId}_{fileName}`

### 2.3 Signed ZIP Export Specification

`apps/api/package.json:33` already has `"archiver": "^8.0.0"` and `"@types/archiver": "^8.0.0"` installed. The endpoint `GET /api/v1/analyses/:id/reproducibility-bundle` should generate a ZIP archive with `archiver('zip', { zlib: { level: 9 } })` containing four strictly defined artifacts:

#### 1. `manifest.json`
Contains execution metadata, engine inventory, rule bundle versions, and cryptographic signature:
```json
{
  "$schema": "https://erppreflight.com/schemas/v1/reproducibility-manifest.json",
  "bundle_id": "b8a92f03-2415-4fa8-bf12-58e1c667086a",
  "analysis_id": "c33b749d-64eb-4fa8-9e66-6bdf20b92482",
  "project_id": "1a91cf25-87a4-4a41-b0db-6e69001b9201",
  "organization_id": "0f69a9b2-789a-41d7-b86a-cf392a832101",
  "generated_at": "2026-09-25T03:15:00.000Z",
  "target_release": "S4H_2023",
  "knowledge_snapshot_id": "KNOW_SNAP_2026_09_24",
  "engine_versions": {
    "OPD_GUARD": "1.2.0",
    "CLEAN_CORE_OBJECT_GUARD": "1.4.1",
    "FORM_DOCTOR": "1.1.0",
    "ECC2CLOUD_NAVIGATOR": "2.0.0",
    "TRANSPORT_DEPENDENCY_ANALYZER": "1.3.0"
  },
  "rule_bundle_versions": {
    "bundle_version": "2026.09.24",
    "rules_evaluated_count": 87
  },
  "findings_summary": {
    "total": 14,
    "blocker": 2,
    "critical": 3,
    "major": 5,
    "minor": 4,
    "clean_core_compliance_score": 78.5
  },
  "bundle_integrity": {
    "files_sha256": {
      "normalized_hashes.json": "<sha256>",
      "findings_ledger.json": "<sha256>",
      "remediation_guide.md": "<sha256>"
    },
    "signature_algorithm": "HMAC-SHA256",
    "signature": "<hmac_sha256_of_canonical_manifest_body>"
  }
}
```

#### 2. `normalized_hashes.json`
Contains cryptographically verifiable hashes of all input files and evidence excerpts:
```json
{
  "artifacts": [
    {
      "file_id": "d14f2e82-...",
      "file_name": "billing_opd.xml",
      "mime_type": "application/xml",
      "sha256_original": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "sha256_sanitized": "a823f790234b8c9d1234ef918237461928374918237491827349182374918273",
      "redaction_status": "PASSED"
    }
  ],
  "evidence_ledger_hashes": [
    {
      "evidence_id": "e001-...",
      "finding_id": "f001-...",
      "artifact_path": "billing_opd.xml",
      "line_number": 42,
      "sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"
    }
  ]
}
```

#### 3. `findings_ledger.json`
Complete deterministic findings list with cryptographic evidence pointers, sorted deterministically by severity and rule ID:
```json
[
  {
    "id": "f001-...",
    "rule_id": "OPD_DETERMINATION_STEP_MISSING",
    "severity": "BLOCKER",
    "category": "OUTPUT_DETERMINATION",
    "title": "Missing Email Channel Determination Step",
    "description": "Output parameter determination lacks recipient routing...",
    "confidence_class": "VERIFIED",
    "confidence_score": 1.0,
    "remediation": "Add an explicit determination step for channel EMAIL in BRFplus table OPD_BILLING_DOC.",
    "affected_objects": [
      { "name": "OPD_BILLING_DOC", "type": "OPD_TABLE", "package": "Z_OUTPUT", "tier": "TIER_1_CLOUD" }
    ],
    "evidence": [
      {
        "id": "e001-...",
        "artifact_path": "billing_opd.xml",
        "line_number": 42,
        "column_number": 12,
        "snippet": "<DeterminationTable name=\"OUTPUT_TYPE\">...</DeterminationTable>",
        "sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
        "provenance": "VERIFIED",
        "trust_score": 1.0
      }
    ],
    "fingerprint": "a982f...64char"
  }
]
```

#### 4. `remediation_guide.md`
Human-readable, markdown-formatted remediation handbook formatted specifically for the target SAP release (e.g. S/4HANA 2023):
- Header with Project Name, Target SAP Release, Timestamp, and Audit Verification Fingerprint.
- Executive Remediation Summary (Count of Blockers, Critical items, Clean Core Index).
- Detailed Finding Breakdown grouped by Severity:
  - Finding Code & Severity Badge
  - Impacted SAP Objects & File Location (Line/Col)
  - Concrete Actionable Remediation Instructions
  - Recommended SAP Standard Cloud Replacement / Note References.

### 2.4 Secret Redaction Enforcement

Secret redaction is already established in `apps/api/src/modules/redaction/secret-redactor.service.ts`:
- Employs regex pattern matching (`SecretRedactorService.PATTERN_DEFS`) covering Bearer tokens, JWTs, AWS keys, OpenAI keys, GitHub tokens, SAP RFC passwords (`rfc_password`, `PASSWD`), SAP router passwords, and generic API keys.
- Utilizes Shannon entropy calculation (`calculateEntropy >= 4.50`) for detecting high-entropy secrets.
- Maintains an immutable SAP allowlist (`SecretRedactorService.ALLOWLIST:33-65`) for DDIC tables (`MARA`, `BKPF`, `ACDOCA`, etc.) and ABAP keywords to prevent false positives.
- Generates deterministic HMAC-SHA256 masks keyed per tenant: `[REDACTED:SECRET:<hmac>]`.

**Enforcement for the Reproducibility Bundle**:
1. During ZIP generation in `ExportService`, all text fields across `findings_ledger.json` and `remediation_guide.md` (evidence snippets, titles, descriptions, technical parameters) must be passed through `secretRedactorService.redact(text, tenantId)`.
2. Any unredacted secret found during pre-export verification halts bundling with a `500 Internal Server Error` (Fail-Closed invariant).
3. The original raw artifact files are **never** included unredacted in the bundle; only normalized hashes and redacted snippets are packaged.

### 2.5 Frontend Architecture & Integration Points

#### Views in `apps/web`:
1. **Universal Inspector**:
   - Location: `apps/web/src/app/inspector/page.tsx`
   - Header Bar (`lines 38-62`): Currently has page title and "Refresh" button.
   - Proposed placement: Add "Download Reproducibility Bundle" button to the header actions next to "Refresh". If an analysis is selected or filtered, it passes the active `analysisId`; otherwise, if viewing cross-project findings, prompts or downloads the latest workspace bundle.
2. **Project Findings Ledger**:
   - Location: `apps/web/src/app/projects/[id]/findings/page.tsx`
   - Header Bar (`lines 74-106`): Currently has page title, "Refresh", and "Back to Overview".
   - Proposed placement: Add a prominent secondary button in the top action group:
     ```tsx
     <button
       onClick={handleDownloadBundle}
       disabled={isDownloading || !latestAnalysisId}
       className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-foreground hover:bg-muted transition-colors shadow-xs"
       aria-label="Download Cryptographic Reproducibility Bundle"
     >
       <Download className={`size-3.5 ${isDownloading ? 'animate-bounce' : ''}`} />
       Download Reproducibility Bundle (.zip)
     </button>
     ```
3. **Project Workspace Overview & History Tab**:
   - Location: `apps/web/src/app/projects/[id]/page.tsx`
   - In `activeTab === 'findings'` (`line 426`): Place next to "Open Full Findings Ledger".
   - In `activeTab === 'history'` (`lines 781-805`): In the analysis run history list, every completed run row should have an inline `<button>`: "Download Bundle (.zip)".

#### Client Download Mechanism:
In `apps/web/src/lib/api-client.ts`:
```typescript
export async function downloadReproducibilityBundle(analysisId: string): Promise<void> {
  const url = `${getApiBaseUrl()}/analyses/${analysisId}/reproducibility-bundle`;
  window.open(url, '_blank');
}
```
Or stream through `fetch()` with credentials and trigger `downloadBlob(blob, filename)` from `apps/web/src/lib/export.ts:29`.

---

## 3. Requirement R4: Universal SAP Object Inspector (`/objects` & Modal)

### 3.1 Current Frontend Implementation State

The route `apps/web/src/app/projects/[id]/objects/page.tsx` currently exists. However, its current implementation contains serious facade code violating **Cardinal Axiom 1**:

1. **Client-side Mock Generator**:
   In `apps/web/src/app/projects/[id]/objects/page.tsx:41-45`:
   ```typescript
   queryFn: () =>
     fetchProjectObjects({
       projectId,
       enableVirtualization: true,
     }),
   ```
   `fetchProjectObjects` is defined in `apps/web/src/components/objects/types.ts:137-151`:
   ```typescript
   if (!cachedMockObjects) {
     cachedMockObjects = generateMockSapObjects(10000, projectId);
   }
   ```
   It generates 10,000 fake in-memory items via PRNG!
2. **Hardcoded Summary Metrics**:
   In `apps/web/src/app/projects/[id]/objects/page.tsx:109-157`:
   - "Total Catalog Objects": `data?.totalCount || '10,000+'`
   - "Clean Core Compliance": Hardcoded `<span ...>74.2%</span>`
   - "Classic Modifications": Hardcoded `<span ...>142</span>`
   - "Active Preflight Findings": Hardcoded `<span ...>389</span>`
3. **Existing Drawer Component**:
   `apps/web/src/components/objects/object-detail-drawer.tsx` is implemented with 3 tabs:
   - `Preflight Findings` (`lines 142-177`)
   - `Dependencies & Lineage` (`lines 180-228`)
   - `Technical Metadata` (`lines 231-270`)
   It uses real schemas (`SapObject` from `@erppreflight/schemas`), but is isolated strictly to the `/objects` page.
4. **Findings View Disconnect**:
   In `apps/web/src/components/findings/finding-columns.tsx:220`, column 8 ("Target Object") renders:
   ```tsx
   <div className="flex items-center gap-1.5 font-mono text-xs">
     <span className="font-semibold text-foreground">{obj.name}</span>
     {obj.type && <span ...>{obj.type}</span>}
   </div>
   ```
   And in `apps/web/src/components/findings/finding-detail-row.tsx:71`, affected objects are displayed as non-interactive text. Neither triggers the object inspection drawer.

### 3.2 Backend Data Sources & Inventory Genesis

Currently, there is no separate `sap_objects` table in the PostgreSQL database migrations (`001_initial_schema.sql` through `006_baselines_and_lab.sql`).

#### How SAP Objects Are Stored Today:
When preflight analysis runs, the Python engines emit findings whose models (`services/analysis-python/src/models/finding.py:20`) include:
```python
affected_objects: List[str] = Field(default_factory=list)
```
In `apps/api/src/modules/jobs/analysis.processor.ts:196`, this is stored into the `findings` table:
```sql
affected_objects JSONB NOT NULL DEFAULT '[]'
```
Example JSONB payload in `findings.affected_objects`:
```json
[
  {
    "name": "ZCL_CUSTOMER_INVOICE_API",
    "type": "CLAS",
    "package": "Z_FIN_INV",
    "tier": "TIER_3_CLASSIC"
  }
]
```

#### Object Inventory Strategy:
There are two architectural strategies to populate the Universal Object Inventory:

1. **Option A: Dynamic Object Aggregation Engine (Direct from Findings & Artifacts)**
   - Query all distinct objects referenced across `findings.affected_objects` in the workspace:
     ```sql
     SELECT
       obj->>'name' as name,
       COALESCE(obj->>'type', 'SAP_OBJECT') as object_type,
       COALESCE(obj->>'package', '$TMP') as package,
       COALESCE(obj->>'tier', 'TIER_1_CLOUD') as clean_core_tier,
       COUNT(f.id) as findings_count,
       COUNT(CASE WHEN f.severity = 'BLOCKER' THEN 1 END) as blocker_count,
       COUNT(CASE WHEN f.severity = 'CRITICAL' THEN 1 END) as critical_count,
       MAX(f.created_at) as last_changed_at
     FROM findings f,
     LATERAL jsonb_array_elements(f.affected_objects) as obj
     WHERE f.organization_id = $1 AND f.project_id = $2
     GROUP BY obj->>'name', obj->>'type', obj->>'package', obj->>'tier'
     ```
   - *Advantage*: Works immediately on all existing analyses without new database tables.
   - *Limitation*: Only captures objects that have findings or were explicitly touched by an engine; clean objects without findings wouldn't appear unless extracted from uploaded transport files (TADIR/E071).

2. **Option B: Dedicated `sap_objects` Inventory Table (Master Specification Architecture)**
   - Create table `sap_objects` in migration `007_sap_objects.sql`:
     ```sql
     CREATE TABLE IF NOT EXISTS sap_objects (
         id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
         project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
         name VARCHAR(255) NOT NULL,
         object_type VARCHAR(50) NOT NULL, -- PROG, CLAS, TABL, CDS, FUGR, INTF, FORM, TRAN
         description TEXT DEFAULT '',
         package VARCHAR(100) DEFAULT '$TMP',
         software_component VARCHAR(100) DEFAULT 'ZCUSTOM',
         clean_core_tier VARCHAR(50) NOT NULL DEFAULT 'TIER_1_CLOUD',
         modification_status VARCHAR(50) NOT NULL DEFAULT 'CUSTOM_Z',
         complexity JSONB NOT NULL DEFAULT '{}',
         transport_request VARCHAR(50),
         dependencies JSONB NOT NULL DEFAULT '[]',
         last_changed_by VARCHAR(100) DEFAULT 'SAP_USER',
         last_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE(project_id, name, object_type)
     );
     ```
   - When a preflight analysis or transport upload runs, `AnalysisProcessor` or `IngestionService` populates/updates `sap_objects`.
   - Linked findings are joined dynamically via `findings.affected_objects @> jsonb_build_array(jsonb_build_object('name', sap_objects.name))`.

**Recommended Architecture**:
Implement a hybrid approach:
- Introduce `ObjectsModule`, `ObjectsController`, and `ObjectsService` in `apps/api`.
- The service dynamically aggregates from `findings` and `traceability_nodes`, and can also ingest full object catalogs from uploaded CTS transport files (E071 XML/CSV) or ECC2Cloud navigator ST03N/TADIR scans.
- Implements `GET /api/v1/projects/:id/objects` (paginated, filtered, with real facet counts) and `GET /api/v1/projects/:id/objects/:name` (detail with linked findings, dependencies, and Clean Core tiering).

### 3.3 Classification & Query Strategy

#### 1. Clean Core Tiers (1 / 2 / 3)
Clean Core classification is governed by `@erppreflight/schemas` (`CleanCoreTierEnum: 'TIER_1_CLOUD' | 'TIER_2_DEVELOPER' | 'TIER_3_CLASSIC'`):
- **Tier 3 (Classic Modification / High Risk)**: Objects with findings from `CLEAN_CORE_OBJECT_GUARD` (direct DB access to standard SAP tables like `ACDOCA`, `BKPF`, `MARA`, or SSCR modifications).
- **Tier 2 (Developer Extensibility / Managed Risk)**: Objects using unreleased internal SAP APIs without Released Contract C1 status.
- **Tier 1 (Cloud Ready / Standard Compliant)**: Objects using only Released APIs (Contract C1), standard CDS views (`I_*`), or key-user custom fields.

When querying an object:
- If any linked finding on the object is a Tier 3 Blocker, the object's effective tier is `TIER_3_CLASSIC`.
- If the object has only unreleased API or deprecation warnings, it is `TIER_2_DEVELOPER`.
- If the object has zero violations, it is classified as `TIER_1_CLOUD`.

#### 2. Target Release Compatibility
- Uses `ReleaseAlignmentValidator` from `@erppreflight/evidence` (`packages/evidence/src/release-alignment.ts`).
- Checks if the object's dependent APIs or CDS views are deprecated in the project's `target_release` (e.g. `S4H_2023`).
- If an object uses an API deprecated in S/4HANA 2023, its compatibility status is flagged `INCOMPATIBLE_IN_TARGET_RELEASE` with successor recommendations (e.g. replacing `BAPI_ACC_DOCUMENT_POST` with `I_JournalEntryTP`).

#### 3. Dependency Links
- Inbound and Outbound references derived from AST analysis in `extension_impact.py` and `transport_dependency.py` (`E071Record`).
- Query:
  - Inbound: Which custom programs or CDS views consume this object?
  - Outbound: Which database tables, function modules, or BAdIs does this object call?
  - Hazardous dependencies: Marked with `isCleanCoreHazard: true` if pointing to unreleased internal SAP objects.

#### 4. Linked Findings
- Direct query from `findings` table:
  ```sql
  SELECT f.id, f.rule_id, f.severity, f.title, f.remediation, f.confidence_class
  FROM findings f
  WHERE f.organization_id = $1 AND f.project_id = $2
    AND f.affected_objects @> jsonb_build_array(jsonb_build_object('name', $3))
  ORDER BY
    CASE f.severity WHEN 'BLOCKER' THEN 1 WHEN 'CRITICAL' THEN 2 WHEN 'MAJOR' THEN 3 ELSE 4 END
  ```

### 3.4 Universal Modal / Drawer Experience

To satisfy "Clicking any known SAP object opens the detailed inspector drawer/modal":

1. **Extract Drawer into Global Component**:
   Refactor `ObjectDetailDrawer` into a globally accessible modal/drawer: `SapObjectInspectorModal` (or `SapObjectDrawer`).
2. **Context / URL Parameter Trigger**:
   Support opening via URL query parameter (e.g. `?inspectObject=ZCL_ORDER_PROCESSOR`) or via a lightweight React Context `useObjectInspector()` hook:
   ```typescript
   const { openObjectInspector } = useObjectInspector();
   // Can be called anywhere:
   openObjectInspector('ZCL_ORDER_PROCESSOR', 'CLAS');
   ```
3. **Integrate into Findings Table (`finding-columns.tsx`)**:
   In Column 8 ("Target Object"), make the object name a clickable button:
   ```tsx
   <button
     type="button"
     onClick={(e) => {
       e.stopPropagation();
       onInspectObject?.(obj.name, obj.type);
     }}
     className="text-primary hover:underline font-mono font-semibold"
   >
     {obj.name}
   </button>
   ```
4. **Integrate into Finding Detail Row (`finding-detail-row.tsx`)**:
   In "Impacted SAP Repository Objects", make each listed badge clickable to open the inspector.
5. **Real Data Hook**:
   Replace `components/objects/types.ts` mock generation with real TanStack Query:
   ```typescript
   export function useProjectObjects(projectId: string, params: FetchObjectsParams) {
     return useQuery({
       queryKey: queryKeys.objects.byProject(projectId, params),
       queryFn: () => fetchProjectObjects(projectId, params),
     });
   }
   ```

---

## 4. Concrete Recommendations & Implementation Plan

### 4.1 Backend Implementation Plan (`apps/api`)

1. **Create Endpoint `GET /api/v1/analyses/:id/reproducibility-bundle`**:
   - Add method in `AnalysesController` (`apps/api/src/modules/analyses/analyses.controller.ts`):
     ```typescript
     @Get(':id/reproducibility-bundle')
     async downloadReproducibilityBundle(
       @CurrentTenant() tenantId: string,
       @Param('id') analysisId: string,
       @Res() res: Response
     ) {
       return this.analysesService.streamReproducibilityBundle(tenantId, analysisId, res);
     }
     ```
   - In `AnalysesService`:
     - Fetch analysis record, verify tenant isolation (`organization_id = tenantId`).
     - Query all findings and evidence.
     - Fetch uploaded artifact records and hashes.
     - Build `manifest.json` with knowledge snapshot ID `KNOW_SNAP_2026_09_24`.
     - Build `normalized_hashes.json` with original/sanitized SHA-256 checksums.
     - Build `findings_ledger.json` with evidence pointers.
     - Build `remediation_guide.md` tailored to `target_release`.
     - Execute `SecretRedactorService.redact()` on all text outputs.
     - Stream ZIP archive directly via `archiver` with `Content-Type: application/zip` and `Content-Disposition: attachment; filename="Reproducibility_Bundle_${analysisId.slice(0, 8)}.zip"`.
2. **Create `ObjectsModule` (`apps/api/src/modules/objects/`)**:
   - `objects.controller.ts`:
     - `GET /api/v1/projects/:projectId/objects` (paginated list, faceted search)
     - `GET /api/v1/projects/:projectId/objects/:name` (detail with linked findings and Clean Core tier)
     - `GET /api/v1/projects/:projectId/objects/metrics` (real compliance %, modification counts, active finding counts)
   - `objects.service.ts`:
     - Queries PostgreSQL findings ledger and traceability nodes.
     - Aggregates distinct SAP objects and assigns Clean Core Tiers (1/2/3).
     - Returns real, non-mocked data compliant with Cardinal Axiom 1.
   - Register `ObjectsModule` in `apps/api/src/app.module.ts`.

### 4.2 Frontend Implementation Plan (`apps/web`)

1. **Add API Client Functions in `apps/web/src/lib/api-client.ts`**:
   - `fetchProjectObjects(projectId, params)`
   - `fetchObjectDetail(projectId, objectName)`
   - `fetchObjectMetrics(projectId)`
   - `downloadReproducibilityBundle(analysisId)`
2. **Eliminate Client Mock Generator in `components/objects/types.ts`**:
   - Replace `generateMockSapObjects()` with real API call to `GET /api/v1/projects/:id/objects`.
   - Replace hardcoded metrics on `/projects/[id]/objects/page.tsx` with dynamic query from `fetchObjectMetrics()`.
3. **Add "Download Reproducibility Bundle" Action**:
   - On `apps/web/src/app/projects/[id]/findings/page.tsx`: Button in header.
   - On `apps/web/src/app/inspector/page.tsx`: Button in header.
   - On `apps/web/src/app/projects/[id]/page.tsx`: Button in "Run History" rows and "Findings" tab.
4. **Wire Universal Object Inspector Click Handlers**:
   - Pass `onInspectObject: (name, type) => void` down through `findingColumns` and `FindingDetailRow`.
   - Render `ObjectDetailDrawer` at page level on both `/projects/[id]/findings` and `/inspector`.
   - Clicking any SAP object immediately displays its metadata, Clean Core tier, release compatibility, and associated preflight findings.

---

## 5. Verification Commands & Testing Strategy

```bash
# 1. Monorepo Build & Typecheck (Must pass with 0 errors)
pnpm run build
pnpm run typecheck

# 2. Monorepo Linter
pnpm run lint

# 3. Unit Tests across API & Web
pnpm run test

# 4. Ingestion & Redaction Verification Tests
pnpm --filter @erppreflight/api test test/redaction_export.spec.ts

# 5. Playwright E2E Suite
pnpm exec playwright test
```

### Critical Invalidation Conditions
- Any bundle ZIP containing unredacted plaintext RFC passwords (`SecretRFC2026!`, `PASSWD = ...`) or private key blocks immediately fails acceptance.
- Any client-side mock constants (`generateMockSapObjects`) remaining in production routes will fail automated verification (`scripts/check-no-production-facades.mjs`).
- Bundle endpoint returning 200 without tenant isolation verification will fail Multi-Tenant Denial Gate (Gate 4).
