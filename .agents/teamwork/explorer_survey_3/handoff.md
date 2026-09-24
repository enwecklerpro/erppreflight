# Investigation Handoff Report: Requirements R6 & R7

> **Agent**: Explorer Survey 3 (`explorer_survey_3`)  
> **Mission**: Comprehensive read-only survey of codebase for Requirements R6 (Dynamic Engine Matrix Failure Representation) and R7 (Playwright E2E Test Suite & Golden Fixture).  
> **Timestamp**: 2026-09-24T21:21:00Z  
> **Target Repository**: `H:/erppreflight`  
> **Governing Standards**: `AGENTS.md` (Cardinal Axioms 1 & 2), `frontend-design-system.md`, `engine-authoring.md`, `sap-evidence.md`.

---

## 1. Observation

### 1.1 Requirement R6: Dynamic Engine Matrix Failure Representation

#### Observation 1.1.1 — Static Fallback in `apps/web/src/components/engine-matrix.tsx`
- **File**: `apps/web/src/components/engine-matrix.tsx`
- **Lines 12–25**:
  ```tsx
  12:   const {
  13:     data: engineData,
  14:     isLoading,
  15:     refetch,
  16:     isFetching,
  17:   } = useQuery({
  18:     queryKey: ['engines', 'status'],
  19:     queryFn: fetchEngineStatus,
  20:     staleTime: 1000 * 60,
  21:     retry: 1,
  22:   });
  23: 
  24:   const engines: EngineStatusItem[] = engineData?.engines || ALL_18_ENGINES;
  ```
- **Finding**: `useQuery` does not destructure `isError` or `error`. If `fetchEngineStatus` fails (e.g. backend offline, network drop, 500 error), `engineData` is `undefined`, so `engines` silently defaults to `ALL_18_ENGINES`.

#### Observation 1.1.2 — Hardcoded `OPERATIONAL` Status in `ALL_18_ENGINES`
- **File**: `apps/web/src/lib/api-client.ts`
- **Lines 8–39**:
  ```ts
  8: export interface EngineStatusItem {
  9:   id: string;
  10:   name: string;
  11:   domain: string;
  12:   status: 'OPERATIONAL' | 'DEGRADED' | 'STANDBY' | 'OFFLINE';
  13:   rulesCount: number;
  14:   description: string;
  15:   supportedArtifactTypes?: string[];
  16:   version?: string;
  17: }
  18: 
  19: export const ALL_18_ENGINES: EngineStatusItem[] = [
  20:   { id: 'OPD_GUARD', name: 'OPD Guard', domain: 'Output & Extensibility', status: 'OPERATIONAL', rulesCount: 8, description: 'S/4HANA Output Parameter Determination rules & BRFplus' },
  21:   { id: 'FORM_DOCTOR', name: 'FormDoctor', domain: 'Output & Extensibility', status: 'OPERATIONAL', rulesCount: 12, description: 'SAPscript / Smart Forms to Adobe Forms migration validator' },
  ...
  38:   { id: 'MFS_BLACKBOX', name: 'MFS BlackBox', domain: 'Warehouse Automation', status: 'OPERATIONAL', rulesCount: 28, description: 'Material Flow System telegram sequence & telegram buffer auditor' },
  39: ];
  ```
- **Finding**: Every single entry in `ALL_18_ENGINES` has `status: 'OPERATIONAL'` hardcoded. Furthermore, line 12 does not include `'UNKNOWN'` in the TypeScript status union type (`'OPERATIONAL' | 'DEGRADED' | 'STANDBY' | 'OFFLINE'`).

