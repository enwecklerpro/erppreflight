# ERP Preflight — Milestone 1 Implementation Plan: NestJS Core API & PostgreSQL Persistence

Author: `m1_explorer_2` (Explorer Agent)  
Working Directory: `H:/erppreflight/.agents/m1_explorer_2`  
Reference Specifications: `ORIGINAL_REQUEST.md`, `PROJECT.md`, `platform_spec.md`, `ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT (3).md`  
Target Services: `apps/api`, `packages/database`, `packages/tenancy`, `packages/auth`, `packages/schemas`  
Target Persistence: PostgreSQL 16 + pgvector, Redis 7 (BullMQ)  
Timestamp: 2026-09-24T03:22:00+02:00  

---

## 1. Executive Summary & Architectural Overview

This plan provides the complete, authoritative implementation specification for **Milestone 1** covering the **NestJS 11 Core API Backend (`apps/api`)** and the **PostgreSQL 16 + pgvector Persistence Layer**.

### Core Invariants & Boundaries
1. **Centralized SaaS State Ownership**: The NestJS Core API exclusively governs multi-tenant authentication, workspace/project management, transactional persistence, billing status, and asynchronous job queuing. The Python analysis engine (`services/analysis-python`) remains completely stateless and decoupled from direct database writes.
2. **PostgreSQL Row Level Security (RLS) Defense-in-Depth**: Every tenant-owned table is protected by PostgreSQL RLS using session variable `app.current_tenant_id`. Every database transaction is scoped to the requesting organization, preventing cross-tenant data leakage even in the presence of application-level SQL logic bugs.
3. **AsyncLocalStorage Context Propagation**: The API employs Node.js `AsyncLocalStorage` to maintain tenant isolation across asynchronous request call chains without passing tenant parameters manually through every layer.
4. **Resilient Redis & BullMQ Coordination**: Background jobs for artifact ingestion, multi-engine analysis, and preflight exports are orchestrated via BullMQ queues with dual-port fallback (6379 vs 6380) for seamless local development and Dockerized production execution.
5. **Operational Health & Cold Boot Observability**: Independent `/health/liveness` and `/health/readiness` endpoints ensure zero-downtime container orchestration under Coolify and Traefik reverse proxies.

---

## 2. Directory Layout & Package Integration

```text
H:/erppreflight/
├── apps/
│   └── api/
│       ├── src/
│       │   ├── common/
│       │   │   ├── decorators/
│       │   │   │   ├── current-tenant.decorator.ts
│       │   │   │   ├── current-user.decorator.ts
│       │   │   │   └── roles.decorator.ts
│       │   │   ├── filters/
│       │   │   │   └── http-exception.filter.ts
│       │   │   ├── interceptors/
│       │   │   │   ├── correlation-id.interceptor.ts
│       │   │   │   └── logging.interceptor.ts
│       │   │   └── pipes/
│       │   │       └── validation.pipe.ts
│       │   ├── config/
│       │   │   ├── configuration.ts
│       │   │   └── env.validation.ts
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   │   ├── auth.controller.ts
│       │   │   │   ├── auth.service.ts
│       │   │   │   ├── auth.module.ts
│       │   │   │   ├── dto/
│       │   │   │   └── strategies/jwt.strategy.ts
│       │   │   ├── tenancy/
│       │   │   │   ├── tenancy.module.ts
│       │   │   │   ├── tenancy.middleware.ts
│       │   │   │   ├── tenancy.guard.ts
│       │   │   │   └── tenancy.service.ts
│       │   │   ├── workspaces/
│       │   │   │   ├── workspaces.controller.ts
│       │   │   │   ├── workspaces.service.ts
│       │   │   │   ├── workspaces.module.ts
│       │   │   │   └── dto/
│       │   │   ├── projects/
│       │   │   │   ├── projects.controller.ts
│       │   │   │   ├── projects.service.ts
│       │   │   │   ├── projects.module.ts
│       │   │   │   └── dto/
│       │   │   ├── jobs/
│       │   │   │   ├── jobs.module.ts
│       │   │   │   ├── jobs-producer.service.ts
│       │   │   │   ├── analysis-queue.processor.ts
│       │   │   │   ├── redis-connection.factory.ts
│       │   │   │   └── queue.constants.ts
│       │   │   ├── health/
│       │   │   │   ├── health.controller.ts
│       │   │   │   ├── health.service.ts
│       │   │   │   └── health.module.ts
│       │   │   └── database/
│       │   │       ├── database.module.ts
│       │   │       └── database.service.ts
│       │   ├── app.module.ts
│       │   └── main.ts
│       ├── entrypoint.sh
│       ├── package.json
│       ├── tsconfig.json
│       └── vitest.config.ts
├── packages/
│   ├── database/
│   │   ├── migrations/
│   │   │   ├── 0001_initial_schema.sql
│   │   │   ├── 0002_pgvector_hnsw.sql
│   │   │   └── 0003_rls_policies.sql
│   │   ├── src/
│   │   │   ├── client.ts
│   │   │   ├── migrate.ts
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── tenancy/
│   │   ├── src/
│   │   │   ├── context.ts
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── schemas/
│       ├── src/
│       │   ├── finding.schema.ts
│       │   ├── evidence.schema.ts
│       │   ├── job.schema.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
```

