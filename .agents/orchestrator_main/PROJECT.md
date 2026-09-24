# Project: ERP Preflight

## Architecture

ERP Preflight is an enterprise-grade multi-tenant SaaS platform for automated SAP preflight analysis, clean core auditing, migration verification, and release intelligence.

### High-Level Topology & Data Flow
```
[Browser / Web UI] (Next.js 15 App Router - Tailwind, shadcn/ui)
       │
       ▼
[Core API Backend] (NestJS 11 - TypeScript, Fastify/Express)
       ├── Auth, Multi-Tenancy (RLS + TenantGuard), Workspaces, Projects
       ├── Ingestion Security (Magic bytes, Archive safety, Secret redaction)
       ├── S3/MinIO Object Storage (Quarantine & Clean buckets, Pre-signed URLs)
       ├── PostgreSQL 16 + pgvector (SaaS state, RLS, Knowledge Graph, Vectors)
       └── Redis 7 (BullMQ: ingestion-queue, analysis-queue, export-queue)
              │
              ▼
[Analysis Engine] (Python 3.13 FastAPI)
       ├── Deterministic Parsers (XML, JSON, CSV, ABAP, XDP, WSDL, Spool)
       ├── 18 SAP Preflight Engines + MFS BlackBox
       ├── Shared Platform Services: Evidence Engine, Confidence Classifier, AI Problem Router, Audit Trail
       └── Pytest Test Suite & Golden Fixtures
```

### Core Invariants & Boundaries
1. **SaaS Invariant Ownership**: NestJS `apps/api` exclusively owns user authentication, multi-tenant boundaries (enforced via PostgreSQL RLS `app.current_tenant_id`), billing, project lifecycle, and transactional metadata.
2. **Analysis Invariant Ownership**: Python FastAPI `services/analysis-python` deterministically parses customer artifacts, executes domain rules, and calculates preflight findings. It is stateless and decoupled from SaaS billing/auth.
3. **Evidence & Provenance Invariant**: Every finding MUST be backed by an immutable `Evidence` record with a cryptographic SHA-256 hash and classified into one of 4 strict confidence classes: `VERIFIED` (1.0), `RULE_DERIVED` (0.85), `INFERRED` (0.60), `UNKNOWN` (0.30). LLM outputs can NEVER exceed `INFERRED` (0.60).
4. **Security & Ingestion Invariant**: Untrusted files enter quarantine, undergo magic-byte MIME validation, Zip bomb/slip checks, XXE protection, ClamAV scanning, and automatic credential/secret redaction before parser consumption.

---

## Feature Inventory

