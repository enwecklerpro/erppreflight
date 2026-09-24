# Milestone 2 — Orval OpenAPI Client & TanStack Query Codegen Blueprint

## 1. Observation

### 1.1 Backend OpenAPI & NestJS Architecture
- **Global Prefix & Swagger Path**: In `apps/api/src/main.ts` (lines 42–60), the NestJS API applies global prefix `'api/v1'`, excluding health endpoints:
  ```typescript
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/liveness', 'health/readiness'],
  });
  const config = new DocumentBuilder()
    .setTitle('ERP Preflight Core API')
    .setDescription('Enterprise multi-tenant preflight analysis and clean core auditing API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Tenant-Id', in: 'header' }, 'tenant-id')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/v1/docs', app, document);
  ```
- **Allowed Headers & Security**: `apps/api/src/main.ts` (lines 33–40) configures CORS to explicitly allow:
  `['Content-Type', 'Authorization', 'X-Tenant-Id', 'Idempotency-Key', 'X-Correlation-Id']`.
- **Tenancy Enforcement**: In `apps/api/src/modules/tenancy/tenancy.guard.ts` (lines 19–23) and `tenancy.middleware.ts` (lines 9–13), requests to tenant-scoped controllers strictly require `X-Tenant-Id` as a valid UUID, otherwise returning HTTP 403:
  ```typescript
  if (!store?.tenantId) {
    throw new ForbiddenException('Tenant context (X-Tenant-Id) is required for this operation');
  }
  ```
- **Error Response Structure**: In `apps/api/src/common/filters/http-exception.filter.ts` (lines 38–46), errors are returned as:
  ```typescript
  {
    statusCode: status,
    timestamp: new Date().toISOString(),
    path: request.url,
    method: request.method,
    correlationId,
    message,
  }
  ```
- **Missing CLI Plugin in NestJS**: In `apps/api/nest-cli.json` (lines 5–7), compiler options currently do not include `"plugins": ["@nestjs/swagger"]`. In `apps/api/src/modules/projects/dto/project.dto.ts` (lines 3–15), DTO properties are decorated only with `class-validator` decorators (`@IsString`, `@IsNotEmpty`) without `@ApiProperty()`. Consequently, the raw Swagger document generates empty DTO schemas (`"CreateProjectDto": { "type": "object" }`), resulting in `{ [key: string]: unknown }` in generated TypeScript interfaces.

### 1.2 Frontend API & TanStack Suite State
- **Violation of Cardinal Axiom 1**: In `apps/web/src/lib/api-client.ts` (lines 42–170), hardcoded mock data (`MOCK_PROJECTS`, `MOCK_FINDINGS`, `ALL_18_ENGINES`) and fallback catch-blocks are currently in use. `AGENTS.md` Axiom 1 mandates real data via TanStack Query and Orval.
- **Dependencies**: In `apps/web/package.json` (lines 13–30), `@tanstack/react-query` is not yet installed. Orval is not yet registered in `devDependencies`.

### 1.3 Predecessor Investigation (`explorer_m2_orval_1`) Analysis & Flaw Discovery
- Predecessor successfully verified Orval v8.37.0 execution using `openapi-sample.json` extracted from `AppModule`.
- **Critical Flaw Discovered in Predecessor Configuration**:
  In `H:/erppreflight/.agents/explorer_m2_orval_1/orval.verify.config.ts` (lines 18–23):
  ```typescript
  query: {
    version: 5,
    useQuery: true,     // <-- CRITICAL DEFECT
    useMutation: true,
    signal: true,
  }
  ```
  When `useQuery: true` is explicitly passed in Orval's `override.query`, Orval forces **ALL** operations (including HTTP `POST`, `PUT`, `DELETE`, `PATCH`) to generate `useQuery` hooks instead of `useMutation` hooks!
  - Direct evidence: In `explorer_m2_orval_1/test-verify/endpoints/projects/projects.ts` (line 132), `POST /api/v1/projects` generated `useProjectsControllerCreate` as `useQuery(...)`, which would automatically execute upon component render without a `mutate` trigger!
  - Verification: When removing `useQuery: true` and keeping `query: { version: 5, signal: true }`, Orval correctly generates `useQuery` for `GET` operations and `useMutation` for `POST`, `PUT`, `DELETE` operations (verified in `H:/erppreflight/.agents/explorer_m2_orval_2/test-defaults/endpoints/projects/projects.ts` line 137).