---

## 3. NestJS 11 Core API Architecture (`apps/api`)

### 3.1 Dependencies & `package.json`
`apps/api/package.json` pins production-ready NestJS 11 packages and BullMQ:

```json
{
  "name": "@erppreflight/api",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main.js",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage"
  },
  "dependencies": {
    "@erppreflight/database": "workspace:*",
    "@erppreflight/tenancy": "workspace:*",
    "@erppreflight/schemas": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/config": "^3.2.0",
    "@nestjs/swagger": "^11.0.0",
    "@nestjs/bullmq": "^10.2.0",
    "@nestjs/jwt": "^10.2.0",
    "@nestjs/passport": "^10.0.3",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "bcrypt": "^5.1.1",
    "bullmq": "^5.12.0",
    "ioredis": "^5.4.1",
    "pg": "^8.12.0",
    "class-validator": "^0.14.1",
    "class-transformer": "^0.5.1",
    "zod": "^3.23.8",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/bcrypt": "^5.0.2",
    "@types/express": "^5.0.0",
    "@types/node": "^20.14.0",
    "@types/passport-jwt": "^4.0.1",
    "@types/pg": "^8.11.6",
    "@types/uuid": "^10.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "unplugin-swc": "^1.5.1"
  }
}
```

### 3.2 Bootstrap & Entry Point (`apps/api/src/main.ts`)
Configures global prefix `/api/v1` (excluding `/health`), OpenAPI Swagger docs at `/api/v1/docs`, CORS, and standard error handling:

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Graceful shutdown hooks
  app.enableShutdownHooks();

  // Correlation Support ID Interceptor
  app.useGlobalInterceptors(new CorrelationIdInterceptor());

  // Global Exception Filter with Support ID
  app.useGlobalFilters(new HttpExceptionFilter());

  // Strict Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS configuration
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
    : ['http://localhost:3000', 'https://erppreflight.com'];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'Idempotency-Key', 'X-Correlation-Id'],
  });

  // Global API prefix (excluding /health endpoints for standard liveness/readiness probes)
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/liveness', 'health/readiness'],
  });

  // OpenAPI Swagger Specification
  const config = new DocumentBuilder()
    .setTitle('ERP Preflight Core API')
    .setDescription('Enterprise multi-tenant preflight analysis and clean core auditing API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Tenant-Id', in: 'header' }, 'tenant-id')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document);

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  logger.log(`ERP Preflight API listening on port ${port}`);
  logger.log(`Swagger documentation available at http://0.0.0.0:${port}/api/v1/docs`);
}
bootstrap();
```

### 3.3 Root Application Module (`apps/api/src/app.module.ts`)
```typescript
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './modules/database/database.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { TenancyMiddleware } from './modules/tenancy/tenancy.middleware';
import { AuthModule } from './modules/auth/auth.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    TenancyModule,
    AuthModule,
    WorkspacesModule,
    ProjectsModule,
    JobsModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Mount tenancy context resolution on all API routes except health checks
    consumer
      .apply(TenancyMiddleware)
      .exclude('health/(.*)', 'health')
      .forRoutes('*');
  }
}
```

### 3.4 Typed Environment Validation (`apps/api/src/config/env.validation.ts`)
```typescript
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url().default('postgres://erppreflight:erppreflight_secret@localhost:5432/erppreflight_dev'),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  JWT_SECRET: z.string().min(32).default('secret-key-must-be-at-least-32-chars-long-abcdef'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ANALYSIS_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  CORS_ORIGIN: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    console.error('Invalid environment variables:', parsed.error.format());
    throw new Error('Environment configuration validation failed');
  }
  return parsed.data;
}
```

---

## 4. Multi-Tenant Isolation Architecture

Multi-tenancy is enforced using a two-tier defense model:
1. **Application Context Tier**: Node.js `AsyncLocalStorage` stores the current tenant context (`tenantId`, `userId`, `roles`) for the entire duration of the request.
2. **Database Row Level Security (RLS) Tier**: Every query executes within a database connection where PostgreSQL session variable `app.current_tenant_id` is set to the authenticated tenant.

### 4.1 Tenancy Context (`packages/tenancy/src/context.ts`)
```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContextStore {
  tenantId: string;
  userId?: string;
  roles?: string[];
}