Every feature identified during the Survey phase is mapped to an assigned milestone below:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Monorepo Workspace | pnpm workspaces + Turborepo layout (apps, services, packages) | M1 | spec_miner_survey_2 |
| 2 | Next.js Web App | Responsive UI, Dashboard, Project Workspace, Analysis Inspector, Findings view | M1 | spec_miner_survey_2 |
| 3 | NestJS Core API | Multi-tenant auth, workspace/project CRUD, BullMQ queue dispatch | M1 | spec_miner_survey_2 |
| 4 | Python FastAPI Service | Async FastAPI analysis service with health check, worker endpoints | M1 | spec_miner_survey_2 |
| 5 | PostgreSQL + pgvector Schema | Canonical database schema, pgvector HNSW indexing, RLS tenant isolation | M1 | spec_miner_survey_2 |
| 6 | Redis & BullMQ Queues | Analysis, Ingestion, and Export queues with concurrency limits | M1 | spec_miner_survey_2 |
| 7 | Shared TypeScript Packages | `@erppreflight/schemas`, `@erppreflight/database`, `@erppreflight/tenancy`, `@erppreflight/auth`, `@erppreflight/evidence` | M1 | spec_miner_survey_2 |
| 8 | Architecture Documentation & ADRs | IMPLEMENTATION_STATUS.md, ARCHITECTURE_DECISIONS.md | M1 | spec_miner_survey_2 |
| 9 | File Format & MIME Validation | Magic-byte sniff for XML, JSON, CSV, ZIP, ABAP, PDF, XDP | M2 | spec_miner_survey_2 |
| 10 | Archive Safety & Quarantine | Zip bomb (100:1 ratio, 500MB max), Zip slip prevention, XXE/Billion laughs defense | M2 | spec_miner_survey_2 |
| 11 | Secret & Credential Redaction | Regex and Shannon entropy scanning to redact tokens, SAP RFC credentials, private keys | M2 | spec_miner_survey_2 |
| 12 | Pre-signed S3 Storage URLs | Secure short-lived signed URLs for artifact upload and report download | M2 | spec_miner_survey_2 |
| 13 | Preflight Report Export Engine | Multi-format preflight audit report generation (PDF, JSON bundle, CSV/XLSX) | M2 | spec_miner_survey_2 |
| 14 | Evidence Engine | SHA-256 evidence chain, source artifact location, provenance scoring | M2 | spec_miner_survey_1 |
| 15 | Confidence Classifier | Hierarchy (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`), strict LLM demotion | M2 | spec_miner_survey_1 |
| 16 | AI Problem Router | Deterministic intent routing, parser failure fallback, LLM gateway | M2 | spec_miner_survey_1 |
| 17 | Tamper-Evident Audit Trail | Append-only ledger with cryptographic hash chaining for all analysis operations | M2 | spec_miner_survey_1 |
| 18 | OPD Guard | S/4HANA Output Parameter Determination rules, BRFplus decision table evaluation | M3 | spec_miner_survey_1 |
| 19 | FormDoctor | SAPscript, Smart Forms to Adobe Forms (XDP) migration & syntax validator | M3 | spec_miner_survey_1 |
| 20 | Custom Field Flow Doctor | Extension field lineage from CDS views through BAPIs to UI annotations | M3 | spec_miner_survey_1 |
| 21 | Extension Impact Guard | Cloud BAdI, key-user extensibility, and upgrade stability analyzer | M3 | spec_miner_survey_1 |
| 22 | SPRO2Cloud | On-premise IMG/SPRO configuration to Cloud CBC mapping and delta analysis | M3 | spec_miner_survey_1 |
| 23 | ECC2Cloud Navigator | Custom code remediation, obsolete transaction / table migration roadmap | M3 | spec_miner_survey_1 |
| 24 | SAP Gap Radar | Fit-to-standard vs custom delta analyzer with Clean Core recommendations | M3 | spec_miner_survey_1 |
| 25 | Clean Core Object Guard | Tier 1/2/3 extensibility classification, classic modification detector | M3 | spec_miner_survey_1 |
| 26 | Change Pointer Coverage Auditor | BD21/BD52 change pointer configuration and event trigger validation | M3 | spec_miner_survey_1 |
| 27 | API Change Guard | OData, SOAP, RFC compatibility and deprecation impact scanner | M3 | spec_miner_survey_1 |
| 28 | Software Collection Dependency Guard | Export software collection item cross-reference and release validator | M3 | spec_miner_survey_1 |
| 29 | Transport Dependency Analyzer | CTS transport sequence, cross-transport dictionary dependency validator | M3 | spec_miner_survey_1 |
| 30 | Safe Decommission Preflight | Unused Z-program, table, and interface retirement preflight validator | M3 | spec_miner_survey_1 |
| 31 | Fiori 403 Root-Cause Doctor | PFCG role, authorization object (S_START, S_SERVICE), ICF service catalog auditor | M3 | spec_miner_survey_1 |
| 32 | Workflow Stuck Explainer | SWWWIHEAD / SWZAI analyse for blocked work items and agent assignment errors | M3 | spec_miner_survey_1 |
| 33 | IAM Cost Optimizer | Fiori catalog over-licensing and authorization license tier minimizer | M3 | spec_miner_survey_1 |
| 34 | Account Determination Preflight | OBYC, VKOA, and automatic account determination rule validator | M3 | spec_miner_survey_1 |
| 35 | System Refresh Delta Guard | Post-refresh BDLS, RFC destination, and logical system change validator | M3 | spec_miner_survey_1 |
| 36 | MFS BlackBox | Material Flow System / EWM telegram sequence and telegram buffer auditor | M3 | spec_miner_survey_1 |
| 37 | Coolify Docker Compose | `docker-compose.coolify.yml` orchestrating web, api, analysis-python, postgres, redis | M4 | spec_miner_survey_2 |
| 38 | Hardened Non-Root Dockerfiles | Multi-stage Dockerfiles with UID 10001 non-root users and minimal base images | M4 | spec_miner_survey_2 |
| 39 | Production Environment Matrix | Comprehensive `.env.example` documenting all configuration keys | M4 | spec_miner_survey_2 |
| 40 | Health Check Endpoints | `/health/liveness` and `/health/readiness` across all services | M4 | spec_miner_survey_2 |
| 41 | Automated Migration Runner | `apps/api/entrypoint.sh` running Prisma/Kysely/TypeORM migrations on container startup | M4 | spec_miner_survey_2 |
| 42 | E2E Testing Infrastructure | Opaque-box test harness, runner, and assertion library | Track-E2E | master prompt |
| 43 | Tier 1 Feature Tests (5x/feat) | Happy-path tests verifying all 41 platform and engine features | Track-E2E | master prompt |
| 44 | Tier 2 Boundary & Corner Tests | Edge cases, corrupt payloads, rate limits, large archives, Unicode | Track-E2E | master prompt |
| 45 | Tier 3 Cross-Feature Tests | Pairwise cross-engine and cross-module end-to-end integration tests | Track-E2E | master prompt |
| 46 | Tier 4 Real-World Scenarios | End-to-end real customer SAP migration audit workloads | Track-E2E | master prompt |
| 47 | Tier 5 Adversarial Coverage Hardening | White-box stress tests, mutation testing, coverage gap closure | M5 | master prompt |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| **M1** | Monorepo Foundation & Persistence | pnpm workspaces, Next.js web app, NestJS core API, Python FastAPI service, PostgreSQL 16 schema + pgvector + RLS, Redis BullMQ, shared TS packages, ADRs | none | DONE |
| **M2** | Secure Ingestion & Shared Platform Services | MIME validation, archive safety, secret redaction, S3 pre-signed URLs, Evidence Engine, Confidence Classifier, AI Problem Router, Audit Trail, Export Engine | M1 | DONE |
| **M3** | 18 SAP Preflight Engines Suite | Full implementation of all 18 SAP preflight engines + MFS BlackBox with deterministic parsers, domain rules, Pydantic models, and fixtures | M1, M2 | IN_PROGRESS |
| **M4** | Hostinger & Coolify Deployment | `docker-compose.coolify.yml`, multi-stage non-root Dockerfiles, `.env.example`, health checks, automated migration runner | M1, M2, M3 | PLANNED |
| **M5** | E2E Test Suite Pass & Adversarial Hardening | Phase 1: 100% pass rate on Tiers 1-4 from E2E test suite. Phase 2: Tier 5 adversarial coverage hardening | M1-M4, Track-E2E | PLANNED |
| **Track-E2E** | E2E Testing Track | Independent opaque-box test suite: Runner, Tiers 1-4 test cases (≥5 per feature, boundary, pairwise, application scenarios), publishes `TEST_READY.md` | none | DONE |

---

## Interface Contracts

### 1. NestJS Core API ↔ Python Analysis Engine (`POST /api/v1/analyze`)
**Request Body**:
```json
{
  "job_id": "string (UUID)",
  "tenant_id": "string (UUID)",
  "project_id": "string (UUID)",
  "engine_type": "string (e.g. OPD_GUARD, FORM_DOCTOR, ...)",
  "target_release": "string (e.g. S4H_2023, S4HC_2402)",
  "artifact_s3_key": "string",
  "artifact_type": "string (XML | JSON | CSV | ZIP | ABAP | XDP | WSDL | TXT)",
  "configuration": {}
}
```
**Response Body**:
```json
{
  "job_id": "string (UUID)",
  "engine_type": "string",
  "status": "COMPLETED | FAILED | PARTIAL",
  "findings": [
    {
      "id": "string (UUID)",
      "rule_id": "string",
      "severity": "BLOCKER | CRITICAL | MAJOR | MINOR | INFO",
      "category": "string",
      "title": "string",
      "description": "string",
      "confidence": "VERIFIED | RULE_DERIVED | INFERRED | UNKNOWN",
      "confidence_score": 1.0,
      "remediation": "string",
      "evidence": [
        {
          "artifact_path": "string",
          "line_number": 42,
          "snippet": "string",
          "sha256": "string",
          "provenance": "VERIFIED"
        }
      ]
    }
  ],
  "metrics": {
    "execution_time_ms": 128,
    "rules_evaluated": 15,
    "artifacts_scanned": 1
  }
}
```

### 2. Multi-Tenant Database Context (`PostgreSQL RLS`)
Every database transaction executed by NestJS sets the session tenant:
```sql
SET LOCAL app.current_tenant_id = 'c1234567-89ab-cdef-0123-456789abcdef';
```
PostgreSQL RLS policies enforce `organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid` on all tenant-isolated tables.

### 3. File Ingestion & Redaction Pipeline
Raw Upload → Magic Byte Sniffer → Archive Inspector (Zip bomb/slip checks) → ClamAV Quarantine → Regex & Shannon Entropy Secret Redactor → Clean S3 Storage → Redis Analysis Queue.

---

## Code Layout

```
H:/erppreflight/
├── apps/
│   ├── web/                        # Next.js 15 App Router Frontend
│   └── api/                        # NestJS 11 Core SaaS API Backend
├── services/
│   └── analysis-python/            # Python 3.13 FastAPI Analysis Engine
│       ├── src/
│       │   ├── api/                # FastAPI routes & health endpoints
│       │   ├── core/               # Engine runner & dispatcher
│       │   ├── engines/            # 18 Preflight Engines + MFS BlackBox
│       │   ├── parsers/            # Deterministic XML, JSON, CSV, ABAP parsers
│       │   ├── platform/           # Evidence, Confidence, AI Router, Audit
│       │   └── models/             # Pydantic schemas
│       └── tests/                  # Pytest test suite & golden fixtures
├── packages/
│   ├── schemas/                    # Shared Zod / TypeScript schemas
│   ├── database/                   # Prisma / Kysely PostgreSQL client & migrations
│   ├── tenancy/                    # Multi-tenant context & RLS guards
│   ├── auth/                       # JWT / Session authentication utils
│   └── evidence/                   # Shared evidence model & hashing
├── infra/
│   ├── coolify/                    # docker-compose.coolify.yml & configs
│   └── docker/                     # Dockerfiles for web, api, analysis-python
├── tests/
│   └── e2e/                        # Opaque-box E2E test harness & Tiers 1-4 tests
├── .gitattributes                  # EOL handling (* text=auto eol=lf)
├── package.json                    # Root package.json (pnpm monorepo)
├── pnpm-workspace.yaml             # pnpm workspace definition
├── tsconfig.json                   # Base TypeScript config
└── docker-compose.coolify.yml      # Root symlink / compose for Coolify
```
