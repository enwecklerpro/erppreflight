# SAP Preflight Engine Authoring & Execution Standard Playbook

> **Playbook Identifier**: `engine-authoring`  
> **Authority**: Binding architectural specification across all 18 SAP Preflight Engines and platform analysis modules.  
> **Governing Standards**: Part 22.4, Part 17 Trust AI, Python 3.13 FastAPI, Pydantic, Zod, pytest, Hypothesis.  
> **Anchored Cardinal Axiom**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Defined in `AGENTS.md` Section 1)  
> **Applicable Trigger**: Any implementation, modification, refactoring, or testing of an analysis engine or parser in `services/analysis-python` or TypeScript analysis packages.

---

## 1. Overview & Operational Philosophy

ERP Preflight delivers audit-grade, defensible preflight analysis for enterprise SAP migrations, Clean Core compliance, and release upgrades. Preflight findings are relied upon by enterprise architects, systems integrators, and auditors to make multimillion-dollar migration decisions.

Therefore, an engine in ERP Preflight is **never** a loose generative prompt or probabilistic heuristic. Every engine operates as a deterministic, pure evaluation machine backed by rigorous parsing, cryptographic evidence pointers, and curated regression test fixtures. Generative AI is strictly restricted to secondary explanatory text and remediation assistance.

---

## 2. Cardinal Axiom 2 & The 14-Point Engine Anatomy Specification

Section 1 of `AGENTS.md` defines **Cardinal Axiom 2**: *"An engine without deterministic logic/evidence/fixtures is not complete."* A preflight analysis engine is not a prompt wrapper or heuristic script. Every engine within `services/analysis-python/src/engines/` must implement all 14 points below to achieve preflight certification:

| Point | Anatomy Component | Requirement & Technical Implementation |
|---|---|---|
| **1** | **Metadata** | Unique `engine_type` from `EngineTypeEnum`, human-readable name, domain classification, semantic `version` string (e.g. `2.1.0`), supported target releases (`TargetReleaseEnum`), and supported artifact types (`ArtifactTypeEnum`). |
| **2** | **Input Schema** | Strict runtime schema validation (Pydantic model in Python, Zod in TypeScript). Rejects missing or extra fields before execution. Never accept unvalidated JSON. |
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

---

## 3. Deterministic AST / DOM / Rule Logic Principles

### 3.1 Purity and Bitwise Reproducibility
- An engine must behave as a pure function: $\text{Engine}(A, R, K) \to [F_1, F_2, \dots, F_n]$, where $A$ is the input artifact, $R$ is the target release, and $K$ is the immutable knowledge snapshot.
- Given identical inputs, the findings, evidence hashes, and confidence scores must be 100% identical.
- **Strictly Prohibited**: Calling system clocks (`datetime.now()`), random number generators (`random()`, `uuid4()` for deterministic finding keys), or making outbound HTTP requests inside the evaluation loop.

---

## 4. Provenance & The 4 Confidence Classes

| Confidence Class | Numerical Score | Criterion & Source Qualification | Engine Usage Rule |
|---|---|---|---|
| **`VERIFIED`** | `1.0` | Exact AST node match, direct DOM element match, or verified configuration table entry. Cryptographically validated. | Direct parser matches (e.g. SmartForm XML node detected, direct DB table write in ABAP AST). |
| **`RULE_DERIVED`** | `0.85` | Deterministic domain rule evaluation combining multiple verified facts or deterministic logic trees. | Standard preflight rules (e.g. SPRO node missing corresponding CBC activity in target 2408). |
| **`INFERRED`** | `0.60` | Heuristic correlation, statistical pattern match, or secondary AI explanation assistance. | AI Problem Router suggestions or heuristic transport dependency ordering. **LLMs are capped here.** |
| **`UNKNOWN`** | `0.30` | Incomplete customer export, missing mandatory evidence, ambiguous release family, or unverified rule. | Missing evidence or partial artifact exports. Never claim supported/unsupported without evidence. |

### 4.1 Missing Evidence Demotion Rule
If an engine evaluates a rule but cannot point to a verifiable file location (artifact path, line/column offset, code snippet, and SHA-256 hash), the finding's confidence MUST be demoted to `UNKNOWN` with confidence score capped at `0.30`.
