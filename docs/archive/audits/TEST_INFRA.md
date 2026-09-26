# TEST_INFRA — ERP Preflight E2E Testing Infrastructure

Authoritative Source: `PROJECT.md`, `engines_spec.md`, `platform_spec.md`, `ORIGINAL_REQUEST.md`  
Scope: Opaque-Box E2E Testing Harness, Authentic SAP Fixtures, Standalone Test Runner, and Tiers 1-4 Test Suites  
Target System: ERP Preflight Multi-Tenant SaaS Platform  
Classification: Testing Infrastructure Architecture & Execution Guide  

---

## 1. Executive Summary & Testing Philosophy

ERP Preflight requires an authoritative, requirement-driven, opaque-box test harness. Because ERP Preflight is an enterprise-grade preflight analyzer for mission-critical SAP systems, test suites must verify observable contracts, input/output schemas, deterministic domain rules, boundary resilience, and cross-engine integration without white-box coupling to internal implementation details.

### Core Testing Mandates
1. **Opaque-Box Evaluation**: Tests treat engines, ingestion pipelines, and platform services as black boxes, providing authentic SAP artifacts as inputs and strictly validating JSON responses, status codes, canonical findings, evidence provenance, and confidence tiers against authoritative specifications.
2. **Explicit Expected Output Derivations**: Every assertion is derived directly from the canonical rules specified in `engines_spec.md`, `platform_spec.md`, and `ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md`.
3. **Progressive Testability & Dual-Mode Execution**:
   - **Standalone Runner Mode**: `py -3.12 tests/e2e/runner.py` executes self-contained rule verifications and contract validators directly with rich terminal output, ANSI formatting, and JSON summary generation.
   - **Pytest Mode**: `py -3.12 -m pytest tests/e2e/ -v` integrates into standard CI/CD pipelines with full assertion tracking, parameterization, and failure reporting.
   - **Live Service Verification**: The harness supports pointing to running HTTP services (`API_URL`, `ANALYSIS_SERVICE_URL`) or evaluating local deterministic engines.
4. **Authentic SAP Fixture Library**: Tests consume genuine SAP artifacts (BRFplus decision tables, Adobe Forms XDP, ABAP AST samples, SPRO IMG tables, Transport E070/E071 CSV, BD21 change pointers, Fiori SU53 traces, SWWWIHEAD workflow logs, OBYC account determination tables, and MFS telegram logs).
5. **Adversarial & Boundary Verification**: Deliberately stress-tests corrupt archives, zip bombs (100:1 ratio, >500MB), path traversal (Zip Slip), XML entity expansion (XXE/Billion Laughs), secret injection, and encoding anomalies.

---

## 2. Directory Layout & Architecture

```
H:/erppreflight/
├── TEST_INFRA.md                   # This specification & operational guide
├── TEST_READY.md                   # Test execution results, pass/fail status, and coverage metrics
├── tests/
│   └── e2e/
│       ├── __init__.py
│       ├── conftest.py             # Pytest fixtures, test discovery, and environment config
│       ├── runner.py               # Standalone opaque-box runner with rich terminal reporting
│       ├── contracts.py            # Pydantic schemas validating API & Engine responses
│       ├── evaluators.py           # Deterministic specification oracles for all 18 engines & platform
│       ├── fixtures/               # Authentic SAP artifacts & synthetic adversarial files
│       │   ├── opd/                # BRFplus decision tables & business scenario payloads
│       │   ├── forms/              # Adobe XDP templates, XML payloads, and XSD schemas
│       │   ├── custom_fields/      # YY1 field flows, context catalogs, and BAdI specs
│       │   ├── extension_impact/   # Customer dependency graphs and extension manifests
│       │   ├── spro/               # SPRO IMG tables and ECC-to-Cloud SSCUI mappings
│       │   ├── ecc2cloud/          # ST03N transaction logs and TADIR object inventories
│       │   ├── gap_radar/          # Clean Core 12-tier requirement statements
│       │   ├── clean_core/         # ABAP Cloud & classic source files (.abap)
│       │   ├── change_pointer/     # BD61, BD50, BD52 exports and BDCP2 runtime samples
│       │   ├── api_change/         # OpenAPI 2.0/3.0 specifications and OData EDMX metadata
│       │   ├── software_collection/# Key-user software collection export manifests
│       │   ├── transport/          # E070, E071, E071K transport object headers and tables
│       │   ├── decommission/       # USR02, TBTCO batch jobs, and RFCDES destination exports
│       │   ├── fiori403/           # HTTP error payloads, SU53 traces, and SICF service status
│       │   ├── workflow/           # SWWWIHEAD headers, container dumps, and SWETYPV linkages
│       │   ├── iam_cost/           # AGR_1251 catalogs, AGR_USERS, and price category models
│       │   ├── account_det/        # T030, T030K, OBYC, VKOA tables, and SKA1/SKB1 accounts
│       │   ├── system_refresh/     # Pre- and post-refresh system configuration snapshots
│       │   ├── mfs/                # EWM / MFS telegram stream logs and conveyor topology
│       │   ├── platform/           # Evidence items, audit logs, and AI Problem Router prompts
│       │   └── boundary/           # Zip bomb, Zip slip, XXE, secret injections, bad encodings
│       ├── test_tier1_features.py    # Tier 1: Feature Coverage (>=5 tests per engine & platform)
│       ├── test_tier2_boundaries.py  # Tier 2: Boundary, Adversarial & Error Handling
│       ├── test_tier3_combinations.py# Tier 3: Cross-Engine & Module Pairwise Interactions
│       └── test_tier4_scenarios.py   # Tier 4: Real-World SAP Customer Audit Scenarios
```

