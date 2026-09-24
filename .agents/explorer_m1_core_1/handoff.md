# Technical Design Blueprint: Core Engine, Evidence, Security & Tenancy Playbooks

**Agent**: `explorer_m1_core_1` (`teamwork_preview_explorer`)  
**Workspace**: `H:/erppreflight/.agents/explorer_m1_core_1`  
**Parent**: `66440be0-c7ee-4a74-8a17-61e13b963df1` (`parent`)  
**Timestamp**: 2026-09-24T03:02:00Z  
**Milestone**: Milestone 1 (Repository Agent Skills — Core Engine, Evidence, Security & Tenancy)  
**Deliverable Target**: Specifications for `/.agents/skills/` playbooks:
1. `engine-authoring.md` (Part 22.4)
2. `sap-evidence.md` (Part 22.5)
3. `release-aware-knowledge.md` (Part 22.6)
4. `secure-file-parser.md` (Part 22.7)
5. `multi-tenant-security.md` (Part 22.8)

---

## 1. Observation

Direct, verifiable observations gathered from the authoritative repository codebase and specifications:

1. **Repository Layout and Ground Truth**:
   - `22_REPOSITORY_AGENT_SKILLS_PLAYBOOKS.md` defines 26 skill areas; lines 50–112 mandate `engine-authoring` (22.4), `sap-evidence` (22.5), `release-aware-knowledge` (22.6), `secure-file-parser` (22.7), and `multi-tenant-security` (22.8).
   - `17_TRUST_AI_KNOWLEDGE_RELEASE_GOVERNANCE.md` mandates the canonical support matrix (§17.1), engine certification packs (§17.2), immutable knowledge snapshots (§17.3), rule bundle versioning (§17.4), the 5-stage promotion pipeline (`Draft → Review → Staging → Canary → Production`, §17.5), shadow evaluation (§17.6), finding stability (§17.9), and data lineage (§17.11).
   - `packages/evidence/src/classifier.ts` implements `classifyProvenance(options)` enforcing:
     * Missing mandatory evidence demotes finding confidence to `UNKNOWN` with score `0.30` (line 17).
     * LLM outputs can NEVER exceed `INFERRED` with score `0.60` (line 21).
     * Exact parser or AST match yields `VERIFIED` with score `1.0` (line 27).
     * Deterministic rule yields `RULE_DERIVED` with score `0.85` (line 32).
     * Trust score formula: $\text{Trust}_{\text{composite}} = \max(T_k) \times (1 - \prod_{k=1}^n (1 - 0.2 \cdot T_k))$ bounded by $\max(T_k)$ (lines 51–66).
     * Trust score constants: Official Metadata `1.0`, Official Docs `0.95`, Support Notes `0.90`, Curated Rule `0.85`, Community `0.70`, Third Party `0.60`, Customer Evidence `0.50`, Inferred `0.30` (lines 39–48).
   - `packages/schemas/src/finding.ts` and `evidence.ts` define runtime Zod schemas: `BaseFindingSchema`, `FindingSchema`, `BaseEvidenceItemSchema`, `EvidenceSourceOffsetSchema` with line/column/byte offsets, and `ReleaseAlignmentEnum` (`RELEASE_ALIGNED`, `RELEASE_PREMATURE`, `RELEASE_DEPRECATED`, `FAMILY_MISMATCH`, `UNKNOWN`).
   - `packages/database/src/rls.ts` defines `setTenantSession(client, tenantId, isLocal)` configuring PostgreSQL session variable `app.current_tenant_id` and `withTenantTransaction(pool, tenantId, callback)` managing transaction isolation.
   - `services/analysis-python/src/parsers/safe_xml.py` configures `defusedxml.ElementTree` with `forbid_dtd=True, forbid_entities=True, forbid_external=True`, raising `SecurityViolationError` on DTD/entity detection.
   - `services/analysis-python/src/platform/redaction.py` implements `SecretRedactionEngine` executing Shannon entropy scoring (hex >= 32 chars with entropy >= 3.2; base64 >= 20 chars with entropy >= 4.5), regex patterns for SAP RFC passwords/parameters, and HMAC-based deterministic masking (`[REDACTED:SECRET:<hmac_sha256>]`).

---

## 2. Comprehensive Technical Blueprints for the 5 Playbooks

### 2.1 Playbook 1: `engine-authoring.md`

- **Canonical File Path**: `/.agents/skills/engine-authoring.md`
- **Applicable Domains**: All 18 SAP Preflight Engines (`OPD_GUARD`, `FORM_DOCTOR`, `CUSTOM_FIELD_FLOW_DOCTOR`, `EXTENSION_IMPACT_GUARD`, `SPRO2CLOUD`, `ECC2CLOUD_NAVIGATOR`, `SAP_GAP_RADAR`, `CLEAN_CORE_OBJECT_GUARD`, `CHANGE_POINTER_COVERAGE_AUDITOR`, `API_CHANGE_GUARD`, `SOFTWARE_COLLECTION_DEPENDENCY_GUARD`, `TRANSPORT_DEPENDENCY_ANALYZER`, `SAFE_DECOMMISSION_PREFLIGHT`, `FIORI_403_ROOT_CAUSE_DOCTOR`, `WORKFLOW_STUCK_EXPLAINER`, `IAM_COST_OPTIMIZER`, `ACCOUNT_DETERMINATION_PREFLIGHT`, `SYSTEM_REFRESH_DELTA_GUARD`, `MFS_BLACKBOX`).
- **Trigger**: Any implementation, modification, refactoring, or testing of an analysis engine or parser in `services/analysis-python` or TypeScript analysis packages.

