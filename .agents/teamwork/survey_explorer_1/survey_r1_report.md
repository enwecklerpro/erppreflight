# Architectural Survey & Investigation Report: Requirement R1
## Scenario & Regression Test Lab (`/projects/:id/lab`)

**Author**: `survey_explorer_1` (Teamwork Exploration Subagent)  
**Date**: 2026-09-25  
**Working Directory**: `H:/erppreflight/.agents/teamwork/survey_explorer_1`  
**Target Requirement**: R1 (Interactive Scenario & Regression Test Lab) from `ORIGINAL_REQUEST.md` (section `## 2026-09-25T03:10:02Z`)  
**Compliance Context**: Cardinal Axioms 1 & 2, AGENTS.md, Parts 05, 14, 15, and 16 of ERP Preflight Master Specifications  

---

## Executive Summary

This report delivers a comprehensive architectural survey and concrete engineering recommendations for implementing **Requirement R1: Scenario & Regression Test Lab (`/projects/:id/lab`)**. 

The goal of R1 is to provide SAP consultants and enterprise architects with an interactive test workbench where synthetic fixtures can be dynamically generated across 4 core ERP domains (OPD Output determination, ADS Form XML layouts, MFS PLC telegrams, and MATMAS change pointer deltas), executed live against the authoritative Python preflight analysis engines, and evaluated against pass/fail regression assertion ledgers with cryptographic SHA-256 evidence.

### Current Codebase Reality
1. **Frontend (`apps/web`)**: The route `apps/web/src/app/projects/[id]/lab/page.tsx` does **not** exist yet. Existing sibling project routes (`findings`, `objects`, `simulation`, `traceability`) follow Next.js 15 App Router conventions with TanStack Query, URL-synchronized filtering, and Base UI/shadcn components.
2. **Backend (`apps/api`)**: A preliminary `LabModule` exists at `apps/api/src/modules/lab/` with `lab.controller.ts`, `lab.service.ts`, `lab.module.ts`, and `dto/lab.dto.ts`. However:
   - It only exposes `/api/v1/lab/generate` and `/api/v1/lab/run` at root level; the required project-scoped endpoint `POST /api/v1/projects/:id/lab/generate` is not mapped.
   - Its current `runScenario` implementation uses rudimentary in-memory TypeScript string checking (`payload.includes(...)`) rather than dispatching to the real Python analysis engines. This violates Cardinal Axiom 2 and acceptance criteria.
   - A PostgreSQL migration (`packages/database/migrations/006_baselines_and_lab.sql`) has already created the `synthetic_scenarios` table with full Row-Level Security (RLS), but `LabService` does not yet query or persist records to it.
3. **Analysis Engines (`services/analysis-python`)**: All 4 target engines (`opd_guard.py`, `form_doctor.py`, `mfs_blackbox.py`, and `change_pointer.py`) are fully implemented, registered, and tested with golden fixtures. The stateless microservice exposes `POST /api/v1/analyze`, accepting inline `raw_content` and engine configurations.
   - **Critical Parser Alignment Finding**: The synthetic payloads previously generated in `lab.service.ts` differed from the XML/JSON/CSV structures required by the Python parsers (e.g. `opd_guard.py` expects `<OutputParameterDetermination>` with `<Scenario>` and `<DecisionTables>`, rather than generic `<decisionTable>`).

---

## Detailed Investigation Findings

### 1. Frontend Web Route & UI Components (`apps/web`)

#### 1.1 Existing Layout & Navigation Pattern
In `apps/web/src/app/projects/[id]/page.tsx`, the project detail workspace renders a top header bar with workspace ID, target release badge, action buttons (`What-If Simulation`, `Traceability Matrix`, `Launch Analysis`), and tab navigation (`overview`, `findings`, `objects`, `artifacts`, `history`, `launcher`).

Sibling project routes (`simulation/page.tsx`, `findings/page.tsx`, `traceability/page.tsx`) do not share a nested layout file; each defines its own consistent header, breadcrumb navigation, and TanStack Query state:
```tsx
<nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
  <Link href="/projects" className="hover:text-foreground transition-colors">Projects</Link>
  <ChevronRight className="size-3.5" />
  <Link href={`/projects/${projectId}`} className="hover:text-foreground transition-colors font-mono">Workspace</Link>
  <ChevronRight className="size-3.5" />
  <span className="font-semibold text-foreground">Scenario & Regression Test Lab</span>
</nav>
```

