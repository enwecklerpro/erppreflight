# Milestone 1: Monorepo Foundation & Next.js Web App Implementation Plan

**Author**: `m1_explorer_1`  
**Date**: 2026-09-24  
**Workspace Root**: `H:/erppreflight`  
**Milestone**: M1 — Monorepo Foundation & Persistence  
**Target Systems**: `apps/web`, `packages/*` (`schemas`, `database`, `tenancy`, `auth`, `evidence`), Root Toolchain  

---

## 1. Executive Summary & Monorepo Architecture

This plan specifies the complete, production-grade architecture and step-by-step implementation for the **Monorepo Foundation** and **Next.js Web Application** for ERP Preflight.

The workspace architecture is built on **pnpm workspaces** managed with **Turborepo** (`turbo`), standardizing dependency isolation, caching, and deterministic builds.

### 1.1 High-Level Topological Layout

```text
H:/erppreflight/
├── apps/
│   ├── web/                      # Next.js 15 App Router Frontend (Port 3000)
│   └── api/                      # NestJS 11 Core SaaS API Backend (Port 3001/4000) [m1_explorer_2]
├── services/
│   └── analysis-python/          # Python 3.13 FastAPI Engine (Port 8000) [m1_explorer_3]
├── packages/
│   ├── schemas/                  # @erppreflight/schemas (Zod schemas, shared DTOs)
│   ├── database/                 # @erppreflight/database (PostgreSQL 16 pool, RLS, migrations)
│   ├── tenancy/                  # @erppreflight/tenancy (AsyncLocalStorage, tenant context)
│   ├── auth/                     # @erppreflight/auth (JWT, RBAC/PBAC matrix, API keys)
│   └── evidence/                 # @erppreflight/evidence (SHA-256 hashing, provenance, trust tiers)
├── tests/
│   └── e2e/                      # Opaque-box test harness & fixtures [Track-E2E]
├── .gitattributes                # Enforce LF endings (* text=auto eol=lf)
├── .gitignore                    # Enterprise monorepo gitignore
├── .editorconfig                 # Code formatting standard
├── pnpm-workspace.yaml           # Monorepo workspace mapping
├── package.json                  # Root monorepo scripts & dependencies
├── tsconfig.base.json            # Base compiler options
├── tsconfig.json                 # Project references & root compiler config
└── turbo.json                    # Turborepo task pipeline
```

### 1.2 Package Dependency Flow (DAG)

Strict unidirectional dependency hierarchy guaranteeing zero circular references:

```text
[ @erppreflight/schemas ]  (Zod contracts, enums, DTO interfaces)
       │
       ├──► [ @erppreflight/evidence ] (SHA-256, Confidence Classifier)
       ├──► [ @erppreflight/auth ]     (JWT, RBAC Matrix, API Keys)
       ├──► [ @erppreflight/tenancy ]  (AsyncLocalStorage, RLS Guard)
       └──► [ @erppreflight/database ] (PostgreSQL Client Pool, RLS Policies, Migrations)
              │
              ├──► [ apps/api ] (NestJS Core SaaS Backend)
              │
[ @erppreflight/schemas ] + [ @erppreflight/evidence ]
       │
       └──► [ apps/web ] (Next.js 15 Web Application + Universal Inspector)
```

---

## 2. Root Configuration Specification

### 2.1 `pnpm-workspace.yaml`
Declares the active package directories within the monorepo:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'services/*'
  - 'engines/*'
  - 'integrations/*'
```

### 2.2 `package.json` (Root)
Declares workspace orchestration scripts, devDependencies, and pinned package manager:

```json
{
  "name": "erppreflight-monorepo",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.20.0",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "clean": "turbo run clean",
    "test:python": "py -m pytest services/analysis-python/tests -v",
    "test:e2e": "py tests/e2e/runner.py",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md,yml,yaml}\""
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "eslint": "^9.20.0",
    "prettier": "^3.5.0",
    "turbo": "^2.4.4",
    "typescript": "^5.7.3"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  }
}
```

### 2.3 `turbo.json`
Configures Turborepo pipeline caching and topological task execution:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [
        ".next/**",
        "!.next/cache/**",
        "dist/**"
      ]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {
      "dependsOn": []
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    }
  }
}
```

### 2.4 `tsconfig.base.json` & `tsconfig.json`
Provides strict TypeScript compiler options and alias resolution:

**`tsconfig.base.json`**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  }
}
```

**`tsconfig.json` (Root)**:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@erppreflight/schemas": ["packages/schemas/src/index.ts"],
      "@erppreflight/schemas/*": ["packages/schemas/src/*"],
      "@erppreflight/database": ["packages/database/src/index.ts"],
      "@erppreflight/database/*": ["packages/database/src/*"],
      "@erppreflight/tenancy": ["packages/tenancy/src/index.ts"],
      "@erppreflight/tenancy/*": ["packages/tenancy/src/*"],
      "@erppreflight/auth": ["packages/auth/src/index.ts"],
      "@erppreflight/auth/*": ["packages/auth/src/*"],
      "@erppreflight/evidence": ["packages/evidence/src/index.ts"],
      "@erppreflight/evidence/*": ["packages/evidence/src/*"]
    }
  },
  "exclude": [
    "node_modules",
    "dist",
    ".next",
    "services/analysis-python"
  ]
}
```

### 2.5 `.gitattributes`
Guarantees consistent LF line endings across Windows host and Linux Docker containers:

```gitattributes
# Default line ending handling
* text=auto eol=lf

# Force LF on shell scripts and code
*.sh text eol=lf
*.py text eol=lf
*.ts text eol=lf
*.tsx text eol=lf
*.js text eol=lf
*.jsx text eol=lf
*.json text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.md text eol=lf
*.sql text eol=lf
Dockerfile* text eol=lf
```

### 2.6 `.gitignore`
Comprehensive monorepo ignore rules:

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Next.js Build Outputs
.next/
out/

# TypeScript Build Outputs
dist/
*.tsbuildinfo

# Python & Pytest
__pycache__/
*.py[cod]
*$py.class
.pytest_cache/
.venv/
venv/
*.egg-info/

# Turborepo
.turbo/

# Environment Variables
.env
.env.local
.env.*.local
!.env.example

# Logs & Diagnostics
logs/
*.log
npm-debug.log*
pnpm-debug.log*
yarn-debug.log*

# OS Artifacts
.DS_Store
Thumbs.db
Desktop.ini

# Coverage
coverage/
.nyc_output/
```

### 2.7 `.editorconfig`
```editorconfig
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.py]
indent_size = 4

