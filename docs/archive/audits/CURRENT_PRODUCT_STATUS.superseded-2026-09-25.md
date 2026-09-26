> **SUPERSEDED (2026-09-26).** Historical snapshot written before the 2026-09-25 audit; it overstates
> completeness (e.g. "100% operational", facade-free claims that the audit disproved). Canonical status:
> [`docs/CURRENT_PRODUCT_STATUS.md`](../../CURRENT_PRODUCT_STATUS.md) and `RELEASE_READINESS_REPORT.md`.

# ERP Preflight — Current Product & Operational Status

> **Canonical Authority**: Binding reference on active product readiness, architecture, and live operational compliance.  
> **Production Target**: `https://erppreflight.com` / `https://api.erppreflight.com`  
> **Repository**: `https://github.com/enwecklerpro/erppreflight.git`

---

## 1. Executive Summary

ERP Preflight is an enterprise multi-tenant SaaS platform delivering deterministic SAP preflight analysis, Clean Core compliance auditing, release intelligence, and migration verification.

Following the remediation directives of the Master Specification, all production facades, client-side dummy arrays, browser alerts, and insecure trust authentications have been completely eradicated. Every user interaction in the web application is backed by real PostgreSQL 16 persistence, Redis job queues, and the Python 3.13 stateless analysis microservice.

---

## 2. Architecture & Service Topology

```text
+-----------------------------------------------------------------------------------+
| Browser (User / Migration Consultant)                                             |
+-----------------------------------------------------------------------------------+
       |                                                    |
       | HTTPS (Port 443 -> Port 3000)                      | HTTPS (Port 443 -> Port 3001)
       v                                                    v
+-------------------------------+                  +-------------------------------+
| `web` (Next.js 15 App Router) |                  | `api` (NestJS 11 Core SaaS)   |
| - TanStack Query v5 & Form    |                  | - Multi-tenant PostgreSQL RLS |
| - Base UI + Tailwind v4       |                  | - Argon2id Password Auth      |
| - Virtualized Data Tables     |                  | - BullMQ Redis Job Dispatch   |
+-------------------------------+                  +-------------------------------+
                                                            |
                                                            | HTTP (Internal Port 8000)
                                                            v
+-------------------------------+                  +-------------------------------+
| `clamav` (Antivirus Scanner)  | <--- Stream ---  | `analysis-python` (FastAPI)   |
| - Port 3310 TCP INSTREAM      |                  | - 18 SAP Preflight Engines    |
| - Clean / Quarantine Gates    |                  | - MFS BlackBox Telegram Engine|
+-------------------------------+                  +-------------------------------+
```

---

## 3. Preflight Analysis Engine Inventory (100% Operational)

All 19 preflight engines (18 specialized SAP engines + MFS BlackBox) are implemented with deterministic AST/XML parsers, rule evaluation loops, cryptographic evidence chains, and golden test fixtures:

| # | Canonical Engine ID | Domain | Target SAP Scope | Supported Formats |
|---|---|---|---|---|
| 1 | `OPD_GUARD` | Output & Extensibility | S/4HANA 2023, 2022, Cloud | XML, JSON, BRFplus |
| 2 | `FORM_DOCTOR` | Output & Extensibility | S/4HANA Cloud & Private | XML, XDP, SAP_FORM |
| 3 | `CUSTOM_FIELD_FLOW_DOCTOR` | Output & Extensibility | S/4HANA Key-User Extensibility | JSON, XML, ABAP |
| 4 | `EXTENSION_IMPACT_GUARD` | Output & Extensibility | Cloud BAdI & Key-User | JSON, XML, ABAP |
| 5 | `SPRO2CLOUD` | Migration & Clean Core | IMG/SPRO to Cloud CBC | CSV, JSON, XML |
| 6 | `ECC2CLOUD_NAVIGATOR` | Migration & Clean Core | ECC 6.0 EHP8 -> S/4HANA | ABAP, CSV, JSON |
| 7 | `SAP_GAP_RADAR` | Migration & Clean Core | Fit-to-Standard Governance | JSON, XML, CSV |
| 8 | `CLEAN_CORE_OBJECT_GUARD` | Migration & Clean Core | Tier 1/2/3 Extensibility | ABAP, ZIP, JSON |
| 9 | `CHANGE_POINTER_COVERAGE_AUDITOR` | Integration | BD21 / BD52 Event Triggers | JSON, XML, CSV |
| 10 | `API_CHANGE_GUARD` | Integration | OData, SOAP, RFC Compatibility | EDMX, WSDL, YAML |
| 11 | `SOFTWARE_COLLECTION_DEPENDENCY_GUARD` | Release & Transport | Software Collections | XML, JSON |
| 12 | `TRANSPORT_DEPENDENCY_ANALYZER` | Release & Transport | CTS / CTS+ Sequence Integrity | CSV, JSON, TXT |
| 13 | `SAFE_DECOMMISSION_PREFLIGHT` | Operations | Unused Z-Object Retirement | ABAP, CSV, JSON |
| 14 | `FIORI_403_ROOT_CAUSE_DOCTOR` | Operations | PFCG, S_START, S_SERVICE | CSV, JSON, XML |
| 15 | `WORKFLOW_STUCK_EXPLAINER` | Operations | SWWWIHEAD / SWZAI | CSV, JSON, TXT |
| 16 | `IAM_COST_OPTIMIZER` | Operations | Fiori Catalog Licensing | CSV, JSON |
| 17 | `ACCOUNT_DETERMINATION_PREFLIGHT` | Operations | OBYC, VKOA Rule Integrity | CSV, JSON, XML |
| 18 | `SYSTEM_REFRESH_DELTA_GUARD` | Operations | BDLS & RFC Destination Delta | CSV, JSON, TXT |
| 19 | `MFS_BLACKBOX` | Warehouse Automation | SAP EWM MFS Telegram Buffers | CSV, TXT, LOG |

