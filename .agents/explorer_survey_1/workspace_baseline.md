# Workspace Baseline Survey Report — ERP Preflight

**Author**: `explorer_survey_1`  
**Date**: 2026-09-24  
**Workspace Root**: `H:/erppreflight`  
**Host Environment**: Windows 11 Enterprise (10.0.26200 64-bit), PowerShell 5.1.26100.9549  
**Reference Documents**: 
- `H:/erppreflight/.agents/ORIGINAL_REQUEST.md`
- `H:/erppreflight/ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md`
- `H:/erppreflight/ERP_Preflight_Astra_Ultra_Prompt_Package_v5.zip`

---

## Executive Summary

The workspace at `H:/erppreflight` is currently in an uninitialized, pre-scaffolding specification state. The directory contains the complete set of architectural prompt specifications, addenda, and the `.agents/` orchestration hierarchy, but **zero source code, zero configuration files, and no initialized git repository**.

The host machine is exceptionally well-equipped for the full-scale build:
- **Node.js**: v22.20.0 LTS with `corepack` v0.34.0 and `pnpm` v10.20.0 installed.
- **Python**: v3.13.2 (via `py.exe`) with `pytest` v9.0.2, `fastapi`, `pydantic`, `uvicorn`, `SQLAlchemy`, and data/AI tooling pre-installed.
- **Docker**: Docker Engine v28.4.0 and Docker Compose v2.39.4-desktop.1 are active and operational.
- **Disk Storage**: Drive `H:` has 562 GB free out of 1 TB, and `pnpm` store is co-located at `H:\.pnpm-store\v10` (enabling fast, safe hard-linking without cross-volume penalties).
- **Git**: Git v2.51.0 is installed with `core.longpaths = true` and Windows OS `LongPathsEnabled = 1`.

Crucial environmental caveats have been identified regarding subagent PATH resolution, line ending normalization (CRLF vs LF), and a host port collision on port 6379 (occupied by an existing Redis container). Detailed mitigations and execution conventions are provided below.

---

## 1. File and Directory Inventory

### 1.1 Root Directory Contents (`H:/erppreflight`)

| File / Directory Name | Size | Type | Description |
|---|---|---|---|
| `14_MISSING_CRITICAL_REQUIREMENTS_ADDENDUM.md` | 22,311 B | File | Specification Addendum: Missing Production Requirements |
| `15_SAP_ECOSYSTEM_DELIVERY_INTEGRATIONS.md` | 12,345 B | File | Specification: SAP Ecosystem & Delivery Traceability |
| `16_CHANGE_SIMULATION_EXTENSIBILITY_ENTERPRISE.md` | 14,776 B | File | Specification: Change Simulation & Extensibility Platform |
| `17_TRUST_AI_KNOWLEDGE_RELEASE_GOVERNANCE.md` | 10,039 B | File | Specification: Trust Platform & AI Release Governance |
| `18_CONNECTOR_RELIABILITY_SUPPORT_OPERATIONS.md` | 7,937 B | File | Specification: Connector Governance & Operations |
| `19_AGENTIC_CHANGE_GATE_MCP_GOVERNANCE.md` | 7,324 B | File | Specification: Agentic Change Gate & MCP/A2A Governance |
| `20_SECURE_SDLC_AI_COMPLIANCE_ENTERPRISE_ASSURANCE.md` | 10,842 B | File | Specification: Secure SDLC & Enterprise Assurance |
| `ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (1).md` | 116,978 B | File | Historical revision of master prompt |
| `ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (2).md` | 89,843 B | File | Historical revision of master prompt |
| `ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md` | 153,148 B | File | **Canonical Master Specification** (7,975 lines, Parts 00–20 complete) |
| `ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT.md` | 67,525 B | File | Earlier combined copy of parts 00–13 |
| `ERP_Preflight_Astra_Ultra_Prompt_Package_v5.zip` | 127,211 B | Archive | Zip package containing individual parts `00_` through `20_` + Master Prompt |
| `ORIGINAL_REQUEST.md` | 4,612 B | File | Primary mission briefing, requirements R1–R4, and acceptance criteria |
| `README_PROMPT_PACKAGE.md` | 2,613 B | File | Reading guide and core principles |
| `.agents/` | Directory | Metadata | Multi-agent coordination directory |