---

## 2. Logic Chain

1. **HTTP Method Semantics**:
   - `GET` endpoints are read queries; they must generate TanStack Query `useQuery` hooks with query keys, caching, and background refetching.
   - `POST`, `PUT`, `PATCH`, `DELETE` endpoints are mutations; they must generate TanStack Query `useMutation` hooks with mutation keys and `mutate` / `mutateAsync` functions.
   - Leaving `useQuery` and `useMutation` as Orval defaults (rather than forcing `useQuery: true`) guarantees this separation out-of-the-box.

2. **TanStack Query v5 Compatibility**:
   - Orval requires `override.query.version: 5`. This instructs Orval to emit `DataTag<QueryKey, TData, TError>`, matching TanStack Query v5's type inference.
   - Adding `signal: true` forwards `AbortSignal` from TanStack Query to the fetch call, providing automatic request cancellation when components unmount or queries are invalidated.

3. **Domain Modularization (`mode: 'tags-split'`)**:
   - NestJS groups endpoints by controller tags (`auth`, `workspaces`, `projects`, `jobs`, `files`, `audit`, `export`, `health`).
   - Using `mode: 'tags-split'` creates individual domain folders with co-located query hooks, MSW mock handlers (`.msw.ts`), and a clean top-level re-export `index.ts`. This maximizes tree-shaking and enables targeted imports in Next.js App Router components.

4. **Monorepo File Location: `apps/web/orval.config.ts` vs Root**:
   - **Preferred Location**: `apps/web/orval.config.ts`.
     - `apps/web` is the direct consumer of the generated client and TanStack Query hooks.
     - Keeps frontend-specific dependencies (`orval`, `@tanstack/react-query`, `msw`) cleanly isolated within `@erppreflight/web`.
     - Relative import path resolution: Outputting to `./src/lib/api/generated/endpoints` and referencing mutator `./src/lib/api/custom-instance.ts` produces clean, robust relative imports (`import { customInstance } from '../../../custom-instance'`).
   - **Root Orchestration**: A root script in `package.json` (`"codegen:api": "pnpm --filter @erppreflight/web codegen:api"`) provides monorepo-level convenience without polluting the monorepo root.

5. **Multi-Tenant & SSR-Safe Fetch Mutator (`customInstance`)**:
   - **Base URL & Prefix Normalization**: `apps/api` paths in Swagger already include `/api/v1` for prefixed routes. If `NEXT_PUBLIC_API_URL` is set to `http://localhost:4000/api/v1`, naive concatenation produces duplicate `/api/v1/api/v1`. The mutator must defensively strip trailing `/api/v1` from the base URL.
   - **Header Propagation**:
     - `X-Tenant-Id`: Required by NestJS `TenancyGuard`. In the browser, read from `localStorage.getItem('erppreflight_tenant_id')` or request options.
     - `Authorization`: `Bearer <token>`. In the browser, read from `localStorage.getItem('erppreflight_token')` or request options.
     - `Content-Type`: Automatically set to `application/json` when a JSON body is present.
   - **SSR Safety**: Guards `window` and `localStorage` with `typeof window !== 'undefined'`. On the server during Next.js SSR, it does not throw reference errors and expects auth/tenant context to be supplied via `options.headers` (e.g. from cookies).
   - **Error Handling**: Non-2xx responses parse the NestJS JSON error body and throw an `ApiError` instance containing `statusCode`, `correlationId`, `message`, and `details`.
   - **Empty Response Handling**: 204 No Content and empty 200/201 bodies return `undefined` rather than failing on `JSON.parse()`.