#### 1.2 Required UI Architecture for `/projects/[id]/lab/page.tsx`
To satisfy Cardinal Axiom 1 (*"A page that renders is not a completed feature"*):
1. **Domain Switcher**: Accessible tab bar for the 4 core domains:
   - `OPD` — Output Parameter Determination & BRFplus Decision Tables
   - `FORM` — Adobe Document Services (ADS) Form XML & XDP Layouts
   - `MFS` — Material Flow System PLC Telegram Sequences & Conveyor Topology
   - `CHANGE_POINTER` — Material Master (MATMAS) Change Pointer Delta Triggers
2. **Scenario Generator Control Panel**:
   - Defect type selector (`CLEAN_PASS` vs domain-specific defects: `OPD_MISSING_RECIPIENT`, `OPD_INVALID_CHANNEL`, `FORM_MISSING_BINDING`, `MFS_LOCATION_JUMP`, `MFS_ACK_TIMEOUT`, `CP_MISSING_FIELD_TRIGGER`).
   - "Generate Synthetic Scenario" button wired to TanStack Mutation (`generateScenarioMutation`).
3. **Interactive Payload Editor & Viewer**:
   - Monospaced editor/text viewer displaying the generated XML, JSON, or CSV payload.
   - Allows consultants to inspect, copy, or edit the raw payload directly before running regression tests.
   - Form state managed with dirty tracking and reset capability.
4. **Live Execution Trigger & Execution State**:
   - "Execute Preflight Test" button wired to TanStack Mutation (`runScenarioMutation`).
   - Loading skeletons and accessible spinner (`Loader2 className="animate-spin"`) during execution.
5. **Pass/Fail Regression Assertion Ledger**:
   - Metrics summary card displaying:
     - Overall Run Status badge (`PASSED`, `FAILED`, `REGRESSION_DETECTED`)
     - Verdict badge (`CLEAR`, `DEFECTS_DETECTED`)
     - Assertion counts (`Passed: X / Total: Y`)
     - Execution time (`executionTimeMs`)
     - Rules evaluated count
     - Cryptographic SHA-256 payload checksum
   - Detailed Assertion Ledger Table:
     - Rule ID & description
     - Expected result vs Actual result
     - Result indicator badge (`PASSED` with `CheckCircle2`, `FAILED` with `XCircle`, `REGRESSION` with `ShieldAlert`)
     - Accessible Severity Badge using `apps/web/src/components/findings/severity-badge.tsx` (never color alone; pairs icon + label + ARIA role)
     - Epistemic Confidence Badge using `apps/web/src/components/findings/confidence-badge.tsx` (score + class + icon)
     - Expandable evidence drawer showing snippet, line number, and SHA-256 hash.

---

### 2. Backend API Architecture & `LabModule` (`apps/api`)

#### 2.1 Existing Module Inventory
- `apps/api/src/modules/lab/` is currently structured as:
  - `lab.controller.ts`: Defines `@Controller('lab')` with `@Post('generate')` and `@Post('run')`.
  - `lab.service.ts`: Implements `generateScenario` and `runScenario`.
  - `lab.module.ts`: Imports `DatabaseModule` and exports `LabService`.
  - `dto/lab.dto.ts`: Contains `GenerateScenarioDto`, `RunScenarioDto`, `ScenarioDomain`, `ScenarioFailureType`.

#### 2.2 Endpoints Required & Route Mapping
`ORIGINAL_REQUEST.md` mandates `POST /api/v1/projects/:id/lab/generate`.
Currently, the controller is mounted at `/api/v1/lab`. To support the project workspace context, the controller should support:
- `POST /api/v1/projects/:id/lab/generate` (generates synthetic scenario bound to project)
- `POST /api/v1/projects/:id/lab/run` (executes live regression test for the project)
- `GET /api/v1/projects/:id/lab/scenarios` (retrieves saved synthetic scenarios for this workspace)
- Maintain backward-compatible root routes `POST /api/v1/lab/generate` and `POST /api/v1/lab/run`.

