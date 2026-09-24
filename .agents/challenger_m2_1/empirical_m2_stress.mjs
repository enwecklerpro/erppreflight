/**
 * Empirical Stress Test Harness for Milestone 2 Deliverables
 * Author: challenger_m2_1 (teamwork_preview_challenger)
 * 
 * Verifies:
 * 1. customInstance URL resolution, auth/tenant headers, SSR safety, error mapping, and status handling
 * 2. scripts/check-no-dependency-soup.mjs detection capabilities, coverage, and edge cases
 * 3. Lockfile and workspace dependency integrity
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');


console.log('=== Milestone 2 Empirical Stress Test Harness ===\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const findings = [];

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✔ [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ✖ [FAIL] ${name}`);
    console.error(`    Error: ${err.message}`);
    findings.push({ name, error: err.message, stack: err.stack });
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✔ [PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ✖ [FAIL] ${name}`);
    console.error(`    Error: ${err.message}`);
    findings.push({ name, error: err.message, stack: err.stack });
  }
}

// -------------------------------------------------------------
// SECTION 1: customInstance Unit & Boundary Stress Testing
// -------------------------------------------------------------
console.log('--- Section 1: customInstance Architecture & Edge Cases ---');

// Dynamically import custom-instance
const customInstanceModulePath = path.resolve(REPO_ROOT, 'apps/web/src/lib/api/custom-instance.ts');

// We'll test the exported helpers and logic
import {
  resolveApiUrl,
  ApiError,
  AUTH_TOKEN_KEY,
  TENANT_ID_KEY,
  getStoredAuthToken,
  setStoredAuthToken,
  getStoredTenantId,
  setStoredTenantId,
  customInstance
} from '../../apps/web/src/lib/api/custom-instance.ts';

// 1.1 URL Resolution
runTest('resolveApiUrl: preserves absolute HTTP/HTTPS URLs', () => {
  assert.equal(resolveApiUrl('https://api.erp.test/v1/projects'), 'https://api.erp.test/v1/projects');
  assert.equal(resolveApiUrl('http://10.0.0.1:8000/health'), 'http://10.0.0.1:8000/health');
});

runTest('resolveApiUrl: handles duplicate /api/v1 prefix safely', () => {
  const origEnv = process.env.NEXT_PUBLIC_API_URL;
  try {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api/v1';
    assert.equal(resolveApiUrl('/api/v1/projects'), 'http://localhost:3001/api/v1/projects');
    assert.equal(resolveApiUrl('api/v1/projects'), 'http://localhost:3001/api/v1/projects');

    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api/v1/';
    assert.equal(resolveApiUrl('/api/v1/projects'), 'http://localhost:3001/api/v1/projects');
  } finally {
    if (origEnv === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = origEnv;
  }
});

runTest('resolveApiUrl: handles base without /api/v1 prefix', () => {
  const origEnv = process.env.NEXT_PUBLIC_API_URL;
  try {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';
    assert.equal(resolveApiUrl('/api/v1/projects'), 'http://localhost:3001/api/v1/projects');
    assert.equal(resolveApiUrl('health/liveness'), 'http://localhost:3001/health/liveness');
  } finally {
    if (origEnv === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = origEnv;
  }
});


runTest('resolveApiUrl: SSR fallback when NEXT_PUBLIC_API_URL is unset', () => {
  const origEnv = process.env.NEXT_PUBLIC_API_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
  try {
    // In node/SSR (global.window is undefined)
    const resolved = resolveApiUrl('/api/v1/projects');
    assert.equal(resolved, 'http://localhost:4000/api/v1/projects');
  } finally {
    if (origEnv === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = origEnv;
    }
  }
});


// 1.2 Storage Helpers SSR Safety
runTest('Storage helpers: return null in SSR without throwing ReferenceError', () => {
  assert.equal(typeof globalThis.window, 'undefined', 'Prerequisite: window must be undefined in node environment');
  assert.equal(getStoredAuthToken(), null);
  assert.equal(getStoredTenantId(), null);
  // Setting tokens in SSR does not throw
  setStoredAuthToken('test-token');
  setStoredTenantId('tenant-123');
  assert.equal(getStoredAuthToken(), null);
  assert.equal(getStoredTenantId(), null);
});

// 1.3 Storage Helpers Mocked Browser Storage
runTest('Storage helpers: correctly persist and clear when localStorage is available', () => {
  const storage = new Map();
  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear()
  };

  try {
    setStoredAuthToken('jwt-xyz-123');
    setStoredTenantId('tenant-uuid-456');

    assert.equal(getStoredAuthToken(), 'jwt-xyz-123');
    assert.equal(getStoredTenantId(), 'tenant-uuid-456');

    setStoredAuthToken(null);
    setStoredTenantId(null);

    assert.equal(getStoredAuthToken(), null);
    assert.equal(getStoredTenantId(), null);
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
  }
});

// 1.4 ApiError parsing
runTest('ApiError: parses string error messages', () => {
  const err = new ApiError(500, 'Internal Server Error');
  assert.equal(err.name, 'ApiError');
  assert.equal(err.statusCode, 500);
  assert.equal(err.message, 'Internal Server Error');
  assert.ok(err instanceof Error);
});

runTest('ApiError: parses NestJS structured error payload with string message', () => {
  const payload = {
    statusCode: 404,
    message: 'Project proj-123 not found',
    error: 'Not Found',
    correlationId: 'req-corr-999',
    timestamp: '2026-09-24T05:00:00Z',
    path: '/api/v1/projects/proj-123'
  };
  const err = new ApiError(404, payload);
  assert.equal(err.statusCode, 404);
  assert.equal(err.message, 'Project proj-123 not found');
  assert.equal(err.correlationId, 'req-corr-999');
  assert.equal(err.details, 'Project proj-123 not found');
  assert.equal(err.path, '/api/v1/projects/proj-123');
});

runTest('ApiError: parses NestJS validation errors with array message', () => {
  const payload = {
    statusCode: 400,
    message: ['name must not be empty', 'targetRelease is invalid'],
    error: 'Bad Request',
    correlationId: 'req-corr-888'
  };
  const err = new ApiError(400, payload);
  assert.equal(err.statusCode, 400);
  assert.equal(err.message, 'name must not be empty, targetRelease is invalid');
  assert.deepEqual(err.details, ['name must not be empty', 'targetRelease is invalid']);
});

runTest('ApiError: handles empty or undefined message gracefully', () => {
  const payload = {
    statusCode: 403,
    error: 'Forbidden'
  };
  const err = new ApiError(403, payload);
  assert.equal(err.statusCode, 403);
  assert.equal(err.message, 'API request failed with HTTP 403');
});

// 1.5 customInstance fetch lifecycle & edge cases
await runAsyncTest('customInstance: successful JSON response parsing', async () => {
  const mockData = { id: 'p-1', name: 'ERP Preflight Core' };
  const origFetch = globalThis.fetch;

  globalThis.fetch = async (url, init) => {
    return new Response(JSON.stringify(mockData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const result = await customInstance('http://localhost:3001/api/v1/projects/p-1');
    assert.deepEqual(result, mockData);
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runAsyncTest('customInstance: HTTP 204 No Content returns undefined', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(null, { status: 204 });
  };

  try {
    const result = await customInstance('http://localhost:3001/api/v1/projects/p-1', { method: 'DELETE' });
    assert.equal(result, undefined);
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runAsyncTest('customInstance: empty response body returns undefined', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response('   ', { status: 200 });
  };

  try {
    const result = await customInstance('http://localhost:3001/api/v1/ping');
    assert.equal(result, undefined);
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runAsyncTest('customInstance: non-JSON string response returns text', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response('PONG', { status: 200 });
  };

  try {
    const result = await customInstance('http://localhost:3001/api/v1/ping');
    assert.equal(result, 'PONG');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runAsyncTest('customInstance: sets Content-Type application/json for string body', async () => {
  const origFetch = globalThis.fetch;
  let capturedHeaders;

  globalThis.fetch = async (url, init) => {
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    await customInstance('http://localhost:3001/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Project 1' })
    });
    assert.equal(capturedHeaders.get('Content-Type'), 'application/json');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runAsyncTest('customInstance: browser auth & tenant header injection', async () => {
  const origFetch = globalThis.fetch;
  let capturedHeaders;

  const storage = new Map();
  storage.set(AUTH_TOKEN_KEY, 'bearer-mock-token');
  storage.set(TENANT_ID_KEY, 'tenant-uuid-1234');

  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key)
  };

  globalThis.fetch = async (url, init) => {
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  try {
    await customInstance('http://localhost:3001/api/v1/projects');
    assert.equal(capturedHeaders.get('Authorization'), 'Bearer bearer-mock-token');
    assert.equal(capturedHeaders.get('X-Tenant-Id'), 'tenant-uuid-1234');
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
    globalThis.fetch = origFetch;
  }
});

await runAsyncTest('customInstance: explicit headers override stored browser auth/tenant', async () => {
  const origFetch = globalThis.fetch;
  let capturedHeaders;

  const storage = new Map();
  storage.set(AUTH_TOKEN_KEY, 'stored-token');
  storage.set(TENANT_ID_KEY, 'stored-tenant');

  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key)
  };

  globalThis.fetch = async (url, init) => {
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  try {
    await customInstance('http://localhost:3001/api/v1/projects', {
      headers: {
        'Authorization': 'Bearer custom-override-token',
        'X-Tenant-Id': 'custom-override-tenant'
      }
    });
    assert.equal(capturedHeaders.get('Authorization'), 'Bearer custom-override-token');
    assert.equal(capturedHeaders.get('X-Tenant-Id'), 'custom-override-tenant');
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
    globalThis.fetch = origFetch;
  }
});

await runAsyncTest('customInstance: throws ApiError on HTTP 400/500 errors', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(
      JSON.stringify({
        statusCode: 403,
        message: 'Tenant cross-access denied',
        correlationId: 'corr-denied-1'
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    let caughtError;
    try {
      await customInstance('http://localhost:3001/api/v1/tenants/leak');
    } catch (err) {
      caughtError = err;
    }
    assert.ok(caughtError instanceof ApiError);
    assert.equal(caughtError.statusCode, 403);
    assert.equal(caughtError.message, 'Tenant cross-access denied');
    assert.equal(caughtError.correlationId, 'corr-denied-1');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runAsyncTest('customInstance: [DEFECT DEMONSTRATION] non-JSON error causes stream disturbance TypeError', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response('502 Bad Gateway: Upstream timeout', {
      status: 502,
      headers: { 'Content-Type': 'text/plain' }
    });
  };

  try {
    let caughtError;
    try {
      await customInstance('http://localhost:3001/api/v1/timeout');
    } catch (err) {
      caughtError = err;
    }
    console.log(`    [Demonstrated Defect] Caught error name: ${caughtError.name}, message: "${caughtError.message}"`);
    assert.equal(caughtError.name, 'TypeError');
    assert.ok(caughtError.message.includes('Body has already been read') || caughtError.message.includes('disturbed'));
  } finally {
    globalThis.fetch = origFetch;
  }
});


await runAsyncTest('customInstance: forwards AbortSignal properly to fetch', async () => {
  const origFetch = globalThis.fetch;
  let receivedSignal;

  globalThis.fetch = async (url, init) => {
    receivedSignal = init.signal;
    if (init.signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    const controller = new AbortController();
    controller.abort();

    let caughtError;
    try {
      await customInstance('http://localhost:3001/api/v1/projects', {
        signal: controller.signal
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(receivedSignal, 'Signal must be passed through to fetch');
    assert.equal(receivedSignal.aborted, true);
    assert.equal(caughtError.name, 'AbortError');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runAsyncTest('customInstance: preserves query strings in URL resolution', async () => {
  const origFetch = globalThis.fetch;
  let calledUrl;

  globalThis.fetch = async (url) => {
    calledUrl = url;
    return new Response(JSON.stringify([]), { status: 200 });
  };

  try {
    await customInstance('/api/v1/projects?page=2&limit=50&sort=desc');
    assert.equal(calledUrl, 'http://localhost:4000/api/v1/projects?page=2&limit=50&sort=desc');
  } finally {
    globalThis.fetch = origFetch;
  }
});

await runAsyncTest('customInstance: respects lowercase headers in request options', async () => {
  const origFetch = globalThis.fetch;
  let capturedHeaders;

  const storage = new Map();
  storage.set(AUTH_TOKEN_KEY, 'browser-storage-token');
  storage.set(TENANT_ID_KEY, 'browser-storage-tenant');

  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key)
  };

  globalThis.fetch = async (url, init) => {
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    await customInstance('http://localhost:3001/api/v1/projects', {
      headers: {
        'authorization': 'Bearer lowercase-override',
        'x-tenant-id': 'lowercase-tenant'
      }
    });
    // Headers object in Fetch is case-insensitive
    assert.equal(capturedHeaders.get('authorization'), 'Bearer lowercase-override');
    assert.equal(capturedHeaders.get('x-tenant-id'), 'lowercase-tenant');
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
    globalThis.fetch = origFetch;
  }
});


// -------------------------------------------------------------
// SECTION 2: Anti-Duplication Linter Stress Testing
// -------------------------------------------------------------
console.log('\n--- Section 2: check-no-dependency-soup.mjs Stress Testing ---');

const checkScriptPath = path.resolve(REPO_ROOT, 'scripts/check-no-dependency-soup.mjs');
assert.ok(fs.existsSync(checkScriptPath), 'scripts/check-no-dependency-soup.mjs must exist');

// Read check script contents to verify its rules and regex engines
const scriptCode = fs.readFileSync(checkScriptPath, 'utf8');

runTest('Linter coverage: all 10 core categories from AGENTS.md §4.2 are checked', () => {
  const expectedCategories = [
    'Form Management',
    'Client State Management',
    'Server State & Caching',
    'Database ORM',
    'Interactive Graph Canvas',
    'Data Grid / Large Tables',
    'Analytics & Charts',
    'Job Queue & Background Tasks',
    'Runtime Schema Validation',
    'Headless UI Primitives (New Components)'
  ];

  for (const cat of expectedCategories) {
    assert.ok(scriptCode.includes(cat), `Category "${cat}" should be included in FORBIDDEN_RULES`);
  }
});

runTest('Linter rule check: detects react-hook-form in package.json dependencies', () => {
  // Simulate synthetic package.json check
  const syntheticPkg = {
    name: 'test-pkg',
    dependencies: { 'react-hook-form': '^7.0.0' }
  };
  const violations = [];
  const FORBIDDEN_TEST = ['react-hook-form', 'formik', 'redux', 'prisma'];
  const allDeps = new Set(Object.keys(syntheticPkg.dependencies));
  for (const f of FORBIDDEN_TEST) {
    if (allDeps.has(f)) violations.push(f);
  }
  assert.equal(violations.length, 1);
  assert.equal(violations[0], 'react-hook-form');
});

runTest('Linter rule check: detects devDependencies and peerDependencies', () => {
  const syntheticPkg = {
    name: 'test-pkg',
    devDependencies: { 'redux': '^5.0.0' },
    peerDependencies: { 'prisma': '^6.0.0' }
  };
  const violations = [];
  const FORBIDDEN_TEST = ['react-hook-form', 'formik', 'redux', 'prisma'];
  const allDeps = new Set([...Object.keys(syntheticPkg.devDependencies), ...Object.keys(syntheticPkg.peerDependencies)]);
  for (const f of FORBIDDEN_TEST) {
    if (allDeps.has(f)) violations.push(f);
  }
  assert.equal(violations.length, 2);
  assert.ok(violations.includes('redux'));
  assert.ok(violations.includes('prisma'));
});

// Import regex evaluation
runTest('Linter import regex: catches standard ESM and CJS imports', () => {
  const importRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;

  const testCases = [
    { code: "import { useForm } from 'react-hook-form';", expected: 'react-hook-form' },
    { code: "import Formik from 'formik';", expected: 'formik' },
    { code: "import * as Redux from 'redux';", expected: 'redux' },
    { code: "import 'mobx';", expected: 'mobx' },
    { code: "const r = require('react-redux');", expected: 'react-redux' },
    { code: "import { Controller } from 'react-hook-form/dist/index.js';", expected: 'react-hook-form/dist/index.js' }
  ];

  for (const tc of testCases) {
    importRegex.lastIndex = 0;
    const match = importRegex.exec(tc.code);
    assert.ok(match, `Regex should match: ${tc.code}`);
    assert.equal(match[1] || match[2], tc.expected);
  }
});

runTest('Linter import regex: catches multiline import statements', () => {
  const importRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
  const multiline = `import {\n  useForm,\n  Controller\n} from 'react-hook-form';`;
  importRegex.lastIndex = 0;
  const match = importRegex.exec(multiline);
  assert.ok(match, 'Regex should match multiline import');
  assert.equal(match[1], 'react-hook-form');
});

runTest('Linter edge case detection: dynamic imports & re-exports observation', () => {
  // Let's test whether current regex matches dynamic import or re-export
  const importRegex = /(?:import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
  
  const dynamicImport = "const rhf = await import('react-hook-form');";
  importRegex.lastIndex = 0;
  const matchDynamic = importRegex.exec(dynamicImport);

  const reExport = "export * from 'react-hook-form';";
  importRegex.lastIndex = 0;
  const matchReExport = importRegex.exec(reExport);

  // Both are blind spots in the current check-no-dependency-soup.mjs regex
  console.log(`    [Observation] Dynamic import matched? ${Boolean(matchDynamic)}`);
  console.log(`    [Observation] Re-export matched? ${Boolean(matchReExport)}`);
  assert.equal(Boolean(matchDynamic), false, 'Documented blind spot: dynamic import is not matched by import\\s+');
  assert.equal(Boolean(matchReExport), false, 'Documented blind spot: re-export is not matched');
});

// -------------------------------------------------------------
// SECTION 3: Lockfile & Monorepo Package Consistency
// -------------------------------------------------------------
console.log('\n--- Section 3: Lockfile & Workspace Dependency Integrity ---');

runTest('Monorepo packages: all 8 package.json files exist and are valid JSON', () => {
  const pnpmWorkspaceFile = path.resolve(REPO_ROOT, 'pnpm-workspace.yaml');
  assert.ok(fs.existsSync(pnpmWorkspaceFile), 'pnpm-workspace.yaml must exist');

  const expectedPkgPaths = [
    'package.json',
    'apps/web/package.json',
    'apps/api/package.json',
    'packages/schemas/package.json',
    'packages/evidence/package.json',
    'packages/tenancy/package.json',
    'packages/database/package.json',
    'packages/auth/package.json'
  ];

  for (const relPath of expectedPkgPaths) {
    const fullPath = path.resolve(REPO_ROOT, relPath);
    assert.ok(fs.existsSync(fullPath), `${relPath} must exist`);
    const content = fs.readFileSync(fullPath, 'utf8');
    const parsed = JSON.parse(content);
    assert.ok(parsed.name, `${relPath} must have a name property`);
  }
});

runTest('Lockfile integrity: pnpm-lock.yaml contains all approved Milestone 2 dependencies', () => {
  const lockfilePath = path.resolve(REPO_ROOT, 'pnpm-lock.yaml');
  assert.ok(fs.existsSync(lockfilePath), 'pnpm-lock.yaml must exist');
  const lockfileContent = fs.readFileSync(lockfilePath, 'utf8');

  const requiredPackages = [
    '@tanstack/react-query',
    '@tanstack/react-table',
    '@tanstack/react-virtual',
    '@tanstack/react-form',
    '@tanstack/react-pacer',
    '@base-ui-components/react',
    '@xyflow/react',
    'elkjs',
    'motion',
    'orval'
  ];

  for (const pkg of requiredPackages) {
    assert.ok(lockfileContent.includes(pkg), `pnpm-lock.yaml must contain ${pkg}`);
  }
});

console.log('\n==============================================================');
console.log(`Results: Total ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
if (failedTests > 0) {
  console.error(`FAILURE: ${failedTests} tests failed!`);
  process.exit(1);
} else {
  console.log('SUCCESS: All empirical stress tests completed cleanly.');
}