export const tenantLocalStorage = new AsyncLocalStorage<TenantContextStore>();

export class TenancyContext {
  static run<T>(store: TenantContextStore, callback: () => T | Promise<T>): T | Promise<T> {
    return tenantLocalStorage.run(store, callback);
  }

  static get(): TenantContextStore | undefined {
    return tenantLocalStorage.getStore();
  }

  static getTenantId(): string {
    const store = this.get();
    if (!store?.tenantId) {
      throw new Error('Tenant context is missing or uninitialized for this operation');
    }
    return store.tenantId;
  }
}
```

### 4.2 Tenancy Middleware (`apps/api/src/modules/tenancy/tenancy.middleware.ts`)
Resolves tenant context from JWT authorization tokens, `X-Tenant-Id` headers, or route params:

```typescript
import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenancyContext } from '@erppreflight/tenancy';
import { validate as isValidUuid } from 'uuid';

@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // 1. Check x-tenant-id header
    const headerTenantId = req.headers['x-tenant-id'] as string;
    
    // 2. Check authenticated user context (if pre-decoded by auth guard)
    const userTenantId = (req as any).user?.organizationId;
    
    // 3. Fallback to route parameters (e.g. /workspaces/:workspaceId/...)
    const routeTenantId = req.params?.tenantId || req.params?.workspaceId;

    const tenantId = headerTenantId || userTenantId || routeTenantId;

    if (tenantId) {
      if (!isValidUuid(tenantId)) {
        throw new BadRequestException('Invalid Tenant ID format. Must be a valid UUID');
      }
      TenancyContext.run({ tenantId, userId: (req as any).user?.id }, () => next());
    } else {
      // Continue without tenant context (for public routes e.g. /auth/login)
      next();
    }
  }
}
```

### 4.3 Tenancy Guard (`apps/api/src/modules/tenancy/tenancy.guard.ts`)
Enforces tenant requirement on protected business endpoints:

```typescript
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TenancyContext } from '@erppreflight/tenancy';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const store = TenancyContext.get();

    if (!store?.tenantId) {
      throw new ForbiddenException('Tenant context (X-Tenant-Id) is required for this operation');
    }

    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Super Admin bypass
    if (user.systemRole === 'SUPER_ADMIN') {
      return true;
    }

    // Verify user belongs to the target organization
    const membership = await this.db.query(
      'SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2',
      [store.tenantId, user.id],
      { bypassRls: true }
    );

    if (membership.rows.length === 0) {
      throw new ForbiddenException('Access denied: You are not a member of this tenant');
    }

    request.tenantRole = membership.rows[0].role;
    return true;
  }
}
```

### 4.4 Database RLS Transaction Wrapper (`apps/api/src/modules/database/database.service.ts`)
Ensures every query executes within `set_config('app.current_tenant_id', tenantId, true)`:

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { TenancyContext } from '@erppreflight/tenancy';

export interface QueryOptions {
  bypassRls?: boolean;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

  async onModuleInit() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    this.logger.log('Database connection pool initialized');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  /**
   * Executes a query with RLS tenant context automatically injected.
   */
  async query<T extends QueryResultRow = any>(
    sql: string,
    params: any[] = [],
    options: QueryOptions = {},
  ): Promise<QueryResult<T>> {
    const client = await this.pool.connect();
    try {
      if (!options.bypassRls) {
        const tenantId = TenancyContext.get()?.tenantId;
        if (tenantId) {
          // is_local = true ensures setting reverts when transaction commits/rolls back
          await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
        }
      }
      return await client.query<T>(sql, params);
    } finally {
      client.release();
    }
  }

  /**
   * Scoped transaction executor with strict RLS session context.
   */
  async withTenantTransaction<T>(
    tenantId: string,
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  getPool(): Pool {
    return this.pool;
  }
}
```

---

## 5. PostgreSQL Schema, pgvector & RLS Policies

PostgreSQL 16 serves as the immutable system of record. Migrations are executed forward-only and idempotently.