#### 2.1.1 Document Structure & Required Sections
The playbook file must contain exactly the following sections in order:
1. `# SAP Preflight Engine Authoring & Execution Standard Playbook`
2. `## 1. Overview & Operational Philosophy`
3. `## 2. The 14-Point Engine Anatomy Specification`
4. `## 3. Deterministic AST / DOM / Rule Logic Principles`
5. `## 4. Provenance & The 4 Confidence Classes`
6. `## 5. Standardized Finding Codes & Taxonomy`
7. `## 6. Cryptographic Evidence Schema & Pointer Resolution`
8. `## 7. Golden Fixtures & Testing Methodology`
9. `## 8. Python Reference Implementation Architecture`
10. `## 9. Non-Negotiable Engine Invariants`
11. `## 10. Forbidden Anti-Patterns`

#### 2.1.2 The 14-Point Engine Anatomy
Every engine in ERP Preflight must adhere to the 14-point structure without exception:

| Point | Component | Requirement & Technical Implementation |
|---|---|---|
| **1** | **Metadata** | Unique `engine_type` from `EngineTypeEnum`, human-readable name, domain classification, semantic `version` string (e.g. `2.1.0`), supported target releases (`TargetReleaseEnum`), and supported artifact types (`ArtifactTypeEnum`). |
| **2** | **Input Schema** | Strict runtime schema validation (Pydantic model in Python, Zod in TS). Rejects missing or extra fields before execution. Never accept unvalidated JSON. |
| **3** | **Parser / Normalizer** | Memory-bounded artifact parser transforming raw text, XML, JSON, or CSV into typed domain structures with exact line, column, and byte offset tracking. |
| **4** | **Deterministic Analysis** | Pure, rule-based AST, DOM, or tabular evaluations. Given identical input bytes and rule versions, the output MUST be bitwise identical. Zero network I/O, zero random seed drift. |
| **5** | **Finding Codes** | Namespaced identifier following `<ENGINE>_<CATEGORY>_<SPECIFIC_DEFECT>` (e.g. `OPD_DETERMINATION_STEP_MISSING`, `CLEAN_CORE_TIER3_DIRECT_DB_MUTATION`). |
| **6** | **Evidence Items** | Every finding must attach one or more `EvidenceItem` structures containing artifact path, line/col numbers, exact snippet, context preview, SHA-256 hash, and source trust score. |
| **7** | **Confidence Classifier** | Enforces the 4 confidence classes (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`). Absence of evidence automatically demotes to `UNKNOWN`. |
| **8** | **Fixtures** | Curated minimal test artifacts: at least one positive fixture (compliant/clean), one negative fixture (defect triggered), and one edge-case fixture (malformed, empty, or boundary). |
| **9** | **Tests** | Automated test suite in `pytest` (Python) or Vitest (TS) testing all rules, line offset extraction, and error conditions with 100% pass rate. |
| **10** | **Generated / Property Tests** | Property-based tests via `Hypothesis` (Python) or `fast-check` (TS) providing fuzz inputs to prove the engine fails closed without uncaught crashes. |
| **11** | **Metrics & Telemetry** | Execution duration, memory footprint, rule evaluation count, finding count by severity, unknown rate, and total bytes processed recorded per run. |
| **12** | **Project / Report Integration** | Finding output serializable to `FindingWireSchema` / `BaseFindingSchema` for database storage and client report generation. |
| **13** | **Admin Trust Center Visibility** | Health check endpoints, rule bundle version reporting, and quality status exposed to the admin monitoring service. |
| **14** | **Documentation & Runbook** | Markdown documentation detailing rule logic, SAP note references, Clean Core justification, and step-by-step remediation guide. |

#### 2.1.3 Confidence Scoring Matrix
The engine must classify every finding using the 4 canonical classes:

| Confidence Class | Numerical Score | Criterion & Source Qualification | Engine Usage Rule |
|---|---|---|---|
| **`VERIFIED`** | `1.0` | Exact AST node match, direct DOM element match, or verified configuration table entry. Cryptographically validated. | Direct parser matches (e.g. SmartForm XML node detected, direct DB table write in ABAP AST). |
| **`RULE_DERIVED`** | `0.85` | Deterministic domain rule evaluation combining multiple verified facts or deterministic logic trees. | Standard preflight rules (e.g. SPRO node missing corresponding CBC activity in target 2408). |
| **`INFERRED`** | `0.60` | Heuristic correlation, statistical pattern match, or secondary AI explanation assistance. | AI Problem Router suggestions or heuristic transport dependency ordering. **LLMs are capped here.** |
| **`UNKNOWN`** | `0.30` | Incomplete customer export, missing mandatory evidence, ambiguous release family, or unverified rule. | Missing evidence or partial artifact exports. Never claim supported/unsupported without evidence. |

#### 2.1.4 Code Implementation Pattern (Python Reference)

```python
# services/analysis-python/src/engines/opd_guard.py
import hashlib
from typing import List, Dict, Any
from pydantic import BaseModel, Field
from src.core.base_engine import BaseEngine
from src.models.enums import EngineType, ArtifactType, Severity, ConfidenceClass
from src.models.finding import Finding
from src.models.evidence import EvidenceItem, EvidenceSourceOffset
from src.parsers.safe_xml import SafeXmlParser
from src.platform.confidence import classify_provenance

class OpdRulePayload(BaseModel):
    artifact_path: str
    target_release: str
    content: str

class OpdGuardEngine(BaseEngine):
    engine_type = EngineType.OPD_GUARD
    name = "Output Parameter Determination Guard"
    description = "Audits BRFplus/OPD decision tables and output channels for S/4HANA Cloud migration."
    version = "2.1.0"
    supported_artifact_types = [ArtifactType.XML]

    async def analyze(self, payload: OpdRulePayload) -> List[Finding]:
        findings: List[Finding] = []
        raw_xml = payload.content
        artifact_hash = hashlib.sha256(raw_xml.encode("utf-8")).hexdigest()

        # Step 1: Parse safely using defusedxml
        root = SafeXmlParser.parse_string(raw_xml)

        # Step 2: Deterministic Rule OPD_001 - Check for missing printer determination
        decision_tables = root.findall(".//DecisionTable")
        for table in decision_tables:
            table_name = table.get("name", "UNKNOWN")
            printer_steps = table.findall(".//Step[@type='PRINTER_DETERMINATION']")
            
            if not printer_steps:
                snippet = f'<DecisionTable name="{table_name}">'
                snippet_hash = hashlib.sha256(snippet.encode("utf-8")).hexdigest()
                
                # Calculate provenance & confidence
                provenance = classify_provenance(
                    is_exact_parser_or_ast_match=True,
                    is_deterministic_rule=True,
                    has_evidence=True
                )

                evidence = EvidenceItem(
                    artifact_path=payload.artifact_path,
                    line_number=table.get("line_number", 1),
                    column_number=1,
                    snippet=snippet,
                    sha256=snippet_hash,
                    provenance=provenance.confidence,
                    trust_score=0.95,
                    source_type="XML_DOM",
                    offset=EvidenceSourceOffset(
                        artifact_path=payload.artifact_path,
                        selector_type="XPATH",
                        selector_query=f".//DecisionTable[@name='{table_name}']",
                        snippet=snippet
                    )
                )

                findings.append(Finding(
                    rule_id="OPD_PRINTER_STEP_MISSING",
                    engine_type=self.engine_type,
                    severity=Severity.CRITICAL,
                    title=f"Missing Printer Determination Step in Decision Table {table_name}",
                    description="BRFplus OPD decision table lacks printer output channel routing required for S/4HANA Cloud.",
                    remediation="Add PRINTER_DETERMINATION step via app Output Parameter Determination or CBC configuration.",
                    confidence=provenance.confidence,
                    confidence_score=provenance.score,
                    affected_objects=[{"name": table_name, "type": "OPD_TABLE", "tier": "TIER_1_CLOUD"}],
                    evidence=[evidence]
                ))

        return findings
```

#### 2.1.5 Invariants & Anti-Patterns
- **Invariant 1**: Never create an engine that is only an LLM prompt. Deterministic rules are primary; AI is strictly for secondary explanation.
- **Invariant 2**: LLM outputs must never exceed `INFERRED` (`0.60`) confidence.
- **Invariant 3**: Missing mandatory evidence demotes finding confidence to `UNKNOWN` (`0.30`).
- **Invariant 4**: Every finding must contain exact file path, line number, column, snippet, and cryptographic hash.
- **Anti-Pattern 1**: Catching general exceptions (`except Exception:`) and returning zero findings instead of failing or flagging parsing errors.
- **Anti-Pattern 2**: Hardcoding tenant-specific or customer-specific system IDs into general analysis rules.
- **Anti-Pattern 3**: Calling external HTTP APIs or remote LLM services inside the core deterministic evaluation loop.

---

### 2.2 Playbook 2: `sap-evidence.md`

- **Canonical File Path**: `/.agents/skills/sap-evidence.md`
- **Applicable Domains**: Evidence collection, trust calculation, Clean Core classification, rule authoring, and knowledge base ingestion.
- **Trigger**: Collecting evidence, establishing source citations, calculating confidence, classifying Clean Core tiers, or aligning releases.

#### 2.2.1 Document Structure & Required Sections
1. `# SAP Evidence, Fact Verification, and Provenance Playbook`
2. `## 1. Overview & Trust Philosophy`
3. `## 2. Release-Specific Scoping & Non-Generalization Axiom`
4. `## 3. Clean Core Extensibility Tiers (Tier 1 / Tier 2 / Tier 3)`
5. `## 4. Authoritative Source Trust Hierarchy & Numerical Scoring`
6. `## 5. Composite Trust Score Formula & Multi-Evidence Synergy`
7. `## 6. Provenance Tracking & Cryptographic Snippet Verification`
8. `## 7. The UNKNOWN Confidence Rules & Absence Invariant`
9. `## 8. TypeScript & Python Implementation Specifications`
10. `## 9. Non-Negotiable Evidence Invariants`
11. `## 10. Forbidden Anti-Patterns`

#### 2.2.2 Release Scoping & Non-Generalization
- **Strict Edition Differentiation**: SAP S/4HANA Public Cloud (`S4HC_2402`, `S4HC_2408`, `S4HC_2502`), S/4HANA Private Cloud, S/4HANA On-Premise (`S4H_2020` through `S4H_2023`), and SAP ECC 6.0 are completely distinct runtime and extensibility environments.
- **The Non-Generalization Axiom**: Behavior, compatibility, APIs, or database table accessibility valid in On-Premise or Private Cloud must **NEVER** be assumed valid in Public Cloud without explicit verification in the official Cloud Extensibility Directory.
- **Release Alignment States**:
  * `RELEASE_ALIGNED` (penalty multiplier 1.0): Validated against target release.
  * `RELEASE_PREMATURE` (penalty multiplier 0.0): Target release lacks required support package or feature pack.
  * `RELEASE_DEPRECATED` (penalty multiplier 0.0): API or feature was removed/deprecated prior to or in target release.
  * `FAMILY_MISMATCH` (penalty multiplier 0.5): Evidence from On-Premise applied to Cloud without cloud qualification.
  * `UNKNOWN` (penalty multiplier 0.3): Release metadata cannot be verified.

#### 2.2.3 Clean Core Extensibility Tiers
Every affected SAP object and finding must be categorized according to the official SAP Clean Core Extensibility Model:

```
+--------------------------------------------------------------------------+
| TIER 1: CLOUD EXTENSIBILITY                                              |
| - Key-User Extensibility (Custom Fields & Logic, Custom Business Objects)|
| - Developer Extensibility (ABAP Cloud, Released APIs: C1 contract)       |
| - Side-by-Side Extensibility on SAP BTP                                  |
| Status: FULLY COMPLIANT                                                  |
+--------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
| TIER 2: CONTROLLED DEVELOPER EXTENSIBILITY                               |
| - Custom wrappers around unreleased SAP standard APIs                    |
| - Decoupled ABAP custom code with clean interface isolation              |
| Status: CONDITIONAL / TRANSITIONAL (Requires refactoring plan)           |
+--------------------------------------------------------------------------+
                                    |
                                    v
+--------------------------------------------------------------------------+
| TIER 3: CLASSIC EXTENSIBILITY                                            |
| - Direct standard table mutations (INSERT/UPDATE on BSEG, MARA, etc.)    |
| - Classic User Exits, BAdIs without release contract                     |
| - Modifications to standard SAP code via SSCR keys                       |
| Status: PROHIBITED IN CLEAN CORE (Migration Blocker)                     |
+--------------------------------------------------------------------------+
```

#### 2.2.4 Trust Hierarchy and Composite Formula
The authoritative source trust hierarchy assigns fixed weights:

$$\begin{aligned}
\text{Official Metadata / CDS / BAPI Contracts} &: 1.00 \\
\text{Official SAP Help Portal Documentation} &: 0.95 \\
\text{Official SAP Support Notes / KBAs} &: 0.90 \\
\text{Curated ERP Preflight Domain Rules} &: 0.85 \\
\text{Official SAP Community Articles} &: 0.70 \\
\text{Third-Party Technical References} &: 0.60 \\
\text{Customer Uploaded Artifact Evidence} &: 0.50 \\
\text{Inferred / Heuristic Pattern Analysis} &: 0.30
\end{aligned}$$

When multiple evidence items $E_1, E_2, \ldots, E_n$ support a single finding, compute the composite trust score:

$$\text{Trust}_{\text{composite}} = \max_{k}(T_k) \times \left(1 - \prod_{k=1}^n (1 - 0.2 \cdot T_k)\right) \quad \text{subject to } \text{Trust}_{\text{composite}} \le \max_{k}(T_k)$$

*Synergy Property*: If a finding has a single customer snippet ($T_1 = 0.50$), $\text{Trust} = 0.50 \times (1 - (1 - 0.10)) = 0.50 \times 0.10 = 0.05$ unless corroborated by a rule or note. If corroborated by a Curated Rule ($T_2 = 0.85$) and SAP Note ($T_3 = 0.90$), $\max(T_k) = 0.90$, and the compound factor rapidly approaches the $0.90$ ceiling.

#### 2.2.5 Provenance and UNKNOWN Rules
- **Snippet Verification**: Every evidence item must be verifiable via:
  ```ts
  verifyEvidenceSnippet(artifactText: string, snippet: string, expectedSha256?: string)
  ```
- **The Absence Invariant**: The absence of an object or configuration in an incomplete customer export does **NOT** prove it does not exist in standard SAP. Findings based on missing data in partial extracts must be marked `UNKNOWN`.
- **Demotion Rule**: If a finding is asserted without an exact evidence pointer (file, line, column, snippet, and hash), its confidence class is forced to `UNKNOWN` and score capped at `0.30`.

#### 2.2.6 Invariants & Anti-Patterns
- **Invariant 1**: Never extrapolate On-Premise compatibility to Public Cloud.
- **Invariant 2**: Missing evidence always demotes to `UNKNOWN`.
- **Invariant 3**: Distinguish recommendations from mandatory replacements (e.g. Adobe Forms vs SmartForms).
- **Anti-Pattern 1**: Inventing SAP transaction codes (e.g. asserting `SPRO` exists in Public Cloud).
- **Anti-Pattern 2**: Marking custom code compliant without verifying the underlying API release contract.
- **Anti-Pattern 3**: Treating an LLM hallucination as an authoritative SAP source.

---

### 2.3 Playbook 3: `release-aware-knowledge.md`

- **Canonical File Path**: `/.agents/skills/release-aware-knowledge.md`
- **Applicable Domains**: Knowledge base curation, SPRO/CBC catalogs, deprecation databases, rule bundles, and release management.
- **Trigger**: Ingesting SAP release notes, updating mapping databases, releasing new rule bundles, or modifying the support matrix.

#### 2.3.1 Document Structure & Required Sections
1. `# Release-Aware Knowledge Base & Rule Lifecycle Governance Playbook`
2. `## 1. Overview & Trust Lifecycle Principles`
3. `## 2. Canonical Compatibility and Support Matrix Specification`
4. `## 3. Immutable Knowledge Snapshot Versioning`
5. `## 4. Signed Rule Bundle Structure & Distribution`
6. `## 5. The 5-Stage Promotion Pipeline (Draft to Production)`
7. `## 6. Shadow Evaluation & Finding Stability Tracking`
8. `## 7. Knowledge Impact Preview (Blast Radius Analysis)`
9. `## 8. End-to-End Cryptographic Data Lineage`
10. `## 9. Non-Negotiable Governance Invariants`
11. `## 10. Forbidden Anti-Patterns`

#### 2.3.2 Canonical Support Matrix Specification
The knowledge base must maintain a multi-dimensional matrix mapping:

$$\text{Product} \times \text{Edition} \times \text{Release} \times \text{Feature Pack} \times \text{Engine} \times \text{Artifact Type} \to \text{Support Status}$$

Valid statuses:
- `SUPPORTED_VERIFIED`: Certification pack passed; automated golden tests pass.
- `SUPPORTED_BETA`: Core rules validated; edge-case coverage pending.
- `PARTIAL`: Limited to specific sub-modules or artifact types.
- `FILE_MODE_ONLY`: Supported via manual upload; connector sync unsupported.
- `CONNECTOR_MODE_ONLY`: Supported via direct RFC/OData connector only.
- `NOT_SUPPORTED`: Verified incompatible; analysis rejected gracefully.
- `UNKNOWN`: Not yet certified.

#### 2.3.3 Immutable Knowledge Snapshots & Rule Bundles
- **Snapshot Immutability**: Production analyses **NEVER** query live mutable database rows. They bind to an immutable `snapshot_id`:
  ```json
  {
    "snapshot_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "build_timestamp": "2026-09-24T00:00:00Z",
    "source_checksums": {
      "simplification_list_2023": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "cloud_extensibility_2408": "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb"
    },
    "parser_versions": { "abap_ast": "1.4.0", "safe_xml": "2.0.1" },
    "graph_version": "3.1.0",
    "signature": "MEQCIC...cryptographic_signature..."
  }
  ```
- **Rule Bundle Structure**: Rules are distributed as versioned packages containing:
  * Engine identifier and semantic version.
  * Rule definitions with input/output contracts.
  * Source citations and trust ratings.
  * Embedded golden fixtures and regression tests.
  * SHA-256 signature for tamper verification.

#### 2.3.4 The 5-Stage Promotion Pipeline
No knowledge change or rule update may bypass any stage:

```
[ 1. DRAFT ] ----> [ 2. REVIEW ] ----> [ 3. STAGING ] ----> [ 4. CANARY ] ----> [ 5. PRODUCTION ]
Authoring &        Peer review &       Shadow eval          Internal &          Full GA rollout
local fixtures     SAP verification    against corpus       select beta orgs    with instant rollback
```

1. **Stage 1 (Draft)**: Authoring rules and compiling local test fixtures.
2. **Stage 2 (Review)**: Architectural peer review and SAP source citation verification.
3. **Stage 3 (Staging / Shadow Evaluation)**: Execute shadow evaluations against the entire historical regression corpus. Compute deltas:
   * Finding count delta ($\Delta F$).
   * Severity shifts ($\Delta S$).
   * Unknown-rate changes ($\Delta U$).
   * Performance/runtime impact ($\Delta T$).
4. **Stage 4 (Canary)**: Deploy to internal ERP Preflight dogfood tenants and opt-in beta customers (5%–10% traffic).
5. **Stage 5 (Production)**: Automated rollout across all regions.

#### 2.3.5 Finding Stability & Blast Radius Preview
- **Finding Stability Axiom**: If a rule update modifies a finding verdict on an existing customer project, the platform records:
  $$\text{"Finding updated: Rule bundle v2.3 replaced v2.2 — Rule OPD\_001 condition tightened."}$$
  Historical analysis results are **NEVER** silently overwritten in the database.
- **Blast Radius Analysis**: Before promoting a rule or knowledge snapshot, the Admin Trust Center must calculate:
  * Number of public SEO knowledge pages affected.
  * Number of active customer projects affected.
  * Number of open findings whose severity or status will change.
  * High-blast-radius threshold (>10% project impact) requires Lead Architect authorization.

#### 2.3.6 Invariants & Anti-Patterns
- **Invariant 1**: Global knowledge updates must be immutable snapshots with cryptographic checksums.
- **Invariant 2**: Historical analysis findings must never be silently mutated.
- **Invariant 3**: A release status can only be set to `SUPPORTED_VERIFIED` after passing its certification pack.
- **Anti-Pattern 1**: Performing live `UPDATE` or `INSERT` SQL queries directly on production knowledge tables.
- **Anti-Pattern 2**: Deploying rule bundles without running shadow regression tests against the fixture corpus.
- **Anti-Pattern 3**: Re-running an old analysis and presenting different results without explicit version delta notification.

---

### 2.4 Playbook 4: `secure-file-parser.md`

- **Canonical File Path**: `/.agents/skills/secure-file-parser.md`
- **Applicable Domains**: File ingestion service, upload coordinators, parsers (XML, JSON, CSV, ZIP, XLSX, XDP, ABAP, WSDL, EDMX), and secret redaction engines.
- **Trigger**: Handling user uploads, reading uncompressed byte streams, extracting archives, or parsing structured data.

#### 2.4.1 Document Structure & Required Sections
1. `# Secure Ingestion Pipeline & Hardened File Parsing Playbook`
2. `## 1. Overview & Threat Model`
3. `## 2. Magic Bytes & MIME Type Verification Standards`
4. `## 3. Strict Resource Limits & Archive Decompression Protections`
5. `## 4. Path Traversal & Zip Slip Neutralization`
6. `## 5. XML External Entity (XXE) & DTD Neutralization`
7. `## 6. Hybrid Secret & Credential Scrubbing (Entropy + Regex)`
8. `## 7. Sanitized Error Masking & Memory-Bounded Streaming`
9. `## 8. TypeScript & Python Hardened Implementation Reference`
10. `## 9. Non-Negotiable Ingestion Invariants`
11. `## 10. Forbidden Anti-Patterns`

#### 2.4.2 Threat Model & Magic Bytes Validation
Never rely on file extensions or client-supplied `Content-Type` headers. Validate file signatures against raw initial bytes:

| Format | Magic Bytes / Signature | Action on Mismatch |
|---|---|---|
| **ZIP / XLSX** | `50 4B 03 04` (PK..) | Reject immediately if header does not match PK zip signature. |
| **XML / XDP / WSDL** | `3C 3F 78 6D 6C` (`<?xml`) or `3C` (`<`) | Validate text encoding (UTF-8, UTF-16LE, ASCII). Reject binary payloads. |
| **JSON** | `7B` (`{`) or `5B` (`[`) preceded by optional whitespace | Validate top-level object/array structure via streaming JSON reader. |
| **PDF** | `25 50 44 46` (`%PDF`) | Reject non-PDF streams immediately. |
| **CSV / ABAP** | Valid UTF-8 / ASCII text stream | Reject null bytes (`\0`) or executable ELF/PE signatures (`4D 5A`, `7F 45 4C 46`). |

#### 2.4.3 Resource Limits & Decompression Bombs
Enforce strict physical limits during archive extraction:
- **Maximum Archive File Size**: 100 MB standard upload; 2 GB multipart for database dumps.
- **Maximum Expansion Ratio**: **100x** (e.g. a 1 MB zip cannot expand to more than 100 MB).
- **Maximum Uncompressed Volume**: **500 MB** total across all files in the archive.
- **Maximum File Count**: 10,000 files per archive.
- **Maximum Nested Archive Depth**: **2 levels** (reject zip-inside-zip-inside-zip).

#### 2.4.4 Path Traversal & Zip Slip Defense
Archive member filenames must be strictly validated before extraction:
- Reject any entry containing `../`, `..\`, leading slashes (`/` or `\`), null bytes (`%00`), or Windows drive prefixes (`C:`).
- Canonical path containment check:
  ```python
  target_dir = os.path.abspath(destination)
  resolved_path = os.path.abspath(os.path.join(target_dir, member.filename))
  if os.path.commonpath([target_dir, resolved_path]) != target_dir:
      raise SecurityViolationError(f"Path traversal detected: {member.filename}")
  ```

#### 2.4.5 XML External Entity (XXE) Neutralization
- **Python**: Use `defusedxml.ElementTree` exclusively:
  ```python
  import defusedxml.ElementTree as DefusedET
  root = DefusedET.fromstring(xml_text, forbid_dtd=True, forbid_entities=True, forbid_external=True)
  ```
- **TypeScript / Node.js**: If using `fast-xml-parser` or `xmldom`, explicitly disable entities, external DTDs, and processing instructions.
- Never use standard `xml.etree.ElementTree` or unprotected `lxml` on untrusted customer uploads.

#### 2.4.6 In-Memory Secret Scrubbing Before Persistence
Before any artifact, log, or evidence snippet is stored in PostgreSQL or S3:
1. Pass raw text through `SecretRedactionEngine`.
2. Execute regex detection for:
   - SAP RFC Passwords (`RFC_PASS=...`, `PASSWD=...`).
   - SAProuter Strings (`/H/.../W/<password>/H/...`).
   - Bearer tokens, JWTs, AWS credentials, OpenAI/API keys, Private Key blocks (`-----BEGIN PRIVATE KEY-----`).
3. Execute Shannon entropy analysis on candidate tokens ($L \ge 20$, Entropy $\ge 4.5$; Hex $L \ge 32$, Entropy $\ge 3.2$) against the SAP allowlist (`MARA`, `VBAK`, `SWWWIHEAD`, etc.).
4. Mask secrets deterministically using tenant-keyed HMAC:
   $$\text{Mask} = \text{"[REDACTED:SECRET:"} + \text{HMAC}_{\text{tenant\_key}}(\text{secret}) + \text{"]"}$$
5. Only sanitized text and sanitized snippets may be persisted.

#### 2.4.7 Invariants & Anti-Patterns
- **Invariant 1**: XML parsers must disable DTDs, external entities, and parameter entities by default.
- **Invariant 2**: Archives must be validated for expansion ratio (<100x), total volume (<500MB), and path traversal before extraction.
- **Invariant 3**: Secrets must be scrubbed in memory before persisting evidence snippets.
- **Anti-Pattern 1**: Calling `zipfile.extractall()` without verifying individual entry targets.
- **Anti-Pattern 2**: Trusting file extensions without magic byte inspection.
- **Anti-Pattern 3**: Exposing internal file paths (e.g. `/var/app/uploads/temp_123/`) in public API error messages.

---

### 2.5 Playbook 5: `multi-tenant-security.md`

- **Canonical File Path**: `/.agents/skills/multi-tenant-security.md`
- **Applicable Domains**: API endpoints, database schemas, ORM queries, object storage, caching, BullMQ jobs, and Next.js frontend state.
- **Trigger**: Creating or modifying any route, query, background job, cache key, storage artifact, or auth flow.

#### 2.5.1 Document Structure & Required Sections
1. `# Multi-Tenant Isolation, Data Segregation & Security Playbook`
2. `## 1. Overview & Zero-Trust Tenancy Principles`
3. `## 2. Database Layer Segregation & PostgreSQL RLS Enforcement`
4. `## 3. Object Storage Hierarchy & Presigned URL Policies`
5. `## 4. Redis Cache & BullMQ Queue Partitioning`
6. `## 5. Frontend Tenant Switching & Cache Invalidation Lifecycle`
7. `## 6. Authentication State Changes & Session Security`
8. `## 7. Automated Cross-Tenant Denial Testing Standard`
9. `## 8. TypeScript & SQL Reference Implementation`
10. `## 9. Non-Negotiable Tenancy Invariants`
11. `## 10. Forbidden Anti-Patterns`

#### 2.5.2 Database Segregation & PostgreSQL RLS
- **Dual-Layer Defense**:
  1. *Layer 1 (Application / ORM)*: Every Drizzle query must explicitly include `eq(table.organizationId, tenantId)` in its `WHERE` clause.
  2. *Layer 2 (PostgreSQL Row-Level Security)*: All tenant tables have RLS enabled with a session-variable check:
     ```sql
     ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
     CREATE POLICY tenant_isolation_policy ON findings
       USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
     ```
- **Transaction Scoping**: All queries run within `withTenantTransaction(pool, tenantId, callback)` which executes `setTenantSession(client, tenantId, true)` with `isLocal = true` so the session parameter is automatically cleared when the transaction ends.

#### 2.5.3 Object Storage Segregation & Presigned URLs
- **Key Hierarchy**: All S3 / MinIO storage paths must be prefixed with the tenant ID:
  $$\text{/tenants/\{organization\_id\}/projects/\{project\_id\}/uploads/\{file\_uuid\}}$$
  $$\text{/tenants/\{organization\_id\}/projects/\{project\_id\}/reports/\{report\_uuid\}.pdf}$$
- **Zero Public Access**: Buckets are completely private. Direct reads/writes are blocked by bucket policy.
- **Short-Lived Presigned URLs**:
  * Upload and download operations generate presigned URLs with a maximum lifespan of **15 minutes** (`expiresIn <= 900`).
  * Never issue presigned URLs with multi-hour or indefinite expiration.

#### 2.5.4 Cache & Queue Partitioning
- **Redis Cache Keys**: Every Redis key must be namespaced with the tenant ID:
  ```
  tenant:{organizationId}:projects:{projectId}:findings
  tenant:{organizationId}:rate_limit:{userId}
  ```
  Global un-namespaced keys are strictly prohibited.
- **BullMQ Queue Jobs**: Every queued job payload must encapsulate `organizationId`. When the worker picks up the job, it must verify that the tenant is active and unblocked before executing.
- **Noisy-Neighbor Defense**: BullMQ workers enforce per-tenant concurrency limits (e.g. max 5 concurrent analyses per tenant) to prevent one tenant from starving shared resources.

#### 2.5.5 Frontend Tenant Switching & Query Cache Wiping
- **The Tenant Switch Event**: In `apps/web`, when the user changes active organization or project:
  1. **Abort In-Flight Requests**: Immediately call `abortController.abort()` on all pending network requests for the previous tenant.
  2. **Wipe TanStack Query Cache**: Immediately invoke:
     ```ts
     queryClient.cancelQueries();
     queryClient.clear();
     ```
     `clear()` removes all query and mutation caches, eliminating any chance of Tenant A findings flashing in Tenant B's dashboard.
  3. **Reset Scoped State**: Reset any local React component state or client-side form drafts.
- **Logout Action**: On logout, perform `queryClient.clear()`, purge browser storage tokens, and redirect to login.

#### 2.5.6 Automated Cross-Tenant Denial Testing
Every API endpoint and query must have an automated integration test verifying cross-tenant access rejection:
- **Test Pattern**:
  ```ts
  it('denies Tenant B access to Tenant A resource', async () => {
    const resourceA = await createTenantResource(tenantA.id);
    const response = await clientAsTenantB.get(`/api/v1/findings/${resourceA.id}`);
    expect([403, 404]).toContain(response.status);
  });
  ```

#### 2.5.7 Invariants & Anti-Patterns
- **Invariant 1**: Every tenant-partitioned table must include `organization_id` and have PostgreSQL RLS enabled.
- **Invariant 2**: Presigned URLs must have a maximum lifetime of 15 minutes (`<= 900` seconds).
- **Invariant 3**: TanStack Query cache must be cleared immediately upon tenant switch or logout.
- **Invariant 4**: Cross-tenant requests must fail closed and emit security audit alerts.
- **Anti-Pattern 1**: Omitting `organization_id` from a `WHERE` clause because an ID is a UUID.
- **Anti-Pattern 2**: Sharing global Redis cache keys across tenants without tenant prefixing.
- **Anti-Pattern 3**: Accepting tenant IDs from client request bodies without validating user session claims.

---

## 3. Logic Chain

1. **Premise**: ERP Preflight processes mission-critical SAP configurations, custom code, and migration artifacts containing sensitive enterprise data. Architectural drift across engines, evidence tracking, security, or tenancy compromises the integrity of the platform and endangers customer compliance.
2. **Observation**: Parts 21 and 22 explicitly mandate a curated library stack and 8 canonical playbooks under `/.agents/skills/`. Part 17 mandates trust scoring, immutable snapshots, and release governance.
3. **Inference (Engine Authoring)**: Without a strict 14-point anatomy and deterministic evaluation rules, coding agents will create shallow "wrapper" engines that call LLMs directly. LLM-only engines produce probabilistic drift, hallucinations, and unverified findings. Therefore, `engine-authoring.md` must enforce deterministic parsers/rules as primary, confidence caps on AI (0.60), and mandatory golden test fixtures.
4. **Inference (SAP Evidence)**: In ERP migration, assuming On-Premise capabilities exist in Public Cloud causes catastrophic project failures (e.g. trying to run SmartForms or classic BAdIs in S/4HANA Public Cloud 2408). Therefore, `sap-evidence.md` must mandate release-specific scoping, Clean Core tiers (Tier 1/2/3), exact trust scoring weights, and the UNKNOWN absence invariant.
5. **Inference (Release-Aware Knowledge)**: SAP releases change quarterly (Cloud) and annually (On-Premise). If knowledge base records are edited in place, historical preflight reports change retroactively, violating audit standards. Therefore, `release-aware-knowledge.md` must enforce immutable snapshots, rule bundle signing, a 5-stage promotion pipeline, and shadow evaluation.
6. **Inference (Secure File Parser)**: Enterprise uploads include archives, XML files, and configuration dumps. Without hardened defenses, attackers can trigger zip bombs, XXE exfiltration, or path traversal. Furthermore, SAP configuration files frequently contain unredacted RFC passwords. Therefore, `secure-file-parser.md` must mandate magic bytes validation, resource caps (100x ratio, 500MB limit), `defusedxml`, and in-memory secret scrubbing before storage.
7. **Inference (Multi-Tenant Security)**: In a multi-tenant SaaS environment, data leaks between enterprise competitors are fatal. Concurrent requests in Next.js SSR can leak global QueryClient state, and database queries without tenant filters can cross tenant boundaries. Therefore, `multi-tenant-security.md` must enforce dual-layer defense (ORM + PostgreSQL RLS), presigned URLs ($\le 15$m), and immediate TanStack Query cache clearing upon tenant switch.
8. **Conclusion**: Providing detailed, concrete technical designs, exact markdown sections, code examples, invariants, and anti-patterns for these 5 playbooks guarantees that all subsequent implementation agents will construct robust, production-grade components without architectural ambiguity.

---

## 4. Caveats

1. **Python vs TypeScript Polyglot Engines**: The 18 preflight engines are primarily implemented in Python (`services/analysis-python`) for scientific/AST parsing efficiency, while platform coordination and lightweight verification exist in TypeScript (`packages/evidence`, `apps/api`). Both languages share identical data contracts (`packages/schemas` and Pydantic models).
2. **Zod 4 Runtime Compatibility**: `apps/web` currently installs Zod 3.24.2. Schemas designed in the blueprints are fully backward-compatible with Zod 3 while conforming to Zod 4 specifications.
3. **Storage Engine Abstraction**: Presigned URL guidelines apply equally to AWS S3, Cloudflare R2, MinIO, or Hostinger Object Storage via the S3-compatible API.
4. **Read-Only Scope**: In accordance with the Explorer archetype, this agent has NOT created or modified files in `/.agents/skills/` directly. The complete, production-ready specifications are delivered in this handoff report for immediate implementation by builder agents.

---

## 5. Conclusion

The technical designs, exact sections, code examples, invariants, and anti-patterns for the 5 Core Engine, Evidence, Security & Tenancy playbooks have been fully authored and documented:
1. `engine-authoring.md` (Part 22.4): Complete 14-point engine structure, deterministic AST/DOM rules, 4 confidence classes (`VERIFIED` 1.0, `RULE_DERIVED` 0.85, `INFERRED` 0.60, `UNKNOWN` 0.30), standardized finding codes, evidence schema, and golden test fixtures.
2. `sap-evidence.md` (Part 22.5): Release-specific scoping, non-generalization axiom, Clean Core tiers (Tier 1/2/3), authoritative source hierarchy, composite trust score formula, cryptographic snippet hashing, and UNKNOWN absence rules.
3. `release-aware-knowledge.md` (Part 22.6): Canonical compatibility matrix, immutable snapshot versioning, signed rule bundles, 5-stage promotion pipeline (`Draft → Review → Staging → Canary → Production`), shadow evaluation, finding stability tracking, and blast radius analysis.
4. `secure-file-parser.md` (Part 22.7): Magic bytes validation, archive limits (100x expansion ratio, 500MB max, depth 2), path traversal / zip slip defense, XXE neutralization via `defusedxml`, and in-memory hybrid secret scrubbing (Shannon entropy + regex).
5. `multi-tenant-security.md` (Part 22.8): Dual-layer tenant segregation (ORM + PostgreSQL RLS), object storage prefixes, short-lived presigned URLs ($\le 15$m), Redis/BullMQ tenant namespacing, immediate frontend TanStack Query cache clearing on tenant switch, and automated cross-tenant denial tests.

Downstream builder agents can immediately take these designs and materialize the 5 markdown playbook files in `H:/erppreflight/.agents/skills/`.

---

## 6. Verification Method

To independently verify the technical designs and ensure consistency with the repository:

1. **Verify Evidence & Confidence Formula Consistency**:
   - Inspect `H:/erppreflight/packages/evidence/src/classifier.ts`: Confirm lines 16–37 match the 4 confidence classes and score mappings (`1.0`, `0.85`, `0.60`, `0.30`).
   - Confirm lines 51–66 match the composite trust score formula.
2. **Verify Schema Field Alignment**:
   - Inspect `H:/erppreflight/packages/schemas/src/finding.ts` and `evidence.ts`: Confirm `EvidenceSourceOffsetSchema`, `ReleaseAlignmentEnum`, and `BaseFindingSchema` contain all required fields (`artifactPath`, `lineNumber`, `columnNumber`, `snippet`, `sha256`, `trustScore`).
3. **Verify PostgreSQL RLS Session Variable**:
   - Inspect `H:/erppreflight/packages/database/src/rls.ts`: Confirm `setTenantSession` sets `app.current_tenant_id` within a transaction.
4. **Verify XML & Secret Redaction Implementations**:
   - Inspect `H:/erppreflight/services/analysis-python/src/parsers/safe_xml.py` and `src/platform/redaction.py`: Confirm `defusedxml` and Shannon entropy thresholds are active.
5. **Invalidation Conditions**:
   - If a proposed engine design permits an LLM to assign `VERIFIED` (1.0) confidence, it violates Part 22.4 and `packages/evidence/src/classifier.ts`.
   - If a proposed security playbook allows presigned URLs with TTL > 15 minutes, it violates Part 22.8 and R3 of ORIGINAL_REQUEST.md.