#### Observation 1.1.3 — Inaccessible Binary Status Styling & Absence of Offline State in `engine-matrix.tsx`
- **File**: `apps/web/src/components/engine-matrix.tsx`
- **Lines 107–136**:
  ```tsx
  107:         {filteredEngines.map((eng) => {
  108:           const isOperational = eng.status === 'OPERATIONAL';
  109:           return (
  ...
  123:                   <span
  124:                     className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border ${
  125:                       isOperational
  126:                         ? 'bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 border-green-200 dark:border-green-800'
  127:                         : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800'
  128:                     }`}
  129:                   >
  130:                     {isOperational ? (
  131:                       <CheckCircle2 className="h-3 w-3" />
  132:                     ) : (
  133:                       <AlertCircle className="h-3 w-3" />
  134:                     )}
  135:                     {eng.status}
  136:                   </span>
  ```
- **Finding**:
  1. If the API fails, `isOperational` is `true` for all 18 engines because `eng.status === 'OPERATIONAL'`, displaying 18 green checkmarks (`<CheckCircle2 />`).
  2. The component provides zero error alert banner, zero connection status indication, and no user-actionable retry prompt when the query fails.
  3. Status styling is binary (`isOperational ? green : amber`) and fails to handle `OFFLINE` or `UNKNOWN` or `STANDBY` with designated semantic tokens, distinct icons, or ARIA labels.

#### Observation 1.1.4 — Existing Facade Checker Gate in `scripts/check-no-production-facades.mjs`
- **File**: `scripts/check-no-production-facades.mjs`
- **Lines 18–55**:
  ```javascript
  const CHECKS = [
    {
      name: 'Zero MOCK_FINDINGS in Web source',
      dir: path.join(ROOT_DIR, 'apps', 'web', 'src'),
      pattern: /\bMOCK_FINDINGS\b/,
      forbidden: true,
    },
    {
      name: 'Zero MOCK_PROJECTS in Web source',
      dir: path.join(ROOT_DIR, 'apps', 'web', 'src'),
      pattern: /\bMOCK_PROJECTS\b/,
      forbidden: true,
    },
    {
      name: 'Zero browser alert() in Web source',
      dir: path.join(ROOT_DIR, 'apps', 'web', 'src'),
      pattern: /\balert\s*\(/,
      forbidden: true,
    },
    {
      name: 'No POSTGRES_HOST_AUTH_METHOD: trust in docker-compose.coolify.yml',
      file: path.join(ROOT_DIR, 'docker-compose.coolify.yml'),
      pattern: /POSTGRES_HOST_AUTH_METHOD\s*:\s*trust/,
      forbidden: true,
    },
    {
      name: 'ClamAV service declared in docker-compose.coolify.yml',
      file: path.join(ROOT_DIR, 'docker-compose.coolify.yml'),
      pattern: /clamav\s*:/,
      forbidden: false, // Required to be present!
    },
    {
      name: 'Argon2id password hashing in AuthService',
      file: path.join(ROOT_DIR, 'apps', 'api', 'src', 'modules', 'auth', 'auth.service.ts'),
      pattern: /@node-rs\/argon2/,
      forbidden: false, // Required to be present!
    },
  ];
  ```
- **Finding**: Currently, `scripts/check-no-production-facades.mjs` tests for mocks, raw alerts, Postgres trust, ClamAV declaration, and Argon2id. It does **not** assert that `engine-matrix.tsx` avoids static fallback to `OPERATIONAL` or that it renders offline/unknown states.

---

### 1.2 Requirement R7: Playwright E2E Test Suite & Known-Bad SAP Golden Fixture

#### Observation 1.2.1 — Playwright Package & Configuration Status
- **Root `package.json` (`H:/erppreflight/package.json`)**:
  - `devDependencies` contains only `@types/node`, `rimraf`, `turbo`, and `typescript`.
  - `@playwright/test` is **not installed** anywhere in the monorepo.
  - No `test:e2e` script exists in `package.json`.
- **`playwright.config.ts`**:
  - Does **not exist** in `H:/erppreflight/` or any subdirectory.
- **`tests/` Directory Structure**:
  - `tests/` currently contains:
    - `empirical_challenge_m1_it2.py`, `empirical_fuzz_stress.py`, `empirical_redaction_stress.py`.
    - `tests/e2e/`: Contains only Python test files (`test_tier1_features.py`, `test_tier2_boundaries.py`, `test_tier3_combinations.py`, `test_tier4_scenarios.py`, `contracts.py`, `evaluators.py`, `runner.py`, `conftest.py`).
    - There are **zero** Playwright spec files (`*.spec.ts`) in the repository.

#### Observation 1.2.2 — Known-Bad SAP Golden Fixture Status
- **File**: `tests/fixtures/known_bad_billing_opd.xml`
  - Does **not exist**. The directory `tests/fixtures/` does not exist (only `tests/e2e/fixtures/opd/` exists, containing JSON fixtures: `opd_po_valid.json`, `opd_po_missing_recipient.json`, `opd_shadowed_rule.json`).
- **Python Engine**: `services/analysis-python/src/engines/opd_guard.py`
  - **Line 30**:
    ```python
    supported_artifact_types = [ArtifactType.CSV, ArtifactType.XLSX, ArtifactType.JSON]
    ```
    `ArtifactType.XML` is **not supported** by `OPDGuardEngine`.
  - **Lines 126–211 (`_parse_inputs`)**:
    Parses JSON, CSV, and XLSX. Has **zero XML parsing logic**. If an XML artifact is provided, `tables` and `scenario` remain empty `{}`.
  - **Line 629**:
    ```python
    fail_finding = Finding(
        rule_id="OPD_STEP_FAILED",
        severity=Severity.MAJOR if step in ("Output Type", "Channel") else Severity.CRITICAL,
        ...
    ```
    When step determination fails, `opd_guard.py` emits `rule_id="OPD_STEP_FAILED"`, **not** `OPD_DETERMINATION_STEP_MISSING`.

#### Observation 1.2.3 — Defused XML Parser Availability
- **File**: `services/analysis-python/src/parsers/safe_xml.py`
  - Defines `SafeXmlParser.parse_string(xml_text)` returning `LineElement` with `sourceline` and `sourcecolumn`.
  - Already used by `api_change.py`, `software_collection.py`, and `transport_dependency.py`.
  - Can be leveraged immediately in `opd_guard.py` to parse XML and retain exact source line coordinates.

#### Observation 1.2.4 — Current Web App & Ingestion Flow for E2E
- **Auth Routes**:
  - `apps/web/src/app/login/page.tsx` and `apps/web/src/app/signup/page.tsx` do not exist yet (Requirement R4).
- **Projects**:
  - `apps/web/src/app/projects/page.tsx` has project list and "New Project" modal supporting target release selection (e.g. `S4H_2023`).
- **Artifacts Tab**:
  - `apps/web/src/app/projects/[id]/page.tsx` line 378 has an empty placeholder with no file upload input (Requirement R1).
- **Analysis Execution**:
  - `apps/web/src/app/projects/[id]/page.tsx` line 80 triggers `triggerAnalysis({ projectId, engineTypes, targetRelease })` without passing `artifactS3Key`.
  - `apps/api/src/modules/jobs/jobs.service.ts` line 86 executes analysis synchronously/in-process via `this.runEngines(...)` without BullMQ (Requirement R2).
- **Findings Ledger**:
  - `apps/web/src/app/projects/[id]/findings/page.tsx` renders `DataTable` with `findingColumns` and `FindingDetailRow` displaying SHA-256 hash, line number, and snippets.
- **Executive Dashboard**:
  - `apps/web/src/app/page.tsx` lines 106–113 renders `Clean Core Index` from `summary.cleanCoreIndex` (computed by `findings.service.ts:200` based on findings penalty).

---

## 2. Logic Chain

### 2.1 Logic Chain for Requirement R6
1. **Premise 1**: In `apps/web/src/components/engine-matrix.tsx:24`, `engines` is assigned `engineData?.engines || ALL_18_ENGINES`.
2. **Premise 2**: In `apps/web/src/lib/api-client.ts:19-39`, every object in `ALL_18_ENGINES` hardcodes `status: 'OPERATIONAL'`.
3. **Premise 3**: In `apps/web/src/components/engine-matrix.tsx:107-136`, status badges check `eng.status === 'OPERATIONAL'` to render green badges with `<CheckCircle2 />`.
4. **Deduction 1**: Whenever `fetchEngineStatus` fails (API down, network offline, 500 error), `engineData` is undefined, causing the component to display all 18 engines as green and `OPERATIONAL`. This violates Cardinal Axiom 1 (prohibiting production facades and fake operational states).
5. **Deduction 2**: To comply with Cardinal Axiom 1 and Section 4 of `frontend-design-system.md`, `EngineMatrix` must:
   - Capture `isError` and `isLoading` from `useQuery`.
   - Render a prominent error/offline alert banner (`<WifiOff />`, "API Disconnected: Engine Status Unavailable") with an interactive retry prompt button (`refetch()`).
   - If rendering engine cards during an error or offline state, map engine statuses to `'UNKNOWN'` or `'OFFLINE'`, never `'OPERATIONAL'`.
   - Implement the triad representation for all status indicators: Semantic Color + Distinct Lucide Icon + Explicit Text Label + `aria-label`.
     - `OPERATIONAL`: `<CheckCircle2 />`, green tokens, `aria-label="Engine status: Operational"`
     - `DEGRADED`: `<AlertTriangle />`, amber tokens, `aria-label="Engine status: Degraded"`
     - `STANDBY`: `<Clock />`, blue tokens, `aria-label="Engine status: Standby"`
     - `OFFLINE`: `<WifiOff />`, red tokens, `aria-label="Engine status: Offline"`
     - `UNKNOWN`: `<HelpCircle />`, muted tokens, `aria-label="Engine status: Unknown"`
   - Render a loading skeleton during query load to avoid layout shifts.
6. **Deduction 3**: `scripts/check-no-production-facades.mjs` must be updated with static AST/regex rules forbidding `engineData?.engines || ALL_18_ENGINES` and asserting that `UNKNOWN` or `OFFLINE` status handling is implemented.

### 2.2 Logic Chain for Requirement R7
1. **Premise 1**: Monorepo root `package.json` contains no `@playwright/test` dependency, and no `playwright.config.ts` exists.
2. **Premise 2**: The required golden fixture `tests/fixtures/known_bad_billing_opd.xml` does not exist.
3. **Premise 3**: In `services/analysis-python/src/engines/opd_guard.py`, `supported_artifact_types` does not include `ArtifactType.XML`, and `_parse_inputs` lacks XML parsing. Furthermore, when a determination step fails, it emits `rule_id="OPD_STEP_FAILED"` instead of `OPD_DETERMINATION_STEP_MISSING`.
4. **Deduction 1**: Uploading an XML fixture to `OPDGuardEngine` today will result in zero findings because the parser ignores XML.
5. **Deduction 2**: For R7 to succeed, `OPDGuardEngine` in `services/analysis-python/src/engines/opd_guard.py` must:
   - Add `ArtifactType.XML` to `supported_artifact_types`.
   - Parse XML using `SafeXmlParser` (`src.parsers.safe_xml`), populating `scenario`, `tables`, and `source_lines` (using `LineElement.sourceline`).
   - Emit `rule_id="OPD_DETERMINATION_STEP_MISSING"` when a determination step fails (e.g. Channel determination missing for `BillingType=F2`).
6. **Deduction 3**: A golden defective fixture `tests/fixtures/known_bad_billing_opd.xml` must be created containing an S/4HANA billing scenario (`BillingType=F2`) with an OPD table where the `Channel` determination step fails or lacks an email rule.
7. **Deduction 4**: Playwright E2E harness requires:
   - Adding `@playwright/test` to root `devDependencies`.
   - Creating `playwright.config.ts` configuring `baseURL: 'http://localhost:3000'` and test directory `tests/e2e`.
   - Creating `tests/e2e/preflight-pipeline.spec.ts` executing the end-to-end user journey:
     1. Signup/Login -> session cookie verification
     2. Create S/4HANA 2023 project workspace
     3. Upload `known_bad_billing_opd.xml` in Artifact Dropzone
     4. Launch `OPD_GUARD` preflight analysis -> await BullMQ completion
     5. Assert findings count >= 1 and rule ID is `OPD_DETERMINATION_STEP_MISSING`
     6. Assert evidence contains file pointer `known_bad_billing_opd.xml#Channel` and non-empty SHA-256 hash
     7. Assert finding appears in Findings Ledger and Executive Dashboard Clean Core Index updates.

---

## 3. Caveats

1. **Service Boundaries**: Running the full Playwright E2E test requires `web` (3000), `api` (3001), `analysis-python` (8000), PostgreSQL (5432), and Redis (6379) to be active. If executing in CI without live containers, Playwright can utilize mock route fixtures or webServer config.
2. **Backward Compatibility of Rule IDs**: `services/analysis-python/tests/unit/test_domain1_engines.py:250` asserts `f.rule_id == "OPD_STEP_FAILED"`. When updating `opd_guard.py` to emit `OPD_DETERMINATION_STEP_MISSING`, ensure either:
   - Both rule IDs are accepted, or
   - `test_domain1_engines.py` is updated in lockstep, or
   - `OPD_DETERMINATION_STEP_MISSING` is used specifically for missing step/channel failures in XML artifacts.
3. **No-Dependency-Soup Constraint**: Adding `@playwright/test` must strictly adhere to the No-Dependency-Soup policy. Only `@playwright/test` should be added; competing frameworks (Cypress, Selenium) are forbidden.

---

## 4. Conclusion & Concrete Architectural Specifications

### 4.1 R6 Proposed Implementation Blueprint

#### File 1: `apps/web/src/lib/api-client.ts`
1. Update `EngineStatusItem`:
   ```typescript
   export interface EngineStatusItem {
     id: string;
     name: string;
     domain: string;
     status: 'OPERATIONAL' | 'DEGRADED' | 'STANDBY' | 'OFFLINE' | 'UNKNOWN';
     rulesCount: number;
     description: string;
     supportedArtifactTypes?: string[];
     version?: string;
   }
   ```
2. Export `CANONICAL_ENGINES` metadata without hardcoding `OPERATIONAL`:
   ```typescript
   export const CANONICAL_ENGINES: Omit<EngineStatusItem, 'status'>[] = [
     { id: 'OPD_GUARD', name: 'OPD Guard', domain: 'Output & Extensibility', rulesCount: 8, description: 'S/4HANA Output Parameter Determination rules & BRFplus' },
     ...
   ];
   ```
3. Update `ALL_18_ENGINES` fallback status to `'UNKNOWN'` (never `'OPERATIONAL'`):
   ```typescript
   export const ALL_18_ENGINES: EngineStatusItem[] = CANONICAL_ENGINES.map((eng) => ({
     ...eng,
     status: 'UNKNOWN',
   }));
   ```

#### File 2: `apps/web/src/components/engine-matrix.tsx`
1. Handle `isError`, `isLoading`, and `isFetching` from `useQuery`.
2. Render offline/disconnected alert banner when `isError || !engineData`:
   ```tsx
   {isError && (
     <div className="mb-5 p-4 rounded-xl border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40 text-red-800 dark:text-red-200 flex items-center justify-between gap-4">
       <div className="flex items-center gap-2.5">
         <WifiOff className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
         <div>
           <h4 className="text-xs font-bold uppercase tracking-wider">Analysis Services Offline</h4>
           <p className="text-xs text-red-700 dark:text-red-300">
             Unable to verify engine operational status. Deterministic rules are offline or status is unknown.
           </p>
         </div>
       </div>
       <button
         onClick={() => refetch()}
         disabled={isFetching}
         className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-100 rounded-lg text-xs font-semibold hover:bg-red-200 transition-colors"
       >
         <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
         Retry Connection
       </button>
     </div>
   )}
   ```
3. If `isError`, map fallback engines to `status: 'OFFLINE'` or `status: 'UNKNOWN'`.
4. Render status badges with full WCAG 2.2 AA triad:
   ```tsx
   const statusConfig: Record<string, { icon: React.ComponentType<{ className?: string }>; classes: string; label: string }> = {
     OPERATIONAL: { icon: CheckCircle2, classes: 'bg-green-50 text-green-700 dark:bg-green-950/60 dark:text-green-300 border-green-200 dark:border-green-800', label: 'Operational' },
     DEGRADED: { icon: AlertTriangle, classes: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800', label: 'Degraded' },
     STANDBY: { icon: Clock, classes: 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border-blue-200 dark:border-blue-800', label: 'Standby' },
     OFFLINE: { icon: WifiOff, classes: 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300 border-red-200 dark:border-red-800', label: 'Offline' },
     UNKNOWN: { icon: HelpCircle, classes: 'bg-muted text-muted-foreground border-border', label: 'Unknown' },
   };
   ```

#### File 3: `scripts/check-no-production-facades.mjs`
Add checks to `CHECKS` array:
```javascript
  {
    name: 'No static OPERATIONAL engine matrix fallback in engine-matrix.tsx',
    file: path.join(ROOT_DIR, 'apps', 'web', 'src', 'components', 'engine-matrix.tsx'),
    pattern: /engineData\?\.engines\s*\|\|\s*ALL_18_ENGINES/,
    forbidden: true,
  },
  {
    name: 'EngineMatrix handles offline or unknown state with retry prompt',
    file: path.join(ROOT_DIR, 'apps', 'web', 'src', 'components', 'engine-matrix.tsx'),
    pattern: /(?:UNKNOWN|OFFLINE)/,
    forbidden: false, // Required to be present!
  },
```

---

### 4.2 R7 Proposed Implementation Blueprint

#### 1. Add `@playwright/test` and `playwright.config.ts`
- In monorepo root `package.json`:
  - `devDependencies`: `"@playwright/test": "^1.50.0"`
  - `scripts`: `"test:e2e": "playwright test"`
- Create `playwright.config.ts`:
  ```typescript
  import { defineConfig, devices } from '@playwright/test';

  export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.ts',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: 'html',
    use: {
      baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
    },
    projects: [
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      },
    ],
  });
  ```

#### 2. Golden Defective Fixture: `tests/fixtures/known_bad_billing_opd.xml`
Create `tests/fixtures/known_bad_billing_opd.xml`:
```xml
<?xml version="1.0" encoding="utf-8"?>
<OutputParameterDetermination>
  <Scenario>
    <BillingType>F2</BillingType>
    <SalesOrganization>1000</SalesOrganization>
    <DistributionChannel>10</DistributionChannel>
    <Division>00</Division>
    <CustomerNumber>100045</CustomerNumber>
  </Scenario>
  <DecisionTables>
    <Table name="Output Type">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>BILLING_DOCUMENT</RESULT>
      </Row>
    </Table>
    <Table name="Receiver">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>BP_100045</RESULT>
      </Row>
    </Table>
    <Table name="Channel">
      <!-- Defect: No rule matches BillingType 'F2'. Only 'RE' is configured. Email channel determination step fails! -->
      <Row>
        <COND_BillingType>RE</COND_BillingType>
        <RESULT>EMAIL</RESULT>
      </Row>
    </Table>
    <Table name="Printer">
      <Row>
        <COND_BillingType>*</COND_BillingType>
        <RESULT>LP01</RESULT>
      </Row>
    </Table>
    <Table name="Email Recipient">
      <Row>
        <COND_CustomerNumber>100045</COND_CustomerNumber>
        <RESULT>billing@customer45.com</RESULT>
      </Row>
    </Table>
    <Table name="Email Sender">
      <Row>
        <COND_SalesOrganization>1000</COND_SalesOrganization>
        <RESULT>invoicing@acme.corp</RESULT>
      </Row>
    </Table>
    <Table name="Form Template">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>SD_INVOICE_DEFAULT</RESULT>
      </Row>
    </Table>
    <Table name="Output Relevance">
      <Row>
        <COND_BillingType>F2</COND_BillingType>
        <RESULT>TRUE</RESULT>
      </Row>
    </Table>
  </DecisionTables>
</OutputParameterDetermination>
```

#### 3. Python `opd_guard.py` Engine Extension
In `services/analysis-python/src/engines/opd_guard.py`:
1. Add `ArtifactType.XML` to `supported_artifact_types`:
   ```python
   supported_artifact_types = [ArtifactType.CSV, ArtifactType.XLSX, ArtifactType.JSON, ArtifactType.XML]
   ```
2. In `_parse_inputs()`, parse XML using `SafeXmlParser`:
   ```python
   from src.parsers.safe_xml import SafeXmlParser

   def _parse_xml_content(self, xml_text: str) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, str], Dict[str, Dict[int, int]]]:
       root = SafeXmlParser.parse_string(xml_text)
       scenario = {}
       tables = {}
       source_lines = {}

       scen_elem = root.find("Scenario")
       if scen_elem is not None:
           for child in scen_elem:
               scenario[child.tag] = (child.text or "").strip()

       tables_elem = root.find("DecisionTables")
       if tables_elem is not None:
           for table_elem in tables_elem.findall("Table"):
               t_name = self._normalize_step_name(table_elem.attrib.get("name", ""))
               rows = []
               lines = {}
               for idx, row_elem in enumerate(table_elem.findall("Row")):
                   row_dict = {}
                   line_no = getattr(row_elem, "sourceline", idx + 1)
                   for col in row_elem:
                       row_dict[col.tag] = (col.text or "").strip()
                   rows.append(row_dict)
                   lines[idx] = line_no
               tables[t_name] = rows
               source_lines[t_name] = lines

       return tables, scenario, source_lines
   ```
3. In `_execute_pipeline()`, when a step determination fails:
   ```python
   fail_finding = Finding(
       rule_id="OPD_DETERMINATION_STEP_MISSING",
       severity=Severity.MAJOR if step in ("Output Type", "Channel") else Severity.CRITICAL,
       category="Output Determination",
       title=f"{step} Determination Failed",
       description=f"Output determination stalled at step '{step}'. No decision table rule matched the document scenario: {missing_cond}",
       confidence=ConfidenceClass.VERIFIED,
       confidence_score=1.0,
       remediation=f"Add a decision table entry in BRFplus table '{step}' matching document parameters.",
       evidence=[
           Evidence(
               artifact_path=f"{artifact_path}#{step}",
               line_number=source_lines.get(step, {}).get(0, 1),
               snippet=f"Step '{step}' evaluated against scenario: {json.dumps(scenario)}",
               sha256=artifact_hash,
               provenance=ConfidenceClass.VERIFIED,
               trust_score=1.0,
           )
       ],
       technical_details={"step": step, "scenario": scenario, "missingCondition": missing_cond},
       affected_objects=[f"OPD_STEP_{step.upper().replace(' ', '_')}"],
   )
   ```

#### 4. Playwright E2E Spec: `tests/e2e/preflight-pipeline.spec.ts`
Implements the 7-stage assertion pipeline:
1. `POST /api/v1/auth/register` (or UI `/signup`) -> creates tenant session.
2. Navigate `/projects` -> click "New Project" -> create `S4H_2023` project.
3. Open project workspace `/projects/{id}` -> switch to Artifact Dropzone -> upload `tests/fixtures/known_bad_billing_opd.xml`.
4. Switch to Analysis Launcher -> select `OPD_GUARD` -> trigger analysis.
5. Poll `/api/v1/analyses/{id}` until `status === 'COMPLETED'`.
6. Assert:
   - `findingsCount >= 1`
   - Finding rule ID is `OPD_DETERMINATION_STEP_MISSING`
   - Evidence SHA-256 is 64 hex characters and matches file hash
   - Evidence line number points to the defective step
7. Navigate to `/projects/{id}/findings` -> assert table displays finding with severity badge and expandable evidence.
8. Navigate to `/` -> assert Executive Dashboard Clean Core Index reflects finding penalty (drops below 100%).

---

## 5. Verification Method

### 5.1 R6 Verification
1. **Dynamic Matrix Failure Test**:
   - Disconnect or point `NEXT_PUBLIC_API_URL` to an unreachable port (e.g. `http://localhost:9999`).
   - Open `/` in browser.
   - **Verification Assertion**: `EngineMatrix` must NOT show 18 green `OPERATIONAL` badges. It MUST display the red/amber alert banner with retry button, and engine status badges must show `STATUS: OFFLINE` or `STATUS: UNKNOWN` with non-color icons (`WifiOff` / `HelpCircle`).
2. **Facade Gate Check**:
   ```bash
   node scripts/check-no-production-facades.mjs
   ```
   Must pass with zero violations and assert that `engine-matrix.tsx` contains no static fallback to `OPERATIONAL`.

### 5.2 R7 Verification
1. **Python Engine Verification**:
   ```bash
   py -m pytest services/analysis-python/tests/unit/test_domain1_engines.py -v
   ```
   Add a test verifying that passing `tests/fixtures/known_bad_billing_opd.xml` to `OPDGuardEngine` triggers `OPD_DETERMINATION_STEP_MISSING` with non-empty SHA-256 and valid line number.
2. **Playwright E2E Verification**:
   ```bash
   pnpm exec playwright test tests/e2e/preflight-pipeline.spec.ts
   ```
   Must execute the end-to-end user journey against local dev services and pass with 100% success rate.
3. **Monorepo Quality Gate**:
   ```bash
   pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run check:deps
   ```
   Must pass cleanly with zero TypeScript errors and zero forbidden dependencies.