[*.md]
trim_trailing_whitespace = false
```

---

## 3. Shared TypeScript Packages (`packages/`)

### 3.1 `packages/schemas` (`@erppreflight/schemas`)

#### `package.json`
```json
{
  "name": "@erppreflight/schemas",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "rimraf": "^6.0.1",
    "typescript": "^5.7.3"
  }
}
```

#### `tsconfig.json`
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

#### File Structure & Schema Definitions
- `src/common.ts`:
  - `SeverityEnum`: `'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO'`
  - `ConfidenceClassEnum`: `'VERIFIED' | 'RULE_DERIVED' | 'INFERRED' | 'UNKNOWN'`
  - `ConfidenceScoreMap`: `VERIFIED: 1.0, RULE_DERIVED: 0.85, INFERRED: 0.60, UNKNOWN: 0.30`
  - `EngineTypeEnum`: All 18 engines:
    - `OPD_GUARD`, `FORM_DOCTOR`, `CUSTOM_FIELD_FLOW_DOCTOR`, `EXTENSION_IMPACT_GUARD`
    - `SPRO2CLOUD`, `ECC2CLOUD_NAVIGATOR`, `SAP_GAP_RADAR`, `CLEAN_CORE_OBJECT_GUARD`
    - `CHANGE_POINTER_COVERAGE_AUDITOR`, `API_CHANGE_GUARD`
    - `SOFTWARE_COLLECTION_DEPENDENCY_GUARD`, `TRANSPORT_DEPENDENCY_ANALYZER`
    - `SAFE_DECOMMISSION_PREFLIGHT`, `FIORI_403_ROOT_CAUSE_DOCTOR`, `WORKFLOW_STUCK_EXPLAINER`
    - `IAM_COST_OPTIMIZER`, `ACCOUNT_DETERMINATION_PREFLIGHT`, `SYSTEM_REFRESH_DELTA_GUARD`
    - `MFS_BLACKBOX`
  - `TargetReleaseEnum`: `'S4H_2020' | 'S4H_2021' | 'S4H_2022' | 'S4H_2023' | 'S4HC_2402' | 'S4HC_2408'`
  - `ArtifactTypeEnum`: `'XML' | 'JSON' | 'CSV' | 'ZIP' | 'ABAP' | 'XDP' | 'WSDL' | 'TXT'`
  - `CleanCoreTierEnum`: `'TIER_1_CLOUD' | 'TIER_2_DEVELOPER' | 'TIER_3_CLASSIC'`

- `src/evidence.ts`:
  - `EvidenceItemSchema`:
    ```typescript
    export const EvidenceItemSchema = z.object({
      id: z.string().uuid().optional(),
      artifactPath: z.string(),
      lineNumber: z.number().int().positive().optional(),
      columnNumber: z.number().int().positive().optional(),
      snippet: z.string(),
      sha256: z.string().length(64),
      provenance: ConfidenceClassEnum,
      sourceType: z.enum(['AST', 'XML_DOM', 'CSV_TABLE', 'SAP_CONFIG', 'TEXT_SEARCH', 'LLM_PROSE']),
      title: z.string().optional(),
      url: z.string().url().optional()
    });
    export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
    ```

- `src/finding.ts`:
  - `AffectedObjectSchema`:
    ```typescript
    export const AffectedObjectSchema = z.object({
      name: z.string(),
      type: z.string(), // CLASS, CDS_VIEW, TABLE, FORM, BADI, CONFIG_ENTRY, TELEGRAM
      package: z.string().optional(),
      tier: CleanCoreTierEnum.optional()
    });
    ```
  - `FindingSchema`:
    ```typescript
    export const FindingSchema = z.object({
      id: z.string().uuid(),
      jobId: z.string().uuid().optional(),
      ruleId: z.string(),
      engineType: EngineTypeEnum,
      severity: SeverityEnum,
      category: z.string(),
      title: z.string(),
      description: z.string(),
      confidence: ConfidenceClassEnum,
      confidenceScore: z.number().min(0).max(1),
      remediation: z.string(),
      affectedObjects: z.array(AffectedObjectSchema).default([]),
      evidence: z.array(EvidenceItemSchema).default([]),
      fingerprint: z.string().optional()
    });
    export type Finding = z.infer<typeof FindingSchema>;
    ```

- `src/analysis.ts`:
  - `AnalysisJobRequestSchema`:
    ```typescript
    export const AnalysisJobRequestSchema = z.object({
      jobId: z.string().uuid(),
      tenantId: z.string().uuid(),
      projectId: z.string().uuid(),
      engineType: EngineTypeEnum,
      targetRelease: TargetReleaseEnum,
      artifactS3Key: z.string(),
      artifactType: ArtifactTypeEnum,
      configuration: z.record(z.unknown()).default({})
    });
    ```
  - `AnalysisJobResponseSchema`:
    ```typescript
    export const AnalysisJobResponseSchema = z.object({
      jobId: z.string().uuid(),
      engineType: EngineTypeEnum,
      status: z.enum(['COMPLETED', 'FAILED', 'PARTIAL']),
      findings: z.array(FindingSchema),
      metrics: z.object({
        executionTimeMs: z.number(),
        rulesEvaluated: z.number(),
        artifactsScanned: z.number()
      }),
      errorMessage: z.string().optional()
    });
    ```

- `src/project.ts`:
  - `ProjectSchema`: UUID, organizationId, name, slug, targetRelease, environments (`DEV`, `TEST`, `QA`, `PROD`), createdAt.
- `src/organization.ts`:
  - `OrganizationSchema`, `UserSchema`, `RoleEnum` (`ORGANIZATION_OWNER`, `SECURITY_ADMIN`, `LEAD_ARCHITECT`, `MIGRATION_CONSULTANT`, `AUDITOR`, `VIEWER`).
- `src/index.ts`: Unified export of all types, schemas, and enums.

---

### 3.2 `packages/evidence` (`@erppreflight/evidence`)

#### `package.json`
```json
{
  "name": "@erppreflight/evidence",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@erppreflight/schemas": "workspace:*",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "rimraf": "^6.0.1",
    "typescript": "^5.7.3"
  }
}
```

#### Core Modules
- `src/hashing.ts`:
  ```typescript
  import { createHash } from 'crypto';

  export function calculateSha256(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  export function createFindingFingerprint(
    ruleId: string,
    affectedObjectName: string,
    artifactPath: string
  ): string {
    return calculateSha256(`${ruleId}:${affectedObjectName}:${artifactPath}`);
  }
  ```
- `src/classifier.ts`:
  Enforces the core system invariant: **LLM outputs can never exceed `INFERRED` (score 0.60)**.
  ```typescript
  import { ConfidenceClassEnum } from '@erppreflight/schemas';

  export type ConfidenceClass = 'VERIFIED' | 'RULE_DERIVED' | 'INFERRED' | 'UNKNOWN';

  export const CONFIDENCE_SCORES: Record<ConfidenceClass, number> = {
    VERIFIED: 1.0,
    RULE_DERIVED: 0.85,
    INFERRED: 0.60,
    UNKNOWN: 0.30
  };

  export function classifyProvenance(options: {
    isExactParserOrAstMatch: boolean;
    isDeterministicRule: boolean;
    isLlmGenerated: boolean;
    hasEvidence: boolean;
  }): { confidence: ConfidenceClass; score: number } {
    if (!options.hasEvidence) {
      return { confidence: 'UNKNOWN', score: CONFIDENCE_SCORES.UNKNOWN };
    }
    if (options.isLlmGenerated) {
      // Hard invariant: LLM can never be VERIFIED or RULE_DERIVED
      return { confidence: 'INFERRED', score: CONFIDENCE_SCORES.INFERRED };
    }
    if (options.isExactParserOrAstMatch) {
      return { confidence: 'VERIFIED', score: CONFIDENCE_SCORES.VERIFIED };
    }
    if (options.isDeterministicRule) {
      return { confidence: 'RULE_DERIVED', score: CONFIDENCE_SCORES.RULE_DERIVED };
    }
    return { confidence: 'UNKNOWN', score: CONFIDENCE_SCORES.UNKNOWN };
  }
  ```
- `src/chain.ts`:
  Tamper-evident SHA-256 audit chaining:
  ```typescript
  export function computeAuditNodeHash(
    prevHash: string,
    timestamp: string,
    tenantId: string,
    action: string,
    payloadHash: string
  ): string {
    return calculateSha256(`${prevHash}|${timestamp}|${tenantId}|${action}|${payloadHash}`);
  }
  ```

---

### 3.3 `packages/auth` (`@erppreflight/auth`)

#### `package.json`
```json
{
  "name": "@erppreflight/auth",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@erppreflight/schemas": "workspace:*",
    "jsonwebtoken": "^9.0.2"
  },
  "devDependencies": {
    "@types/jsonwebtoken": "^9.0.8",
    "@types/node": "^22.13.0",
    "rimraf": "^6.0.1",
    "typescript": "^5.7.3"
  }
}
```

#### Core Modules
- `src/jwt.ts`:
  ```typescript
  import jwt from 'jsonwebtoken';

  export interface AuthTokenPayload {
    sub: string; // userId (UUID)
    email: string;
    organizationId: string; // tenantId (UUID)
    role: string;
    iat?: number;
    exp?: number;
  }

  export function signAuthToken(payload: AuthTokenPayload, secret: string, expiresIn = '8h'): string {
    return jwt.sign(payload, secret, { expiresIn });
  }

  export function verifyAuthToken(token: string, secret: string): AuthTokenPayload {
    return jwt.verify(token, secret) as AuthTokenPayload;
  }
  ```
- `src/roles.ts` & `src/permissions.ts`:
  Role-Based Access Control matrix declaring permissions:
  - `PERMISSIONS`: `ANALYSIS_RUN`, `ARTIFACT_UPLOAD`, `PROJECT_CREATE`, `REPORT_EXPORT`, `SETTINGS_MANAGE`, `USER_INVITE`.
  - Roles mapped:
    - `ORGANIZATION_OWNER`: All permissions
    - `SECURITY_ADMIN`: All except billing mutations
    - `LEAD_ARCHITECT`: `ANALYSIS_RUN`, `ARTIFACT_UPLOAD`, `PROJECT_CREATE`, `REPORT_EXPORT`
    - `MIGRATION_CONSULTANT`: `ANALYSIS_RUN`, `ARTIFACT_UPLOAD`, `REPORT_EXPORT`
    - `AUDITOR`: Read-only + `REPORT_EXPORT`
    - `VIEWER`: Read-only

---

### 3.4 `packages/tenancy` (`@erppreflight/tenancy`)

#### `package.json`
```json
{
  "name": "@erppreflight/tenancy",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@erppreflight/schemas": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "rimraf": "^6.0.1",
    "typescript": "^5.7.3"
  }
}
```

#### Core Modules
- `src/context.ts`:
  Uses Node.js `AsyncLocalStorage` to guarantee bulletproof tenant context propagation across asynchronous call stacks:
  ```typescript
  import { AsyncLocalStorage } from 'async_hooks';

  export interface TenantContext {
    tenantId: string; // UUID
    organizationSlug?: string;
    userId?: string;
  }

  const tenantStorage = new AsyncLocalStorage<TenantContext>();

  export function runWithTenantContext<R>(context: TenantContext, fn: () => R): R {
    return tenantStorage.run(context, fn);
  }

  export function getTenantContext(): TenantContext | undefined {
    return tenantStorage.getStore();
  }

  export function requireTenantId(): string {
    const ctx = getTenantContext();
    if (!ctx || !ctx.tenantId) {
      throw new Error('TenantContextMissingException: No active tenant context in async store');
    }
    return ctx.tenantId;
  }
  ```
- `src/guard.ts`:
  ```typescript
  export function assertTenantMatch(resourceTenantId: string, requestedTenantId: string): void {
    if (resourceTenantId !== requestedTenantId) {
      throw new Error('TenantIsolationViolationException: Access denied to foreign tenant entity');
    }
  }
  ```

---

### 3.5 `packages/database` (`@erppreflight/database`)

#### `package.json`
```json
{
  "name": "@erppreflight/database",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@erppreflight/schemas": "workspace:*",
    "@erppreflight/tenancy": "workspace:*",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "@types/pg": "^8.11.11",
    "rimraf": "^6.0.1",
    "typescript": "^5.7.3"
  }
}
```

#### Core Modules
- `src/client.ts`:
  PostgreSQL pool factory with connection healthcheck and parameterized query helpers.
- `src/rls.ts`:
  Executes queries scoped inside a transaction with PostgreSQL session variable:
  ```typescript
  import { Pool, PoolClient } from 'pg';

  export async function withTenantTransaction<T>(
    pool: Pool,
    tenantId: string,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Set PostgreSQL session tenant variable for Row-Level Security
      await client.query('SET LOCAL app.current_tenant_id = $1', [tenantId]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  ```
- `src/migrations/runner.ts`:
  Forward-only migration runner scanning `.sql` files in `migrations/` and tracking execution state in `_migrations` table.
- SQL Migration Files:
  - `001_initial_schema.sql`: Base tables (`organizations`, `users`, `projects`, `uploaded_files`, `analyses`, `findings`, `evidence_items`, `audit_events`).
  - `002_pgvector_hnsw.sql`: `CREATE EXTENSION IF NOT EXISTS vector;`, `knowledge_objects` and `evidence_items` vector columns, HNSW index definitions.
  - `003_rls_policies.sql`: Row-Level Security `CREATE POLICY` on tenant-scoped tables matching `organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`.

---

## 4. Next.js 15 Web Application (`apps/web`)

### 4.1 Technology Stack & `package.json`

```json
{
  "name": "@erppreflight/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start --port 3000",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@erppreflight/evidence": "workspace:*",
    "@erppreflight/schemas": "workspace:*",
    "@radix-ui/react-dialog": "^1.1.6",
    "@radix-ui/react-dropdown-menu": "^2.1.6",
    "@radix-ui/react-select": "^2.1.6",
    "@radix-ui/react-slot": "^1.1.2",
    "@radix-ui/react-tabs": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.1.8",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.475.0",
    "next": "^15.1.7",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^3.0.1",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "@types/react": "^19.0.8",
    "@types/react-dom": "^19.0.3",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.20.0",
    "eslint-config-next": "^15.1.7",
    "postcss": "^8.5.2",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5.7.3"
  }
}
```

### 4.2 Configuration Files

#### `next.config.mjs`
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: [
    '@erppreflight/schemas',
    '@erppreflight/evidence'
  ],
  experimental: {
    // optimize package imports for tree-shaking
    optimizePackageImports: ['lucide-react']
  }
};

export default nextConfig;
```

#### `tailwind.config.ts`
```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: '#0284c7', // Enterprise SAP Cyan/Blue
          foreground: '#ffffff',
          dark: '#0369a1'
        },
        cleanCore: {
          tier1: '#10b981', // Emerald Cloud
          tier2: '#3b82f6', // Developer Blue
          tier3: '#f59e0b'  // Classic Amber
        },
        severity: {
          blocker: '#ef4444',
          critical: '#f97316',
          major: '#eab308',
          minor: '#3b82f6',
          info: '#64748b'
        }
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
};

export default config;
```

---

### 4.3 Next.js App Router Structure & Pages

```text
apps/web/src/
├── app/
│   ├── layout.tsx                    # Root Layout (Metadata, Inter font, Navigation Shell)
│   ├── page.tsx                      # Landing / Hero / Redirection to Dashboard
│   ├── not-found.tsx                 # 404 Empty State
│   ├── error.tsx                     # Error Boundary with Support Correlation ID
│   ├── loading.tsx                   # Suspense fallback skeleton
│   ├── health/
│   │   ├── liveness/route.ts         # GET /health/liveness -> 200 OK
│   │   └── readiness/route.ts        # GET /health/readiness -> 200 OK
│   ├── (auth)/
│   │   ├── login/page.tsx            # Login with Tenant slug, email, password
│   │   └── signup/page.tsx           # Organization registration
│   ├── (dashboard)/
│   │   ├── layout.tsx                # Dashboard Layout: Sidebar, Header, Breadcrumbs, Tenant Switcher
│   │   ├── dashboard/page.tsx        # Executive Preflight Dashboard
│   │   ├── projects/
│   │   │   ├── page.tsx              # Projects Directory & Create Project Modal
│   │   │   └── [projectId]/
│   │   │       ├── page.tsx          # Project Workspace (Environments, Ingestion, Run Trigger)
│   │   │       ├── analyses/[analysisId]/page.tsx # Run Summary & Findings Filter
│   │   │       └── inspector/page.tsx # Universal Object & Analysis Inspector Drilldown
│   │   └── settings/page.tsx         # Organization settings, team members, API keys
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx               # Collapsible navigation sidebar
│   │   ├── Header.tsx                # Organization switcher, notifications, user avatar
│   │   └── Breadcrumbs.tsx           # Dynamic navigation trail
│   ├── dashboard/
│   │   ├── CleanCoreGauge.tsx        # Radial/meter Clean Core readiness percentage
│   │   ├── EngineMatrixGrid.tsx      # Interactive 18-engine operational domain cards
│   │   ├── BlockerAlertBanner.tsx    # High-visibility blocker alert notifications
│   │   └── RecentRunsTable.tsx       # Execution history table
│   ├── workspace/
│   │   ├── ArtifactUploadZone.tsx    # Drag-and-drop uploader with pipeline stage animations
│   │   ├── IngestionPipelineStatus.tsx # Magic bytes, Quarantine, Secret Redaction badges
│   │   ├── RunTriggerModal.tsx       # Engine selection and execution launcher
│   │   └── EnvironmentSelector.tsx   # DEV / QA / PROD switcher
│   ├── inspector/
│   │   ├── FindingDetailModal.tsx    # Slide-over or deep drilldown finding inspector
│   │   ├── ProvenanceBadge.tsx       # VERIFIED, RULE_DERIVED, INFERRED badge with score
│   │   ├── CodeSnippetViewer.tsx     # Syntax-highlighted AST / XML / ABAP code viewer
│   │   ├── EvidenceLedger.tsx        # Cryptographic SHA-256 hash list and artifact links
│   │   └── RemediationCard.tsx       # Concrete clean core remediation advice & ABAP tier
│   └── ui/                           # Base components (Button, Card, Badge, Tabs, Dialog, Table)
└── lib/
    ├── utils.ts                      # cn(), formatBytes(), formatDate(), truncateHash()
    ├── api-client.ts                 # Resilient API Client with mock fallback
    ├── mock-data.ts                  # Authentic SAP fixtures for all 18 engines & projects
    └── types.ts                      # View models & UI component contracts
```

---

### 4.4 Screen & Feature Specifications

#### 1. Responsive Executive Dashboard (`/dashboard`)
- **Clean Core Readiness Gauge**: Overall migration readiness index (e.g. 78% Clean Core Score).
- **Executive Metric Cards**:
  - Total Scanned Artifacts (e.g. 1,420 files)
  - Active Findings by Severity (Blockers: 3, Critical: 14, Major: 32, Minor: 89)
  - Automated Remediations Ready (e.g. 45 objects)
  - Target Release: SAP S/4HANA 2023 FPS02
- **18-Engine Status Matrix Grid**:
  Divided into the 6 canonical operational domains:
  1. *Output & Extensibility*: OPD Guard, FormDoctor, Custom Field Flow Doctor, Extension Impact Guard.
  2. *Migration & Clean Core*: SPRO2Cloud, ECC2Cloud Navigator, SAP Gap Radar, Clean Core Object Guard.
  3. *Integration*: Change Pointer Coverage Auditor, API Change Guard.
  4. *Release & Transport*: Software Collection Dependency Guard, Transport Dependency Analyzer.
  5. *Operations*: Safe Decommission Preflight, Fiori 403 Root-Cause Doctor, Workflow Stuck Explainer, IAM Cost Optimizer, Account Determination Preflight, System Refresh Delta Guard.
  6. *Warehouse Automation*: MFS BlackBox.
  - Each engine card shows: Health status badge (`HEALTHY`, `NEEDS_ATTENTION`, `FAILED`, `UNEVALUATED`), findings count, last run duration.

#### 2. Project Workspace (`/projects/[projectId]`)
- **Header & Scope**: Project Title, SAP Source Release (e.g. ECC 6.0 EHP8) -> Target SAP Release (e.g. S/4HANA 2023), Environment selector (`DEV`, `QA`, `PROD`).
- **Tabbed Interface**:
  - **Overview**: Target release roadmap, environment delta overview, quick stats.
  - **Artifact Ingestion**:
    - Interactive upload dropzone supporting `.xml`, `.json`, `.csv`, `.zip`, `.abap`, `.xdp`.
    - Live visual pipeline progress indicators:
      1. Magic-byte verification (MIME check)
      2. Quarantine safety (Zip bomb / Zip slip / XXE check)
      3. Secret & credential redaction (`[REDACTED_PASSWORD]`)
      4. SHA-256 fingerprinting
    - Table of uploaded files with SHA-256 digests and status badges.
  - **Analysis Runs**: Historical execution log with status (`COMPLETED`, `RUNNING`, `FAILED`), execution time, rules evaluated, and link to inspector.
  - **Launch Preflight Run**: Modal to select all 18 engines or custom subset, select target release, and dispatch BullMQ job.

#### 3. Universal Analysis & Object Inspector (`/projects/[projectId]/inspector`)
Aligned with Master Prompt §14.35 & §14.36:
- **Finding Header**: Severity pill (`BLOCKER`, `CRITICAL`), finding title, rule ID (`CC-012`, `OPD-004`, `FORM-002`), origin engine.
- **Provenance & Confidence Meter**:
  - `VERIFIED` (1.00) — Direct deterministic AST / schema proof (Green shield).
  - `RULE_DERIVED` (0.85) — Deterministic domain rule evaluation (Blue scale).
  - `INFERRED` (0.60) — Semantic matching or LLM summarization (Amber alert).
  - `UNKNOWN` (0.30) — Incomplete evidence or missing configuration (Gray badge).
- **Code & AST Snippet Viewer**:
  - Displays verbatim source code or XML payload with line numbers and highlighted violation line.
  - Tab toggle between Raw Artifact, Normalized AST, and Evidence Provenance.
- **Evidence Ledger**:
  - SHA-256 checksum with one-click copy button.
  - File path within uploaded archive (e.g., `src/zcl_order_post.clas.abap:142`).
  - Cryptographic verification signature.
- **Remediation & Clean Core Advice**:
  - Recommended replacement (e.g. "Migrate classic direct table access to released CDS View `I_JournalEntryItem`").
  - ABAP Cloud Extensibility Tier classification: Tier 1 (Cloud Ready), Tier 2 (Developer Extensibility with wrapped API), Tier 3 (Classic modification - Blocked).

#### 4. Resilient Mock API Client (`apps/web/src/lib/api-client.ts`)
- **Dual-Mode Operation**:
  - Inspects `process.env.NEXT_PUBLIC_USE_MOCK`.
  - When `true` (or when backend HTTP fetch fails during development/SSR static generation), seamlessly returns authentic mock fixture data.
  - When `false` and backend is live, makes standard authenticated REST calls to `NEXT_PUBLIC_API_URL`.
- **Authentic SAP Mock Data**:
  - Multi-tenant organization (`Acme Global Enterprise`, tenant ID `c1234567-89ab-cdef-0123-456789abcdef`).
  - Real projects: `ECC to S/4HANA 2023 Cloud Migration`, `Adobe Forms Modernization`.
  - Realistic findings for all 18 engines:
    - `OPD Guard`: Shadowed BRFplus decision table row for Billing Document output channel.
    - `FormDoctor`: Adobe XDP missing data binding path `$.data.Invoice.TaxSummary`.
    - `Clean Core Object Guard`: Classic direct database update `UPDATE vbak SET ...` violating ABAP Cloud Tier 1.
    - `Change Pointer Auditor`: Missing BD52 field entry for `MATMAS` message type.
    - `Fiori 403 Doctor`: Missing authorization object `S_SERVICE` hash in PFCG role `Z_FI_ACCOUNTANT`.
    - `MFS BlackBox`: Out-of-order telegram sequence detected on conveyor PLC PLC01.

---

## 5. Monorepo Build & Compile Strategy (Zero TypeScript Errors)

To guarantee that `pnpm run build` succeeds cleanly with zero TypeScript errors across the entire monorepo, the following build rules must be strictly enforced:

### 5.1 Build Ordering & Dependencies

1. **Topological Build Sequence via Turborepo**:
   - `packages/schemas` builds first (compiles Zod models and emits `.d.ts` to `dist/`).
   - `packages/evidence`, `packages/auth`, `packages/tenancy`, and `packages/database` build second (relying on `@erppreflight/schemas`).
   - `apps/web` (and `apps/api`) build last.
2. **Next.js `transpilePackages` Integration**:
   - `apps/web/next.config.mjs` configures:
     `transpilePackages: ['@erppreflight/schemas', '@erppreflight/evidence']`
   - This ensures Next.js directly bundles the workspace packages using webpack/Turbopack, preventing common ESM/CJS interop issues.
3. **TypeScript Path Mapping in Root `tsconfig.json`**:
   - Root `tsconfig.json` provides `paths` aliases mapping `@erppreflight/*` directly to `packages/*/src/index.ts`.
   - IDEs, linters, and typecheckers resolve TypeScript source files instantly without waiting for intermediate `dist/` compilation.
4. **React 19 & Next.js 15 Type Alignment**:
   - All components in `apps/web` use React 19 types (`@types/react@^19.0.8`).
   - Component props use explicit TypeScript interfaces; no implicit `any`.
   - Server Components and Client Components are clearly separated with `"use client"` where state, hooks, or event listeners are required.
5. **Safe Static Generation (SSG) in Next.js**:
   - Next.js pre-renders pages during `next build`.
   - The Mock API Client (`api-client.ts`) guarantees that if external backend services are offline during build, pages fall back to static fixtures rather than throwing unhandled network exceptions.
   - Dynamic route parameters (`[projectId]`, `[analysisId]`) implement `generateStaticParams()` or handle runtime dynamic rendering gracefully.

---

## 6. Implementation Checklist & Verification Procedures

### Step 1: Initialize Git & Repository Baseline
- [ ] Run `git init -b main` in `H:/erppreflight`.
- [ ] Write `.gitattributes` (`* text=auto eol=lf`) to lock LF endings.
- [ ] Write `.gitignore` and `.editorconfig`.

### Step 2: Monorepo Foundation & Orchestration
- [ ] Create root `pnpm-workspace.yaml`.
- [ ] Create root `package.json` with scripts (`build`, `lint`, `test`, `typecheck`, `dev`).
- [ ] Create `turbo.json` with pipeline definitions.
- [ ] Create `tsconfig.base.json` and root `tsconfig.json`.

### Step 3: Shared TypeScript Packages (`packages/`)
- [ ] Implement `packages/schemas`:
  - `package.json`, `tsconfig.json`
  - `src/common.ts`, `src/evidence.ts`, `src/finding.ts`, `src/analysis.ts`, `src/project.ts`, `src/organization.ts`, `src/artifact.ts`, `src/index.ts`
- [ ] Implement `packages/evidence`:
  - `package.json`, `tsconfig.json`
  - `src/hashing.ts` (SHA-256), `src/classifier.ts` (Provenance & LLM demotion), `src/chain.ts`, `src/index.ts`
- [ ] Implement `packages/auth`:
  - `package.json`, `tsconfig.json`
  - `src/jwt.ts`, `src/roles.ts`, `src/permissions.ts`, `src/api-key.ts`, `src/index.ts`
- [ ] Implement `packages/tenancy`:
  - `package.json`, `tsconfig.json`
  - `src/context.ts` (AsyncLocalStorage), `src/types.ts`, `src/guard.ts`, `src/index.ts`
- [ ] Implement `packages/database`:
  - `package.json`, `tsconfig.json`
  - `src/client.ts`, `src/models.ts`, `src/rls.ts` (`withTenantTransaction`), `src/migrations/runner.ts`, SQL migrations `001`, `002`, `003`

### Step 4: Next.js 15 Web Application (`apps/web`)
- [ ] Create `apps/web/package.json` with Next.js 15, React 19, Tailwind, Radix UI, Lucide icons.
- [ ] Configure `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `tsconfig.json`.
- [ ] Implement `apps/web/src/lib/api-client.ts` and `apps/web/src/lib/mock-data.ts`.
- [ ] Implement Root Layout (`layout.tsx`), Global Error Boundary (`error.tsx`), Not Found (`not-found.tsx`), Health routes (`/health/liveness`, `/health/readiness`).
- [ ] Implement Dashboard Shell (`(dashboard)/layout.tsx`, `Sidebar.tsx`, `Header.tsx`).
- [ ] Implement Executive Dashboard (`/dashboard/page.tsx`, `CleanCoreGauge.tsx`, `EngineMatrixGrid.tsx`, `BlockerAlertBanner.tsx`).
- [ ] Implement Project Workspace (`/projects/[projectId]/page.tsx`, `ArtifactUploadZone.tsx`, `RunTriggerModal.tsx`).
- [ ] Implement Universal Object & Analysis Inspector (`/projects/[projectId]/inspector/page.tsx`, `FindingDetailModal.tsx`, `ProvenanceBadge.tsx`, `CodeSnippetViewer.tsx`, `EvidenceLedger.tsx`, `RemediationCard.tsx`).

### Step 5: Verification & Compile Validation
- [ ] Execute dependency installation:
  `$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"; pnpm install`
- [ ] Execute shared packages build:
  `$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"; pnpm --filter "@erppreflight/*" build`
- [ ] Execute full monorepo build:
  `$env:PATH = "C:\Users\SKAF\AppData\Roaming\npm;$env:PATH"; pnpm run build`
- [ ] Verify zero TypeScript errors (`tsc --noEmit`).
- [ ] Verify health check endpoints in `apps/web` return HTTP 200 OK.

---
*Comprehensive Monorepo & Web App Implementation Plan formulated by m1_explorer_1.*