### 1.2 Agent Coordination Directory (`H:/erppreflight/.agents`)

- `.agents/ORIGINAL_REQUEST.md`: Duplicate copy of original request.
- `.agents/orchestrator_main/`: Active workspace for `orchestrator_main` (contains `BRIEFING.md`, `DISPATCH.md`, `progress.md`, `init.md`).
- `.agents/sentinel/`: Workspace for system sentinel.
- `.agents/spec_miner_survey_1/`: Workspace for spec mining agent 1.
- `.agents/spec_miner_survey_2/`: Workspace for spec mining agent 2.
- `.agents/explorer_survey_1/`: This explorer workspace.

### 1.3 Source & Scaffolded Code Status
- **Source Folders**: None exist yet (`apps/`, `services/`, `engines/`, `packages/`, `integrations/`, `infra/` have not yet been created).
- **Git Repository**: Not yet initialized (`git status` reports `fatal: not a git repository (or any of the parent directories): .git`).

---

## 2. Toolchains, Runtimes & Infrastructure

### 2.1 Node.js & Package Managers

| Tool | Version | Path / Executable | Notes |
|---|---|---|---|
| **Node.js** | `v22.20.0` | `C:\Program Files\nodejs\node.exe` | Node 22 LTS, 64-bit |
| **npm** | `10.9.3` | `C:\Program Files\nodejs\npm.ps1` | Bundled with Node |
| **Corepack** | `0.34.0` | Node built-in | Can manage package manager versions |
| **pnpm** | `10.20.0` | `C:\Users\SKAF\AppData\Roaming\npm\pnpm.cmd` | Global install; see PATH warning below |
| **pnpm store** | v10 | `H:\.pnpm-store\v10` | **Co-located on drive `H:`**. Hard-links work cleanly without cross-drive issues. |
| **Other Node CLIs** | — | `C:\Users\SKAF\AppData\Roaming\npm\` | `pm2` (6.0.13), `serve` (14.2.1), `make.exe` (0.8.1), `@sap/cds-dk` (9.6.1), `zx` (8.8.4), `electron` (35.1.2) |

> ⚠️ **CRITICAL PATH ALERT for `pnpm`**:  
> In default PowerShell subshells spawned by agents, `C:\Users\SKAF\AppData\Roaming\npm` is **NOT present** in `$env:PATH`. Calling `pnpm` directly without prepending the PATH will fail with `CommandNotFoundException`.  
> **Mandatory Command Pattern**:  
> Every agent command invoking `pnpm` must prepend:  
> `$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"; pnpm <args>`  
> Alternatively, invoke via explicit path: `& "C:\Users\SKAF\AppData\Roaming\npm\pnpm.cmd" <args>`.

### 2.2 Python Runtime & Libraries

| Component | Version | Path / Invocation |
|---|---|---|
| **Python Launcher** | `3.12.1150` | `C:\WINDOWS\py.exe` |
| **Default Python** | `3.13.2` | `py` / `C:\Users\SKAF\AppData\Local\Programs\Python\Python313\python.exe` |
| **Secondary Python** | `3.12.x` | `py -3.12` / `C:\Users\SKAF\AppData\Local\Programs\Python\Python312\python.exe` |
| **Pip** | `26.0.1` | `py -m pip` |
| **Pytest** | `9.0.2` | `py -m pytest` (verified working) |

**Pre-Installed Python 3.13 Packages**:
FastAPI (`fastapi`), Uvicorn (`uvicorn` 0.34.3), Pydantic (`pydantic` 2.11.7, `pydantic-settings` 2.13.1), Pytest (`pytest` 9.0.2, `pytest-asyncio` 1.4.0), SQLAlchemy (`SQLAlchemy` 2.0.48), Redis (`redis` 6.4.0), PyYAML (`PyYAML` 6.0.2), HTTP clients (`requests` 2.31, `httpx`), Ruff (`ruff` 0.12.1), PyMuPDF (`PyMuPDF` 1.27.2.2), Tiktoken (`tiktoken` 0.9.0), Torch CPU (`torch` 2.7.1+cpu), Playwright (`playwright` 1.50+).