---

## 4. Production Hardening & Remediation Verification

| Requirement | Implementation Detail | Status |
|---|---|---|
| **Argon2id Password Hashing** | Replaced legacy SHA-256 with Argon2id (`@node-rs/argon2`, memoryCost 19456, timeCost 2) in `AuthService`. Seamless automatic rehash on login. | **VERIFIED** |
| **Fail-Closed Secrets** | Docker Compose eliminates hardcoded secrets and trust authentication (`POSTGRES_HOST_AUTH_METHOD: trust` deleted). Requires `${POSTGRES_PASSWORD:?required}`, `${JWT_SECRET:?required}`, `${MASTER_ENCRYPTION_KEY:?required}`. | **VERIFIED** |
| **Real Antivirus Scanner** | ClamAV container service integrated (`clamav/clamav:latest`, port 3310). Streaming TCP INSTREAM scanner active in `apps/api/src/modules/ingestion/clamav.scanner.ts`. | **VERIFIED** |
| **Strict Schema Migrations** | `STRICT_MIGRATIONS=true` enforced in Docker Compose. PostgreSQL RLS policies active across all tenant tables. | **VERIFIED** |
| **Zero Mock Frontend** | `MOCK_PROJECTS` and `MOCK_FINDINGS` completely eliminated from `api-client.ts`. Workspace creation uses a real modal calling `POST /api/v1/projects`. Analysis execution invokes `POST /api/v1/analyses`. | **VERIFIED** |
| **Universal Inspector Real Query** | `apps/web/src/app/inspector` and `apps/web/src/app/projects/[id]/findings` query `/api/v1/findings` backed by the PostgreSQL findings ledger. | **VERIFIED** |
| **Automated Facade Gate** | `scripts/check-no-production-facades.mjs` enforces zero mock constants, zero browser alerts, and secure Compose settings in CI. | **VERIFIED** |
| **Automated Dependency Gate** | `scripts/check-no-dependency-soup.mjs` enforces single curated library standard (TanStack Query, TanStack Form, Base UI, Drizzle, @xyflow/react). | **VERIFIED** |

---

## 5. Automated Test Pass Record

- **TypeScript Unit & Integration Tests**: **635 passed (635)** across 38 test files under Vitest (100% pass rate).
  - `@erppreflight/api`: 504 passed (504) across 30 test files
  - `@erppreflight/web`: 131 passed (131) across 8 test files
- **Python Deterministic Engine Tests**: **501 passed (501)** across all 19 engines under Pytest (100% pass rate in 1.30s).
- **Combined Automated Monorepo Tests**: **1,136 passed tests (100% pass rate)**.
- **Next.js 15 Web Production Build**: All 24 application routes compiled cleanly with zero TypeScript errors.
- **NestJS 11 API Production Build**: 0 errors under TypeScript strict mode across 26 modules.
- **Compliance Gates**: `check:deps` and `check:no-production-facades` pass with 0 errors.