### 5.1 Initial Schema Migration (`0001_initial_schema.sql`)
```sql
-- Migration: 0001_initial_schema.sql
-- Description: Canonical tables for ERP Preflight SaaS platform

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Organizations (Tenants)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    plan_tier VARCHAR(50) NOT NULL DEFAULT 'FREE',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    data_policy JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users (Global authentication)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    system_role VARCHAR(50) NOT NULL DEFAULT 'USER',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Organization Members (Tenant Membership & RBAC)
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'MEMBER',
    permissions JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- 4. Projects (Workspace container for analysis)
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    description TEXT,
    target_release VARCHAR(50) NOT NULL DEFAULT 'S4H_2023',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(organization_id, slug)
);

-- 5. Uploaded Files (Artifact staging & metadata)
CREATE TABLE IF NOT EXISTS uploaded_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_name VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(255) NOT NULL,
    storage_path VARCHAR(1000) NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    quarantine_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_SCAN',
    redaction_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    metadata JSONB NOT NULL DEFAULT '{}',
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Analyses (Job runs orchestrating preflight engines)
CREATE TABLE IF NOT EXISTS analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'QUEUED',
    engine_types JSONB NOT NULL DEFAULT '[]',
    target_release VARCHAR(50) NOT NULL,
    triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 7. Findings (Preflight discoveries & violations)
CREATE TABLE IF NOT EXISTS findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    engine VARCHAR(100) NOT NULL,
    rule_id VARCHAR(100) NOT NULL,
    severity VARCHAR(50) NOT NULL,
    category VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    confidence_class VARCHAR(50) NOT NULL,
    confidence_score NUMERIC(4,3) NOT NULL DEFAULT 1.000,
    remediation TEXT,
    affected_objects JSONB NOT NULL DEFAULT '[]',
    technical_details JSONB NOT NULL DEFAULT '{}',
    fingerprint VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Tests (Generated preflight unit & integration test cases)
CREATE TABLE IF NOT EXISTS tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    title VARCHAR(500) NOT NULL,
    test_type VARCHAR(100) NOT NULL DEFAULT 'REGRESSION',
    steps JSONB NOT NULL DEFAULT '[]',
    expected_result TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Audit Events (Tamper-evident append-only hash chain)
CREATE TABLE IF NOT EXISTS audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(100) NOT NULL,
    target_id UUID,
    payload JSONB NOT NULL DEFAULT '{}',
    prev_hash VARCHAR(64),
    current_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Foreign Key & Filter Indexes
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_proj ON uploaded_files(project_id);
CREATE INDEX IF NOT EXISTS idx_analyses_proj ON analyses(project_id);
CREATE INDEX IF NOT EXISTS idx_findings_analysis ON findings(analysis_id);
CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);
CREATE INDEX IF NOT EXISTS idx_audit_events_org ON audit_events(organization_id);
```

### 5.2 pgvector Extension & Evidence Schema (`0002_pgvector_hnsw.sql`)
```sql
-- Migration: 0002_pgvector_hnsw.sql
-- Description: pgvector extension, evidence table and HNSW index

CREATE EXTENSION IF NOT EXISTS vector;

-- Evidence Items with 1536-dimensional embeddings for semantic search
CREATE TABLE IF NOT EXISTS evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    finding_id UUID REFERENCES findings(id) ON DELETE CASCADE,
    artifact_path VARCHAR(1000) NOT NULL,
    line_number INTEGER,
    snippet TEXT,
    sha256 VARCHAR(64) NOT NULL,
    provenance VARCHAR(50) NOT NULL,
    source_title VARCHAR(255),
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_org ON evidence(organization_id);
CREATE INDEX IF NOT EXISTS idx_evidence_finding ON evidence(finding_id);
CREATE INDEX IF NOT EXISTS idx_evidence_sha256 ON evidence(sha256);

-- HNSW Vector Index for sub-millisecond cosine similarity search
CREATE INDEX IF NOT EXISTS idx_evidence_embedding_hnsw 
ON evidence 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

### 5.3 Row Level Security Policies (`0003_rls_policies.sql`)
```sql
-- Migration: 0003_rls_policies.sql
-- Description: Multi-tenant Row Level Security (RLS) enforcement

-- Helper function to extract current tenant session UUID
CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::UUID;
EXCEPTION
    WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Enable RLS and Force RLS on all tenant-owned tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_projects ON projects
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_uploaded_files ON uploaded_files
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_analyses ON analyses
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_findings ON findings
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

ALTER TABLE evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_evidence ON evidence
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

ALTER TABLE tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tests ON tests
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit_events ON audit_events
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_org_members ON organization_members
    FOR ALL
    USING (organization_id = get_current_tenant_id())
    WITH CHECK (organization_id = get_current_tenant_id());