> ⚠️ **Python Execution Pattern**:  
> `python` directly is not registered in the system PATH; use `py` or `py -m <module>` (e.g., `py -m pytest`, `py -m uvicorn`, `py -m venv .venv`). For isolated service dependencies, create a virtual environment in `services/analysis-python`:  
> `py -m venv services/analysis-python/.venv` and activate via `.venv\Scripts\Activate.ps1`.

### 2.3 Docker & Container Infrastructure

| Service | Version | Status | Notes |
|---|---|---|---|
| **Docker Engine** | `28.4.0` (build d8eb465) | Running | Full daemon operational |
| **Docker Compose** | `v2.39.4-desktop.1` | Working | Supports `docker compose` v2 syntax |

**Active Containers Currently Running on Host**:
1. `f6b6f389a530` `redis:7-alpine` (`dj-redis`) — **Listening on `0.0.0.0:6379->6379/tcp`**
2. `6952dcc08970` `mysql:8.4.6` (`omninode-local-mysql-1`) — Listening on `127.0.0.1:3307->3306/tcp`
3. `fb7d73a3007f` `merch-upload-playwright` — Listening on `127.0.0.1:8090->8090/tcp`
4. `79793e885d7b` `merch-upload-skyvern` — Listening on `127.0.0.1:8091->8000/tcp`
5. `c56240169fa4` `merch-upload-skyvern-postgres` — Port 5432 internal (not mapped to host)

### 2.4 Host Database & Port Status

| Service / Port | State on Host | Implication for ERP Preflight |
|---|---|---|
| **PostgreSQL 18** | Running Windows Service (`postgresql-x64-18`) | Bound to **Port 1993** (NOT 5432). Host PostgreSQL exists at `C:\Program Files\PostgreSQL\18\bin\psql.exe`. |
| **Port 5432** | **FREE** on Host | Docker container for ERP Preflight PostgreSQL can safely map `5432:5432` without host collision. |
| **Port 6379** | **OCCUPIED** on Host (`0.0.0.0:6379`) | `dj-redis` container holds host port 6379. **ERP Preflight Redis container must NOT bind to host 6379**. |
| **Port 3000** | **FREE** | Next.js frontend default port is available. |
| **Port 3001** | **FREE** | NestJS backend default port is available. |
| **Port 8000** | **FREE** | FastAPI analysis engine default port is available. |
| **Port 8080** | OCCUPIED (127.0.0.1) | Used by another local service. |
| **Port 11434** | OCCUPIED (Ollama) | Host Ollama local LLM service is listening. |

### 2.5 Git & GitHub CLI

- **Git Version**: `2.51.0.windows.2` (`C:\Program Files\Git\cmd\git.exe`)
- **System Config**: `core.autocrlf = true`, `core.symlinks = false`, `core.longpaths = true`
- **GitHub CLI**: `gh version 2.92.0` (`C:\Program Files\GitHub CLI\gh.exe`), authenticated as `Mohamed Taha Khattari` (`enwecklerpro`).

---

## 3. Configuration File Audit

An exhaustive search across `H:/erppreflight` confirmed the existence of **zero configuration files**:
- `package.json`: None
- `pnpm-workspace.yaml`: None
- `pnpm-lock.yaml`: None
- `tsconfig.json` / `tsconfig.base.json`: None
- `turbo.json`: None
- `Dockerfile` / `docker-compose.yml` / `docker-compose.coolify.yml`: None
- `.gitignore`: None
- `.gitattributes`: None
- `.editorconfig`: None
- `.env` / `.env.example`: None

**Conclusion**: The workspace is completely greenfield for code and configuration scaffolding.

---

## 4. Windows Environment Constraints & Architectural Considerations

### 4.1 Redis Port 6379 Collision Mitigation
- **Problem**: Host port 6379 is bound by an active background container `dj-redis`. If ERP Preflight's `docker-compose.yml` or `docker-compose.coolify.yml` attempts to publish `6379:6379`, container startup will fail with `bind: address already in use`.
- **Mitigations**:
  1. For `docker-compose.coolify.yml` (deployed on Coolify / Linux VPS): Standard `6379` internal networking applies.
  2. For local `docker-compose.yml` (on Windows development host): Map host port to `6380:6379` or `16379:6379` (e.g., `ports: ["6380:6379"]`), while inside Docker network services communicate over `redis:6379`.
  3. Set `.env.example` with `REDIS_PORT=6379` for container-to-container and `REDIS_HOST_PORT=6380` for host-to-container access.