#### 2.3 Elimination of Mock / String-Matching Execution
In `apps/api/src/modules/lab/lab.service.ts`:
```typescript
// CURRENT INCOMPLETE IMPLEMENTATION (MOCK FACADE):
if (dto.domain === ScenarioDomain.OPD) {
  if (dto.payload.includes('RECEIVER_ROLE=""') || dto.payload.includes("RECEIVER_ROLE=''")) {
    findings.push({ ruleId: 'OPD_DETERMINATION_STEP_MISSING', ... });
  }
}
```
This is a production facade violation. Instead, `LabService` must dispatch to the real Python preflight analysis microservice, exactly as `AnalysisProcessor` does:
```typescript
const analysisUrl = this.config.get<string>('ANALYSIS_SERVICE_URL', 'http://localhost:8000');
const engineType = mapDomainToEngineType(dto.domain);
const wirePayload = {
  job_id: runId,
  tenant_id: tenantId,
  project_id: projectId,
  engine_type: engineType,
  target_release: targetRelease,
  raw_content: dto.payload,
  configuration: dto.configuration ?? {},
  options: { deterministic_only: true }
};

const res = await fetch(`${analysisUrl}/api/v1/analyze`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Tenant-Id': tenantId,
  },
  body: JSON.stringify(wirePayload),
});
```

#### 2.4 Database Persistence & RLS Integration
Migration `packages/database/migrations/006_baselines_and_lab.sql` created:
```sql
CREATE TABLE IF NOT EXISTS synthetic_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    domain VARCHAR(50) NOT NULL,
    scenario_name VARCHAR(255) NOT NULL,
    failure_type VARCHAR(100) NOT NULL DEFAULT 'CLEAN_PASS',
    payload TEXT NOT NULL,
    expected_findings JSONB NOT NULL DEFAULT '[]',
    last_run_result JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
`LabService` should leverage `this.db.query(...)` with tenant isolation context to persist generated scenarios and store `last_run_result`.

---

### 3. Python Preflight Analysis Engines & Fixture Alignment

The Python service (`services/analysis-python`) already contains hardened, deterministic implementations of all 4 engines in `services/analysis-python/src/engines/`:

| Domain | Python Engine Class | EngineType Identifier | Input Format | Rule IDs Evaluated | Golden Fixtures in `tests/fixtures/` |
|---|---|---|---|---|---|
| **OPD** | `OPDGuardEngine` (`opd_guard.py`) | `OPD_GUARD` | XML, JSON, CSV | `OPD_DETERMINATION_STEP_MISSING`<br>`OPD_CHANNEL_INACTIVE`<br>`OPD_UNREACHABLE_RULE` | `domain1/opd_scenario_missing_channel.json`<br>`domain1/opd_scenario_valid.json`<br>`tests/fixtures/known_bad_billing_opd.xml` |
| **ADS Form** | `FormDoctorEngine` (`form_doctor.py`) | `FORM_DOCTOR` | XML / XDP | `FORM_FIELD_MISSING_IN_XML`<br>`FORM_BINDING_PATH_MISMATCH`<br>`FORM_FIELD_HIDDEN_IN_LAYOUT`<br>`FORM_XDP_PARSE_ERROR` | `domain1/form_template_xdp.xml`<br>`domain1/form_data_missing_field.xml`<br>`domain1/form_data_valid.xml` |
| **MFS** | `MFSBlackBoxEngine` (`mfs_blackbox.py`) | `MFS_BLACKBOX` | JSON, CSV | `MFS_IMPOSSIBLE_TOPOLOGY_JUMP`<br>`MFS_MISSING_ACK_TIMEOUT`<br>`MFS_DUPLICATE_TELEGRAM_SEND`<br>`MFS_OUT_OF_ORDER_SEQUENCE` | `domain6/mfs_jump_stream.json`<br>`domain6/mfs_ack_retry_storm.json`<br>`domain6/mfs_normal_flow.json` |
| **Change Pointer** | `ChangePointerEngine` (`change_pointer.py`) | `CHANGE_POINTER_COVERAGE_AUDITOR` | JSON, CSV | `CP_CRITICAL_FIELD_MISSING`<br>`CP_GLOBAL_DISABLED`<br>`CP_MESSAGE_TYPE_DEACTIVATED`<br>`CP_DICTIONARY_FLAG_MISSING` | `domain3/cp_missing_field.json`<br>`domain3/cp_bd52_config.csv`<br>`domain3/cp_matmas_active.json` |

#### 3.1 Synthetic Payload Specification Alignment
For synthetic fixtures generated by `LabService` to evaluate cleanly against the Python engines without parser syntax rejections:

1. **OPD Output Scenarios**:
   - Must use the canonical `<OutputParameterDetermination>` XML schema with `<Scenario>` and `<DecisionTables><Table name="...">`:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <OutputParameterDetermination>
     <Scenario>
       <BillingType>F2</BillingType>
       <SalesOrganization>1000</SalesOrganization>
       <CustomerNumber>100045</CustomerNumber>
     </Scenario>
     <DecisionTables>
       <Table name="Output Type">
         <Row><COND_BillingType>F2</COND_BillingType><RESULT>BILLING_DOCUMENT</RESULT></Row>
       </Table>
       <Table name="Receiver">
         <Row><COND_BillingType>F2</COND_BillingType><RESULT>BP_100045</RESULT></Row>
       </Table>
       <Table name="Channel">
         <Row><COND_BillingType>RE</COND_BillingType><RESULT>EMAIL</RESULT></Row>
       </Table>
     </DecisionTables>
   </OutputParameterDetermination>
   ```
   *Defect Trigger*: When `BillingType` is `F2` in Scenario, but `Table name="Channel"` only defines `RE`, `OPDGuardEngine` deterministically pinpoints `OPD_DETERMINATION_STEP_MISSING` at the `Channel` step.