6. **Static vs Live Codegen**:
   - Fetching from a live URL (`http://localhost:4000/api/v1/docs-json`) requires the backend server to be running.
   - In CI/CD and pre-commit hooks, the backend is not running. A static `openapi.json` file in `apps/api/openapi.json` (exported headless via NestJS `SwaggerModule.createDocument` or checked into git) enables deterministic, offline codegen.
   - `input.target` should support `process.env.OPENAPI_SPEC_URL || '../../apps/api/openapi.json'` to handle both live dev server and offline scenarios seamlessly.

---

## 3. Caveats

1. **Pre-requisite Package Installation**:
   - `apps/web` must install `@tanstack/react-query` as a dependency and `orval`, `msw` as `devDependencies`.
2. **DTO Schema Richness in NestJS**:
   - Without adding `"plugins": ["@nestjs/swagger"]` to `apps/api/nest-cli.json`, Orval will generate `{ [key: string]: unknown }` for DTOs. Adding this compiler plugin is strongly recommended to achieve full type fidelity.
3. **Server Component Context**:
   - Next.js Server Components running SSR cannot access `window.localStorage`. For SSR data prefetching, server-side callers must forward the tenant ID and auth cookie/token via `options.headers` or use server-side fetch wrappers.

---

## 4. Conclusion & Drop-In Code

### 4.1 Specification: `apps/web/orval.config.ts` (Recommended)

Place this file at `apps/web/orval.config.ts`:

```typescript
import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: {
      target:
        process.env.OPENAPI_SPEC_URL ||
        '../../apps/api/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: './src/lib/api/generated/endpoints',
      schemas: './src/lib/api/generated/models',
      client: 'react-query',
      mock: true,
      clean: true,
      override: {
        mutator: {
          path: './src/lib/api/custom-instance.ts',
          name: 'customInstance',
        },
        query: {
          version: 5,
          signal: true,
        },
      },
    },
  },
});
```

*(Alternative Monorepo Root `orval.config.ts` specification is provided in Section 4.5).*

---

### 4.2 Production Custom Fetch Mutator: `apps/web/src/lib/api/custom-instance.ts`

Place this file at `apps/web/src/lib/api/custom-instance.ts`:

```typescript
/**
 * ERP Preflight — Production Custom Fetch Mutator for Orval & TanStack Query v5
 * Location: apps/web/src/lib/api/custom-instance.ts
 *
 * Implements:
 * - Intelligent base URL normalization (prevents duplicate /api/v1 prefixes)
 * - Multi-tenant isolation: Automatic X-Tenant-Id header injection
 * - Authentication: Automatic Bearer JWT injection
 * - Query cancellation: AbortSignal forwarding from TanStack Query
 * - SSR safety: Safe execution in both browser and Next.js App Router SSR
 * - Structured ApiError parsing matching NestJS HttpExceptionFilter
 * - Clean HTTP 204 / empty payload guards
 */

export interface ApiErrorResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
  correlationId?: string;
  timestamp?: string;
  path?: string;
}

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly correlationId?: string;
  public readonly details?: string | string[];
  public readonly timestamp?: string;
  public readonly path?: string;

  constructor(status: number, data: ApiErrorResponse | string) {
    const message =
      typeof data === 'string'
        ? data
        : Array.isArray(data.message)
        ? data.message.join(', ')
        : data.message;
    super(message || `API request failed with HTTP ${status}`);
    this.name = 'ApiError';
    this.statusCode = status;

    if (typeof data !== 'string') {
      this.correlationId = data.correlationId;
      this.details = data.message;
      this.timestamp = data.timestamp;
      this.path = data.path;
    }
  }
}

export const AUTH_TOKEN_KEY = 'erppreflight_token';
export const TENANT_ID_KEY = 'erppreflight_tenant_id';

/**
 * Browser-side storage helpers for auth and tenant context.
 */
export const getStoredAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
};

export const setStoredAuthToken = (token: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // Ignore storage quota / private browsing exceptions
  }
};

export const getStoredTenantId = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TENANT_ID_KEY);
  } catch {
    return null;
  }
};

export const setStoredTenantId = (tenantId: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (tenantId) {
      localStorage.setItem(TENANT_ID_KEY, tenantId);
    } else {
      localStorage.removeItem(TENANT_ID_KEY);
    }
  } catch {
    // Ignore storage quota / private browsing exceptions
  }
};

/**
 * Builds the canonical request URL from base URL and path.
 * Strips redundant /api/v1 if both base URL and endpoint path include it.
 */
export const resolveApiUrl = (path: string): string => {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const rawBase =
    process.env.NEXT_PUBLIC_API_URL ||
    (typeof window !== 'undefined' ? '' : 'http://localhost:4000');

  let cleanBase = rawBase.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // If base ends with /api/v1 and path starts with /api/v1, strip prefix from base
  if (cleanBase.endsWith('/api/v1') && cleanPath.startsWith('/api/v1')) {
    cleanBase = cleanBase.slice(0, -'/api/v1'.length);
  }

  return `${cleanBase}${cleanPath}`;
};

/**
 * Core custom fetch mutator used by all Orval-generated query and mutation hooks.
 */
export const customInstance = async <T>(
  url: string,
  options?: RequestInit
): Promise<T> => {
  const fullUrl = resolveApiUrl(url);
  const headers = new Headers(options?.headers);

  // Default content-type for mutation payloads sending JSON
  if (
    options?.body &&
    typeof options.body === 'string' &&
    !headers.has('Content-Type')
  ) {
    headers.set('Content-Type', 'application/json');
  }

  // Multi-tenant & Auth headers in browser environment
  if (typeof window !== 'undefined') {
    const token = getStoredAuthToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const tenantId = getStoredTenantId();
    if (tenantId && !headers.has('X-Tenant-Id')) {
      headers.set('X-Tenant-Id', tenantId);
    }
  }

  const response = await fetch(fullUrl, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorData: ApiErrorResponse | string;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text();
    }
    throw new ApiError(response.status, errorData);
  }

  // HTTP 204 No Content
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  // Empty response body guard
  const text = await response.text();
  if (!text || text.trim() === '') {
    return undefined as unknown as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
};

export default customInstance;
```

---

### 4.3 Scripts & Package Configuration

#### 1. In `apps/web/package.json`:
Add to `"scripts"`:
```json
"scripts": {
  "codegen:api": "orval --config orval.config.ts"
}
```
Add to `"dependencies"`:
```json
"@tanstack/react-query": "^5.66.0"
```
Add to `"devDependencies"`:
```json
"orval": "^8.37.0",
"msw": "^2.7.0"
```

#### 2. In `apps/api/package.json`:
Add a script to export the static OpenAPI specification headless without running a server:
```json
"scripts": {
  "openapi:export": "node scripts/export-openapi.js"
}
```
Create `apps/api/scripts/export-openapi.js`:
```javascript
const { NestFactory } = require('@nestjs/core');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
const path = require('path');
const fs = require('fs');

async function exportOpenApi() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'export-secret-key-min-32-chars-long-123';
  
  const { AppModule } = require('../dist/src/app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', 'health/liveness', 'health/readiness'],
  });

  const config = new DocumentBuilder()
    .setTitle('ERP Preflight Core API')
    .setDescription('Enterprise multi-tenant preflight analysis and clean core auditing API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Tenant-Id', in: 'header' }, 'tenant-id')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outPath = path.resolve(__dirname, '../openapi.json');
  fs.writeFileSync(outPath, JSON.stringify(document, null, 2), 'utf8');
  console.log(`[OpenAPI] Successfully exported Swagger JSON to ${outPath}`);
  await app.close();
  process.exit(0);
}

exportOpenApi().catch((err) => {
  console.error('[OpenAPI] Export failed:', err);
  process.exit(1);
});
```