### 4.2 Git Line Endings (CRLF vs LF) & Docker Execution
- **Problem**: Git on this Windows machine has `core.autocrlf = true`. When files are created or checked out, Git converts LF to CRLF. When these files are copied into Linux container images (e.g. multi-stage Docker builds for NestJS, Next.js, FastAPI, or shell entrypoint scripts `entrypoint.sh`), Linux shells fail with `/bin/sh: entrypoint.sh: \r: not found` or `bad interpreter`.
- **Mandatory Mitigation**:
  1. When initializing Git repository (`git init -b main`), immediately create `.gitattributes`:
     ```gitattributes
     * text=auto eol=lf
     *.sh text eol=lf
     *.py text eol=lf
     *.ts text eol=lf
     *.tsx text eol=lf
     *.json text eol=lf
     *.yml text eol=lf
     *.yaml text eol=lf
     Dockerfile* text eol=lf
     ```
  2. Create `.editorconfig` with `end_of_line = lf` and `insert_final_newline = true`.

### 4.3 Subagent PATH and Toolchain Invocation Rules
- **PowerShell Execution Rules**:
  - Windows PowerShell 5.1 is the default shell. Do **not** use bash-style `&&` chaining unless running in a shell that supports it. Use `;` or test `$?`:
    `cmd1; if ($?) { cmd2 }`
  - In PowerShell 5.1, `curl` is an alias for `Invoke-WebRequest`. Do not rely on Linux `curl` flags unless calling `curl.exe` explicitly.
  - To run `pnpm`, always prepend the global npm folder to `$env:PATH`:
    `$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"; pnpm <command>`
  - To run Python commands:
    `py -m <command>` (e.g. `py -m pytest`, `py -m pip install`, `py -m uvicorn`)

### 4.4 Windows Long Paths and Monorepo Nesting
- Windows registry has `LongPathsEnabled = 1`, and Git has `core.longpaths = true`.
- Monorepos with deep `node_modules` or nested package structures will not trigger Windows MAX_PATH errors.
- Co-location of `pnpm` store on `H:\.pnpm-store\v10` guarantees NTFS hardlink creation succeeds across packages.