2. **ADS Form XML Scenarios**:
   - Uses Adobe LiveCycle XDP template with `<field><bind match="dataRef" ref="..."/></field>` and an associated XML runtime data context.
   - When configured in `configuration: { xdp_content, xml_content }` or combined in `raw_content`:
   ```xml
   <xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
     <template>
       <subform name="InvoiceForm" dataRef="$.Invoice">
         <field name="InvoiceNum"><bind match="dataRef" ref="$.Header.InvoiceID"/></field>
         <field name="PromoCode"><bind match="dataRef" ref="$.Header.YY1_PROMOTIONAL_CODE"/></field>
       </subform>
     </template>
   </xdp:xdp>
   ```
   With runtime XML:
   ```xml
   <Invoice>
     <Header><InvoiceID>90001234</InvoiceID></Header>
   </Invoice>
   ```
   *Defect Trigger*: `YY1_PROMOTIONAL_CODE` is bound in XDP but missing in runtime XML, deterministically triggering `FORM_FIELD_MISSING_IN_XML`.

3. **MFS Telegram Sequences**:
   - Uses structured JSON with `conveyor_edges` and `telegrams`:
   ```json
   {
     "conveyor_edges": [["CP01", "CP02"], ["CP02", "CP03"]],
     "telegrams": [
       {"timestamp": "2026-09-25T03:00:01Z", "time_sec": 1.0, "type": "MOVE", "hu_id": "HU_9901", "cp": "CP01", "seq_no": 1},
       {"timestamp": "2026-09-25T03:00:02Z", "time_sec": 2.0, "type": "MOVE", "hu_id": "HU_9901", "cp": "CP05", "seq_no": 2}
     ]
   }
   ```
   *Defect Trigger*: `HU_9901` jumps from `CP01` to `CP05` without conveyor path, deterministically triggering `MFS_IMPOSSIBLE_TOPOLOGY_JUMP`.

4. **Change Pointer Delta Scenarios**:
   - Uses structured JSON or BD52 CSV:
   ```json
   {
     "message_type": "MATMAS",
     "bd61_active": true,
     "bd50_msg_types": ["MATMAS"],
     "bd52_fields": [["MARA", "MATNR"], ["MARA", "MEINS"]],
     "expected_fields": [["MARA", "MATNR"], ["MARA", "MEINS"], ["MARA", "BRGEW"]]
   }
   ```
   *Defect Trigger*: Business-critical gross weight `MARA-BRGEW` is omitted from `bd52_fields`, deterministically triggering `CP_CRITICAL_FIELD_MISSING`.

---

### 4. Schemas & Assertion Ledger Data Structures

#### 4.1 Required Domain Contracts (`@erppreflight/schemas`)
Create `packages/schemas/src/lab.ts` exporting:

```typescript
export const ScenarioDomainEnum = z.enum([
  'OPD',
  'FORM',
  'MFS',
  'CHANGE_POINTER',
]);
export type ScenarioDomain = z.infer<typeof ScenarioDomainEnum>;

export const ScenarioFailureTypeEnum = z.enum([
  'CLEAN_PASS',
  'OPD_MISSING_RECIPIENT',
  'OPD_INVALID_CHANNEL',
  'OPD_SHADOWED_RULE',
  'FORM_MISSING_BINDING',
  'FORM_BINDING_MISMATCH',
  'MFS_LOCATION_JUMP',
  'MFS_ACK_TIMEOUT',
  'CP_MISSING_FIELD_TRIGGER',
  'CP_GLOBAL_DISABLED',
]);
export type ScenarioFailureType = z.infer<typeof ScenarioFailureTypeEnum>;

export const SyntheticScenarioSchema = z.object({
  scenarioId: z.string().uuid(),
  domain: ScenarioDomainEnum,
  scenarioName: z.string(),
  failureType: ScenarioFailureTypeEnum,
  payload: z.string(),
  format: z.enum(['xml', 'json', 'csv']),
  expectedFindings: z.array(
    z.object({
      ruleId: z.string(),
      severity: SeverityEnum,
      description: z.string(),
    })
  ),
  createdAt: z.string().datetime().optional(),
});

export const LabAssertionItemSchema = z.object({
  ruleId: z.string(),
  severity: SeverityEnum,
  title: z.string(),
  passed: z.boolean(),
  expected: z.boolean(),
  actual: z.boolean(),
  evidenceSha256: z.string(),
  confidenceClass: ConfidenceClassEnum,
  evidenceSnippet: z.string().optional(),
  lineNumber: z.number().int().optional(),
});

export const LabRunAssertionResultSchema = z.object({
  runId: z.string().uuid(),
  domain: ScenarioDomainEnum,
  engineType: EngineTypeEnum,
  executedAt: z.string().datetime(),
  overallStatus: z.enum(['PASSED', 'FAILED', 'REGRESSION_DETECTED']),
  verdict: z.enum(['CLEAR', 'DEFECTS_DETECTED']),
  assertionsCount: z.number().int().nonnegative(),
  passedAssertions: z.number().int().nonnegative(),
  failedAssertions: z.number().int().nonnegative(),
  executionTimeMs: z.number().int().nonnegative(),
  rulesEvaluated: z.number().int().nonnegative(),
  payloadSha256: z.string(),
  assertions: z.array(LabAssertionItemSchema),
  findings: z.array(FindingSchema),
});
```

---

## Actionable Recommendations & Implementation Roadmap

1. **Phase 1: Domain Contracts & Schemas**
   - Create `packages/schemas/src/lab.ts` with Zod domain schemas.
   - Export from `packages/schemas/src/index.ts`.
   - Update `apps/api/src/modules/lab/dto/lab.dto.ts` to inherit/validate via Zod.

2. **Phase 2: Backend `LabService` Hardening & Live Engine Dispatch**
   - In `apps/api/src/modules/lab/lab.controller.ts`:
     - Add routes for `@Controller('projects/:id/lab')` (or multi-path controller).
     - Endpoints: `POST /api/v1/projects/:id/lab/generate`, `POST /api/v1/projects/:id/lab/run`, `GET /api/v1/projects/:id/lab/scenarios`.
   - In `apps/api/src/modules/lab/lab.service.ts`:
     - Inject `ConfigService` and `DatabaseService`.
     - Update synthetic fixture templates to match canonical schemas of `OPDGuardEngine`, `FormDoctorEngine`, `MFSBlackBoxEngine`, and `ChangePointerEngine`.
     - In `runScenario()`, dispatch HTTP POST to `${analysisUrl}/api/v1/analyze`, parsing the response through `AnalysisJobResponseSchema`.
     - Calculate pass/fail regression assertion outcomes comparing expected vs actual findings.
     - Persist generated scenarios and last run results to `synthetic_scenarios` table with tenant isolation.

3. **Phase 3: Frontend Web UI (`apps/web`)**
   - In `apps/web/src/lib/api-client.ts`: Add `generateLabScenario()`, `runLabScenario()`, `fetchLabScenarios()`.
   - In `apps/web/src/app/projects/[id]/page.tsx`: Add a navigation action button or tab link to `/projects/${project.id}/lab`.
   - Create `apps/web/src/app/projects/[id]/lab/page.tsx`:
     - Header, breadcrumb navigation, domain tabs.
     - Generator control panel with failure type selectors.
     - Payload editor (monospaced, editable, copy/reset).
     - Live execution trigger with TanStack Mutation.
     - Regression Assertion Ledger table with `SeverityBadge` and `ConfidenceBadge` (non-color severity indicators).
     - Error boundaries, empty states, and retry buttons.

4. **Phase 4: Automated Verification**
   - Add unit tests in `apps/api/src/modules/lab/lab.service.spec.ts` verifying scenario generation and live engine dispatch.
   - Run `pnpm run check:deps` to confirm zero forbidden duplicate libraries.
   - Run `pnpm run check:no-production-facades` to verify no mock facades.
   - Verify `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, and `pnpm run test:python`.