```

### 5.4 Idempotent Database Migration Runner (`packages/database/src/migrate.ts`)
```typescript
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export async function runMigrations(databaseUrl?: string) {
  const connectionString = databaseUrl || process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  console.log('==> [Migrations] Starting database migration check...');

  try {
    // Acquire session advisory lock to ensure only one runner executes migrations
    await client.query('SELECT pg_advisory_lock(987654321)');

    // Ensure _migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.resolve(__dirname, '../migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      const res = await client.query('SELECT name FROM _migrations WHERE name = $1', [file]);
      if (res.rows.length === 0) {
        console.log(`==> [Migrations] Applying migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`==> [Migrations] Successfully applied: ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`==> [Migrations] Failed applying ${file}:`, err);
          throw err;
        }
      } else {
        console.log(`==> [Migrations] Already applied: ${file}`);
      }
    }

    console.log('==> [Migrations] All migrations verified successfully.');
  } finally {
    await client.query('SELECT pg_advisory_unlock(987654321)');
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('Fatal migration error:', err);
    process.exit(1);
  });
}
```

### 5.5 Container Startup Runner Script (`apps/api/entrypoint.sh`)
```bash
#!/bin/sh
set -e

echo "==> [ERP Preflight] Verifying PostgreSQL availability..."
DB_HOST=${POSTGRES_HOST:-localhost}
DB_PORT=${POSTGRES_PORT:-5432}
DB_USER=${POSTGRES_USER:-erppreflight}

MAX_RETRIES=30
RETRY_COUNT=0

until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" || [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
  echo "==> [ERP Preflight] PostgreSQL not ready yet. Retrying in 2 seconds... ($((RETRY_COUNT+1))/$MAX_RETRIES)"
  RETRY_COUNT=$((RETRY_COUNT+1))
  sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "==> [ERP Preflight] ERROR: Could not connect to PostgreSQL within $((MAX_RETRIES*2)) seconds. Exiting."
  exit 1
fi

echo "==> [ERP Preflight] PostgreSQL is ready. Executing database migrations..."
node -e "require('@erppreflight/database').runMigrations()"

echo "==> [ERP Preflight] Starting NestJS API server..."
exec node dist/main.js
```

---

## 6. BullMQ & Redis Queuing Architecture

### 6.1 Redis Connection Factory with Host Port Fallback (6380 vs 6379)
In developer and host environments, Redis often collides on port 6379 (e.g. host Redis already running). The connection factory probes `process.env.REDIS_URL` or `REDIS_PORT`, testing port 6379 and falling back automatically to port 6380 when ECONNREFUSED is detected:

```typescript
// apps/api/src/modules/jobs/redis-connection.factory.ts
import Redis, { RedisOptions } from 'ioredis';
import * as net from 'net';
import { Logger } from '@nestjs/common';

const logger = new Logger('RedisConnectionFactory');

async function isPortOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

export async function resolveRedisOptions(): Promise<RedisOptions> {
  if (process.env.REDIS_URL) {
    logger.log(`Using configured REDIS_URL`);
    return {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
    };
  }

  const host = process.env.REDIS_HOST || '127.0.0.1';
  let port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD || undefined;

  // Dual-port probing if defaulting to 6379
  if (port === 6379) {
    const is6379Open = await isPortOpen(host, 6379);
    if (!is6379Open) {
      const is6380Open = await isPortOpen(host, 6380);
      if (is6380Open) {
        logger.warn(`Port 6379 unavailable, detected active Redis on fallback port 6380. Switching to 6380.`);
        port = 6380;
      }
    }
  }

  logger.log(`Connecting to Redis at ${host}:${port}`);
  return {
    host,
    port,
    password,
    maxRetriesPerRequest: null, // Required by BullMQ
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  };
}

export async function createRedisClient(): Promise<Redis> {
  const options = await resolveRedisOptions();
  if (process.env.REDIS_URL) {
    return new Redis(process.env.REDIS_URL, options);
  }
  return new Redis(options);
}
```

### 6.2 Queue Definitions & Jobs Module (`apps/api/src/modules/jobs/queue.constants.ts`)
```typescript
export const QUEUE_NAMES = {
  INGESTION: 'ingestion-queue',
  ANALYSIS: 'analysis-queue',
  EXPORT: 'export-queue',
} as const;

export interface IngestionJobPayload {
  fileId: string;
  organizationId: string;
  projectId: string;
  storagePath: string;
  mimeType: string;
  checksumSha256: string;
}

export interface AnalysisJobPayload {
  analysisId: string;
  organizationId: string;
  projectId: string;
  engineTypes: string[];
  targetRelease: string;
  artifactFileIds: string[];
  options?: Record<string, any>;
}