---

## 3. Test Tier Hierarchy & Scope

| Tier | Name | Target Capabilities | Minimum Tests | Objective |
|------|------|---------------------|---------------|-----------|
| **Tier 1** | Feature Coverage | 18 SAP Engines + 5 Platform Services | >= 120 tests (>=5 per feature) | Primary behavior (happy path), deterministic outputs, schema validation, and expected code generation. |
| **Tier 2** | Boundary & Corner Cases | Ingestion security, memory limits, adversarial payloads | >= 25 tests | Zip bombs, Zip slip traversal, XXE attacks, secret leaks, invalid encodings, null inputs, edge-case date/numbers. |
| **Tier 3** | Cross-Feature Combinations | Pairwise engine pipelines | >= 15 tests | Multi-stage lifecycles (Ingestion -> Redaction -> Engine, OPD -> FormDoctor, Custom Fields -> Extension Impact, etc.). |
| **Tier 4** | Real-World Customer Scenarios | Complex multi-system SAP transformations | 4 deep scenarios | Full-scale customer migration preflights, upgrade release audits, incident post-mortems, and compliance governance. |

---

## 4. Authoritative Output Derivation

Every test case in Tiers 1-4 verifies outcomes derived strictly from specifications:

1. **OPD Guard**:
   - Condition: BRFplus rule evaluation order (`Output Type` -> `Receiver` -> `Channel` -> `Printer` -> `Email Recipient` -> `Email Sender` -> `Form Template` -> `Output Relevance`).
   - Expected Output: `OPD_STEP_FAILED` when recipient row missing; `OPD_UNREACHABLE_RULE` when broad condition shadows later rows.
2. **FormDoctor**:
   - Condition: XDP `<bind match="dataRef" ref="..."/>` evaluated against XML DOM.
   - Expected Output: `FORM_FIELD_MISSING_IN_XML` when dataRef node absent; `FORM_BINDING_PATH_MISMATCH` when field exists under alternate path; `FORM_FIELD_HIDDEN_IN_LAYOUT` when `presence="hidden"`.
3. **Clean Core Object Guard**:
   - Condition: AST parse of ABAP source against Cloudification Repository.
   - Expected Output: `CLEAN_CORE_DIRECT_DB_ACCESS` on `SELECT * FROM mara`; `CLEAN_CORE_OBSOLETE_SYNTAX` on `FORM/PERFORM` or `TABLES`.
4. **Change Pointer Coverage Auditor**:
   - Condition: Check BD61 active flag (`X`), BD50 message type, BD52 field configuration.
   - Expected Output: `CP_GLOBAL_DEACTIVATED` if BD61 is blank; `CP_FIELD_NOT_CONFIGURED_BD52` if field omitted.
5. **System Refresh Delta Guard**:
   - Condition: Diff pre-refresh and post-refresh RFC destinations and logical systems.
   - Expected Output: `REFRESH_RFC_TARGETS_PRODUCTION` if targetHost points to `prod*`; `REFRESH_SCOT_OUTBOUND_ACTIVE` if SMTP routing unredirected.
6. **Confidence Classifier**:
   - Condition: Strict demotion rule: LLM-derived findings must NEVER exceed `INFERRED` (score 0.60); deterministic rules yield `RULE_DERIVED` (0.85); exact AST/schema yield `VERIFIED` (1.00); missing artifacts yield `UNKNOWN` (0.30).
7. **Tamper-Evident Audit Trail**:
   - Condition: Append-only hash chaining: `eventHash = SHA256(previousHash + eventId + tenantId + action + timestamp + details)`.
   - Expected Output: Cryptographic chain verification succeeds; tampering with any record invalidates subsequent hashes.

---

## 5. Execution Instructions

### Running via Pytest
```powershell
# Run the complete E2E test suite across all 4 tiers
py -3.12 -m pytest tests/e2e/ -v

# Run specific tiers
py -3.12 -m pytest tests/e2e/test_tier1_features.py -v
py -3.12 -m pytest tests/e2e/test_tier2_boundaries.py -v
py -3.12 -m pytest tests/e2e/test_tier3_combinations.py -v
py -3.12 -m pytest tests/e2e/test_tier4_scenarios.py -v

# Filter by engine keyword
py -3.12 -m pytest tests/e2e/ -k "opd or clean_core or mfs" -v
```

### Running via Standalone Test Runner
```powershell
# Run all tests with rich terminal reporting and output report generation
py -3.12 tests/e2e/runner.py

# Run specific tier
py -3.12 tests/e2e/runner.py --tier 1
py -3.12 tests/e2e/runner.py --tier 2
py -3.12 tests/e2e/runner.py --tier 3
py -3.12 tests/e2e/runner.py --tier 4

# Export execution report to JSON
py -3.12 tests/e2e/runner.py --output tests/e2e/e2e_report.json
```

---

## 6. CI/CD Integration & Health Probes

In automated build pipelines or Coolify deployment:
1. Docker Compose boots services: `docker compose -f docker-compose.coolify.yml up -d`
2. Wait for `/health/readiness` to return HTTP 200 on all containers (`web:3000`, `api:4000`, `analysis-python:8000`).
3. Run E2E test runner:
   ```bash
   py -3.12 tests/e2e/runner.py --target live --api-url http://localhost:4000 --analysis-url http://localhost:8000
   ```
4. Output report verifies 100% pass rate before production traffic ingress.