#### 3. In Monorepo Root `package.json`:
Add to `"scripts"`:
```json
"scripts": {
  "codegen:api": "pnpm --filter @erppreflight/web codegen:api",
  "codegen": "pnpm --filter @erppreflight/api openapi:export && pnpm --filter @erppreflight/web codegen:api"
}
```

#### 4. In `turbo.json`:
Register the task for caching and monorepo pipeline awareness:
```json
"tasks": {
  "codegen:api": {
    "dependsOn": [],
    "outputs": ["src/lib/api/generated/**"]
  }
}
```

---

### 4.4 Recommended NestJS Enhancement for Strongly Typed DTOs
In `apps/api/nest-cli.json`, add the `@nestjs/swagger` compiler plugin:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "plugins": ["@nestjs/swagger"]
  }
}
```
*Rationale*: This automatically converts all TypeScript DTO classes (e.g. `CreateProjectDto`, `UpdateProjectDto`) into rich OpenAPI schema properties (`name: string`, `description?: string`, `targetRelease?: string`), enabling Orval to generate complete, typed TypeScript interfaces instead of `{ [key: string]: unknown }`.

---

### 4.5 Alternative Monorepo Root `orval.config.ts`

If a single root-level Orval configuration file is preferred:

```typescript
import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: {
      target:
        process.env.OPENAPI_SPEC_URL ||
        './apps/api/openapi.json',
    },
    output: {
      mode: 'tags-split',
      target: './apps/web/src/lib/api/generated/endpoints',
      schemas: './apps/web/src/lib/api/generated/models',
      client: 'react-query',
      mock: true,
      clean: true,
      override: {
        mutator: {
          path: './apps/web/src/lib/api/custom-instance.ts',
          name: 'customInstance',
        },
        query: {
          version: 5,
          signal: true,
        },
      },
    },
  },
});
```
*Root Script in `package.json` for Root Config*:
`"codegen:api": "orval --config orval.config.ts"`

---

## 5. Verification Method

To independently verify this Orval codegen blueprint:

1. **Test Mutator URL Normalization & ApiError**:
   Run the verified test suite:
   ```bash
   node H:/.agents/explorer_m2_orval_2/test-mutator.mjs
   ```
   *Expected output*: `resolveApiUrl passed all assertions` and `ApiError passed all assertions`.

2. **Test Mutator TypeScript Compilation**:
   Verify strict TypeScript compilation of `production-custom-instance.ts`:
   ```bash
   npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext H:/.agents/explorer_m2_orval_2/production-custom-instance.ts
   ```
   *Expected output*: Exit code 0, zero type errors.

3. **Verify Web Layout Orval Codegen**:
   Execute Orval within the exact `test-web-layout` structure:
   ```bash
   npx orval --config H:/.agents/explorer_m2_orval_2/test-web-layout/orval.config.ts
   ```
   *Expected output*:
   `api - 🎉 ERP Preflight Core API - Your OpenAPI spec has been converted into ready to use orval!`
   - Inspect `H:/.agents/explorer_m2_orval_2/test-web-layout/src/lib/api/generated/endpoints/projects/projects.ts`:
     - Line 32: `import { customInstance } from '../../../custom-instance';` (verified clean relative resolution).
     - Line 137: `useProjectsControllerCreate` generated as `UseMutationResult` with `useMutation(...)`.
     - Line 211: `useProjectsControllerFindAll` generated as `UseQueryResult` with `useQuery(...)`.
     - Inspect `H:/.agents/explorer_m2_orval_2/test-web-layout/src/lib/api/generated/endpoints/projects/projects.msw.ts`: contains MSW v2 mock handlers.