export interface ExportJobPayload {
  exportId: string;
  organizationId: string;
  projectId: string;
  analysisId: string;
  format: 'PDF' | 'JSON' | 'CSV' | 'XLSX';
  templateOptions?: Record<string, any>;
}
```

### 6.3 BullMQ Module Integration (`apps/api/src/modules/jobs/jobs.module.ts`)
```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { resolveRedisOptions } from './redis-connection.factory';
import { QUEUE_NAMES } from './queue.constants';
import { JobsProducerService } from './jobs-producer.service';
import { AnalysisQueueProcessor } from './analysis-queue.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: async () => ({
        connection: await resolveRedisOptions(),
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.INGESTION },
      { name: QUEUE_NAMES.ANALYSIS },
      { name: QUEUE_NAMES.EXPORT },
    ),
  ],
  providers: [JobsProducerService, AnalysisQueueProcessor],
  exports: [JobsProducerService],
})
export class JobsModule {}
```

### 6.4 Job Producer Service (`apps/api/src/modules/jobs/jobs-producer.service.ts`)
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, AnalysisJobPayload, IngestionJobPayload, ExportJobPayload } from './queue.constants';

@Injectable()
export class JobsProducerService {
  private readonly logger = new Logger(JobsProducerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ANALYSIS) private readonly analysisQueue: Queue<AnalysisJobPayload>,
    @InjectQueue(QUEUE_NAMES.INGESTION) private readonly ingestionQueue: Queue<IngestionJobPayload>,
    @InjectQueue(QUEUE_NAMES.EXPORT) private readonly exportQueue: Queue<ExportJobPayload>,
  ) {}

  async enqueueAnalysisJob(payload: AnalysisJobPayload) {
    this.logger.log(`Enqueueing analysis job for analysis ${payload.analysisId} (Org: ${payload.organizationId})`);
    return await this.analysisQueue.add('run-analysis', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  async enqueueIngestionJob(payload: IngestionJobPayload) {
    return await this.ingestionQueue.add('process-file', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }

  async enqueueExportJob(payload: ExportJobPayload) {
    return await this.exportQueue.add('generate-export', payload, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 3000 },
    });
  }
}
```

### 6.5 Analysis Queue Worker Processor (`apps/api/src/modules/jobs/analysis-queue.processor.ts`)
Delegates analysis to the Python FastAPI microservice, receives deterministic findings, and persists results transactionally inside the tenant RLS context:

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_NAMES, AnalysisJobPayload } from './queue.constants';
import { DatabaseService } from '../database/database.service';