### 4.5 Target Monorepo File Layout (Master Prompt Part 03 Alignment)
The repository structure specified in `ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md` Part 03 must be scaffolded as follows:
```text
H:/erppreflight/
├─ apps/
│  ├─ web/                       # Next.js frontend (shadcn/ui, Tailwind, React 19/Next 15)
│  ├─ api/                       # NestJS API backend (REST, Swagger/OpenAPI, BullMQ)
│  ├─ admin/                     # Admin console / portal
│  ├─ docs/                      # Documentation site
│  └─ local-agent/               # Optional CLI/agent for enterprise customer boundary
├─ services/
│  ├─ analysis-python/           # FastAPI analysis engine (Pydantic, Polars, lxml, pytest)
│  ├─ ai-gateway/                # AI provider abstraction / routing gateway
│  ├─ search-indexer/            # Search indexing pipeline
│  └─ knowledge-sync/            # SAP release notes & note sync service
├─ engines/                      # 18 SAP Preflight Deterministic Engines:
│  ├─ opd/                       # OPD Guard
│  ├─ forms/                     # FormDoctor
│  ├─ custom-fields/             # Custom Field Flow Doctor
│  ├─ spro2cloud/                # SPRO2Cloud
│  ├─ ecc2cloud/                 # ECC2Cloud Navigator
│  ├─ gap-radar/                 # SAP Gap Radar
│  ├─ clean-core/                # Clean Core Object Guard
│  ├─ change-pointer/            # Change Pointer Coverage Auditor
│  ├─ api-change/                # API Change Guard
│  ├─ transport/                 # Transport Dependency Analyzer
│  ├─ extension-impact/          # Extension Impact Guard
│  ├─ decommission/              # Safe Decommission Preflight
│  ├─ fiori403/                  # Fiori 403 Root-Cause Doctor
│  ├─ workflow/                  # Workflow Stuck Explainer
│  ├─ iam-cost/                  # IAM Cost Optimizer
│  ├─ account-determination/     # Account Determination Preflight
│  ├─ system-refresh/            # System Refresh Delta Guard
│  └─ mfs/                       # MFS BlackBox
├─ packages/                     # Shared TypeScript/Node packages:
│  ├─ ui/                        # Shared UI components & design system tokens
│  ├─ schemas/                   # Zod schemas, OpenAPI DTOs, engine contracts
│  ├─ database/                  # Prisma / Drizzle / TypeORM migrations & client
│  ├─ auth/                      # Multi-tenant auth, RBAC, JWT utilities
│  ├─ tenancy/                   # Tenant isolation middleware & query scoping
│  ├─ audit/                     # Audit trail logging & provenance tracking
│  ├─ billing/                   # Stripe billing abstractions & usage metering
│  ├─ evidence/                  # Evidence Engine & provenance classifier
│  ├─ jobs/                      # BullMQ queue definitions & worker contracts
│  ├─ logging/                   # Structured logging (Pino) & correlation IDs
│  └─ config/                    # Shared eslint, tsconfig, prettier configurations
├─ integrations/                 # Connectors & ecosystem integrations:
│  ├─ rosa/                      # Red Hat / ROSA adapter
│  ├─ cloudification/            # Cloudification repository integration
│  ├─ abaplint/                  # ABAP linting & AST parser wrapper
│  ├─ abapgit/                   # abapGit repository ingestion
│  ├─ oasdiff/                   # OpenAPI specification diffing
│  ├─ odata/                     # OData v2/v4 metadata parser
│  ├─ gitleaks/                  # Secret scanning integration
│  ├─ sap-cloud-sdk/             # SAP Cloud SDK wrappers
│  └─ mfs-simulator/             # MFS telegram & PLC simulator
├─ infra/                        # Infrastructure and deployment definitions:
│  ├─ docker/                    # Multi-stage Dockerfiles (web, api, analysis)
│  ├─ terraform/                 # Cloud infrastructure modules
│  ├─ k8s/                       # Kubernetes manifests
│  └─ monitoring/                # Prometheus alerts, Grafana dashboards
├─ docker-compose.yml            # Local dev orchestration (Redis mapped to 6380)
├─ docker-compose.coolify.yml    # Production Coolify deployment composition
├─ pnpm-workspace.yaml           # Root pnpm workspace definition
├─ package.json                  # Root monorepo scripts & devDependencies
├─ turbo.json                    # Turborepo task pipeline caching configuration
├─ .gitignore                    # Standard monorepo ignore rules
├─ .gitattributes                # Enforce LF line endings
├─ IMPLEMENTATION_STATUS.md      # Living implementation tracking
├─ ARCHITECTURE_DECISIONS.md     # Architectural Decision Records (ADRs)
└─ .agents/                      # Strictly agent metadata (no source/tests allowed)
```

---

## 5. Recommended Immediate Next Steps for Orchestrator

1. **Repository Initialization**:
   - Run `git init -b main` in `H:/erppreflight`.
   - Write `.gitattributes` (`* text=auto eol=lf`) and `.gitignore` immediately to lock line endings and prevent polluting the repo.
2. **Monorepo Foundation (Milestone 1)**:
   - Create root `package.json`, `pnpm-workspace.yaml`, and `turbo.json`.
   - Configure workspaces: `apps/*`, `packages/*`, `services/*`, `engines/*`, `integrations/*`.
   - Configure global TypeScript base configuration (`tsconfig.base.json`).
3. **Execution Aliases & Scripts**:
   - Provide npm scripts in root `package.json` that abstract Windows PATH handling (`pnpm build`, `pnpm lint`, `pnpm test`, `pnpm test:python`).
4. **Environment File Definition**:
   - Create comprehensive `.env.example` reflecting host port reality (`REDIS_PORT=6379`, `REDIS_HOST_PORT=6380`, `POSTGRES_PORT=5432`, `API_PORT=3001`, `WEB_PORT=3000`, `PYTHON_PORT=8000`).

---
*Report generated and verified by explorer_survey_1 on 2026-09-24.*