@Processor(QUEUE_NAMES.ANALYSIS, { concurrency: 4 })
export class AnalysisQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisQueueProcessor.name);

  constructor(private readonly db: DatabaseService) {
    super();
  }

  async process(job: Job<AnalysisJobPayload>): Promise<any> {
    const { analysisId, organizationId, projectId, engineTypes, targetRelease } = job.data;
    this.logger.log(`Processing analysis ${analysisId} for org ${organizationId}`);

    // Update status to RUNNING
    await this.db.withTenantTransaction(organizationId, async (client) => {
      await client.query("UPDATE analyses SET status = 'RUNNING' WHERE id = $1", [analysisId]);
    });

    const analysisServiceUrl = process.env.ANALYSIS_SERVICE_URL || 'http://localhost:8000';

    try {
      // 1. Invoke Python FastAPI microservice
      const response = await fetch(`${analysisServiceUrl}/api/v1/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: analysisId,
          tenant_id: organizationId,
          project_id: projectId,
          engine_types: engineTypes,
          target_release: targetRelease,
        }),
      });

      if (!response.ok) {
        throw new Error(`Analysis engine returned HTTP ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();

      // 2. Transactionally persist findings & evidence within tenant RLS boundary
      await this.db.withTenantTransaction(organizationId, async (client) => {
        for (const finding of result.findings || []) {
          const findingRes = await client.query(
            `INSERT INTO findings 
             (organization_id, project_id, analysis_id, engine, rule_id, severity, category, title, description, confidence_class, confidence_score, remediation, fingerprint)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING id`,
            [
              organizationId,
              projectId,
              analysisId,
              finding.engine || 'UNKNOWN',
              finding.rule_id,
              finding.severity,
              finding.category,
              finding.title,
              finding.description,
              finding.confidence || 'VERIFIED',
              finding.confidence_score || 1.0,
              finding.remediation || null,
              finding.fingerprint || finding.id,
            ],
          );

          const findingId = findingRes.rows[0].id;

          for (const ev of finding.evidence || []) {
            await client.query(
              `INSERT INTO evidence 
               (organization_id, finding_id, artifact_path, line_number, snippet, sha256, provenance, source_title)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                organizationId,
                findingId,
                ev.artifact_path || 'unknown',
                ev.line_number || null,
                ev.snippet || null,
                ev.sha256,
                ev.provenance || 'VERIFIED',
                ev.source_title || null,
              ],
            );
          }
        }

        // Mark analysis COMPLETED
        await client.query(
          "UPDATE analyses SET status = 'COMPLETED', completed_at = NOW() WHERE id = $1",
          [analysisId],
        );
      });

      this.logger.log(`Analysis ${analysisId} completed successfully`);
      return { success: true, analysisId };
    } catch (err: any) {
      this.logger.error(`Analysis ${analysisId} failed: ${err.message}`);
      await this.db.withTenantTransaction(organizationId, async (client) => {
        await client.query(
          "UPDATE analyses SET status = 'FAILED', completed_at = NOW() WHERE id = $1",
          [analysisId],
        );
      });
      throw err;
    }
  }
}
```

---

## 7. Health Check Endpoints

Standardized health check probes are provided in `HealthModule`:
- `/health/liveness`: Process responsive probe (Coolify/Docker daemon). Returns HTTP 200 OK immediately without querying dependencies.
- `/health/readiness`: Verifies connection to PostgreSQL, Redis, and Python Analysis Engine. Returns HTTP 200 OK if healthy, HTTP 503 if any required service is down.

### 7.1 Health Controller (`apps/api/src/modules/health/health.controller.ts`)
```typescript
import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { HealthService } from './health.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('liveness')
  @ApiOperation({ summary: 'Liveness probe returning HTTP 200 if API process is responsive' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  getLiveness() {
    return this.healthService.checkLiveness();
  }

  @Get('readiness')
  @ApiOperation({ summary: 'Readiness probe verifying database, redis, and analysis connections' })
  @ApiResponse({ status: 200, description: 'Service is ready to handle traffic' })
  @ApiResponse({ status: 503, description: 'One or more downstream services are unavailable' })
  async getReadiness(@Res() res: Response) {
    const readiness = await this.healthService.checkReadiness();
    const statusCode = readiness.status === 'ready' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
    return res.status(statusCode).json(readiness);
  }
}
```

### 7.2 Health Service (`apps/api/src/modules/health/health.service.ts`)
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { createRedisClient } from '../jobs/redis-connection.factory';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly db: DatabaseService) {}

  checkLiveness() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  async checkReadiness() {
    const services: Record<string, { status: 'up' | 'down'; latencyMs?: number; error?: string }> = {};

    // 1. PostgreSQL Check
    const dbStart = Date.now();
    try {
      await this.db.query('SELECT 1', [], { bypassRls: true });
      services.database = { status: 'up', latencyMs: Date.now() - dbStart };
    } catch (err: any) {
      services.database = { status: 'down', error: err.message };
    }

    // 2. Redis Check
    const redisStart = Date.now();
    try {
      const redis = await createRedisClient();
      await redis.ping();
      await redis.quit();
      services.redis = { status: 'up', latencyMs: Date.now() - redisStart };
    } catch (err: any) {
      services.redis = { status: 'down', error: err.message };
    }

    // 3. Python Analysis Engine Check
    const analysisStart = Date.now();
    const analysisUrl = process.env.ANALYSIS_SERVICE_URL || 'http://localhost:8000';
    try {
      const response = await fetch(`${analysisUrl}/health/liveness`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) {
        services.analysisEngine = { status: 'up', latencyMs: Date.now() - analysisStart };
      } else {
        services.analysisEngine = { status: 'down', error: `HTTP ${response.status}` };
      }
    } catch (err: any) {
      // Degraded warning; analysis engine may boot slightly after API
      services.analysisEngine = { status: 'down', error: err.message };
    }

    const isReady = services.database.status === 'up' && services.redis.status === 'up';

    return {
      status: isReady ? 'ready' : 'degraded',
      services,
      timestamp: new Date().toISOString(),
    };
  }
}
```

---

## 8. Core Modules: Auth, Workspaces & Projects

### 8.1 Auth Module (`apps/api/src/modules/auth/`)
- `POST /api/v1/auth/register`: Creates user, organization, and organization_member (role: OWNER).
- `POST /api/v1/auth/login`: Validates bcrypt hash, issues signed JWT containing `{ sub: userId, email, organizationId, systemRole }`.
- `GET /api/v1/auth/me`: Returns authenticated profile and organizations.

### 8.2 Workspaces Module (`apps/api/src/modules/workspaces/`)
- `GET /api/v1/workspaces`: Lists user's accessible organizations.
- `POST /api/v1/workspaces`: Creates new organization and binds owner.
- `GET /api/v1/workspaces/:id`: Fetches details with tenant authorization.
- `GET /api/v1/workspaces/:id/members`: Lists tenant members.

### 8.3 Projects Module (`apps/api/src/modules/projects/`)
- `GET /api/v1/projects`: Lists projects for current tenant (RLS filtered).
- `POST /api/v1/projects`: Creates new project workspace with `target_release` (e.g. `S4H_2023`).
- `GET /api/v1/projects/:id`: Retrieves project details.
- `POST /api/v1/projects/:id/analyses`: Triggers new asynchronous analysis run; enqueues `AnalysisJobPayload` to BullMQ `analysis-queue`.
- `GET /api/v1/projects/:id/findings`: Returns preflight findings filtered by severity, category, or engine.

---

## 9. Testing Strategy & Verification Harness

The test suite uses Vitest (or Jest with `@swc/jest`) to ensure blazingly fast execution without requiring external databases or Redis instances running during unit test execution.

### 9.1 Vitest Configuration (`apps/api/vitest.config.ts`)
```typescript
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
```

### 9.2 Unit Tests to Guarantee `pnpm test` Success
1. **Health Controller Unit Test (`src/modules/health/health.controller.spec.ts`)**:
   Verifies `/health/liveness` returns 200 OK with `status: "ok"`, and `/health/readiness` returns 200 OK when services are up and 503 when degraded.
2. **Tenancy Middleware & Guard Unit Test (`src/modules/tenancy/tenancy.middleware.spec.ts`)**:
   Verifies UUID validation on `X-Tenant-Id`, rejection of malformed UUIDs, and successful initialization of `TenancyContext`.
3. **Auth Service Unit Test (`src/modules/auth/auth.service.spec.ts`)**:
   Mocks `DatabaseService` and `JwtService`, verifying password hashing, login token issuance, and password mismatch rejection.
4. **Projects Service Unit Test (`src/modules/projects/projects.service.spec.ts`)**:
   Verifies project workspace creation, target release assignment, and dispatch of analysis jobs to `JobsProducerService`.
5. **Jobs Producer Unit Test (`src/modules/jobs/jobs-producer.service.spec.ts`)**:
   Mocks BullMQ queues, verifying job payload validation and queue dispatch parameters.

---

## 10. Step-by-Step Implementation Sequence

Milestone 1 implementers should follow this exact sequence:

1. **Step 1: Database Package & Migrations (`packages/database`)**:
   - Create `packages/database/package.json` and `tsconfig.json`.
   - Implement `migrations/0001_initial_schema.sql` (canonical tables: organizations, users, projects, uploaded_files, findings, tests, audit_events).
   - Implement `migrations/0002_pgvector_hnsw.sql` (vector extension, evidence table, HNSW index).
   - Implement `migrations/0003_rls_policies.sql` (RLS policies with `get_current_tenant_id()`).
   - Implement `src/migrate.ts` migration runner with advisory locks.
2. **Step 2: Tenancy Context Package (`packages/tenancy`)**:
   - Implement `AsyncLocalStorage` context store in `packages/tenancy/src/context.ts`.
3. **Step 3: NestJS Core API Scaffolding (`apps/api`)**:
   - Create `package.json`, `tsconfig.json`, `nest-cli.json`, `vitest.config.ts`.
   - Scaffold `src/main.ts` with prefix `api/v1`, Swagger docs, correlation interceptor, and exception filters.
   - Implement `src/config/env.validation.ts` with Zod schema.
4. **Step 4: Database & Tenancy Modules in API**:
   - Implement `DatabaseModule` and `DatabaseService` with `query()` and `withTenantTransaction()`.
   - Implement `TenancyModule`, `TenancyMiddleware`, and `TenancyGuard`.
5. **Step 5: Redis Factory & Jobs Module**:
   - Implement `redis-connection.factory.ts` with 6380 fallback probe.
   - Implement `JobsModule`, `JobsProducerService`, and `AnalysisQueueProcessor`.
6. **Step 6: Auth, Workspaces & Projects Modules**:
   - Implement `AuthModule` (register, login, me, JWT strategy).
   - Implement `WorkspacesModule` (organization management).
   - Implement `ProjectsModule` (project workspace CRUD, analysis dispatch).
7. **Step 7: Health Module & Entrypoint Script**:
   - Implement `HealthModule` with `/health/liveness` and `/health/readiness`.
   - Create `entrypoint.sh` for container startup and automated migration execution.
8. **Step 8: Unit Tests & Verification**:
   - Add spec files for Health, Tenancy, Auth, and Projects.
   - Run `pnpm test` and verify all tests pass with exit code 0.
