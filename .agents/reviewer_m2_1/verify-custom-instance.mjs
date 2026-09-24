import assert from 'node:assert';
import {
  resolveApiUrl,
  ApiError,
  customInstance,
  AUTH_TOKEN_KEY,
  TENANT_ID_KEY,
  getStoredAuthToken,
  setStoredAuthToken,
  getStoredTenantId,
  setStoredTenantId
} from '../../apps/web/src/lib/api/custom-instance.ts';

console.log('--- Testing resolveApiUrl ---');

// 1. Full URLs
assert.strictEqual(
  resolveApiUrl('https://api.example.com/test'),
  'https://api.example.com/test'
);
assert.strictEqual(
  resolveApiUrl('http://api.example.com/test'),
  'http://api.example.com/test'
);

// 2. Base URL normalization with /api/v1 duplication
const origEnv = process.env.NEXT_PUBLIC_API_URL;

try {
  process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api/v1';
  assert.strictEqual(
    resolveApiUrl('/api/v1/projects'),
    'http://localhost:3001/api/v1/projects'
  );
  assert.strictEqual(
    resolveApiUrl('api/v1/projects'),
    'http://localhost:3001/api/v1/projects'
  );

  process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api/v1/';
  assert.strictEqual(
    resolveApiUrl('/api/v1/projects'),
    'http://localhost:3001/api/v1/projects'
  );

  process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';
  assert.strictEqual(
    resolveApiUrl('/api/v1/projects'),
    'http://localhost:3001/api/v1/projects'
  );
  assert.strictEqual(
    resolveApiUrl('api/v1/projects'),
    'http://localhost:3001/api/v1/projects'
  );

  delete process.env.NEXT_PUBLIC_API_URL;
  // Node environment (no window): fallback to http://localhost:4000
  assert.strictEqual(
    resolveApiUrl('/api/v1/health'),
    'http://localhost:4000/api/v1/health'
  );
} finally {
  if (origEnv) {
    process.env.NEXT_PUBLIC_API_URL = origEnv;
  } else {
    delete process.env.NEXT_PUBLIC_API_URL;
  }
}

console.log('✔ resolveApiUrl tests passed');

console.log('--- Testing ApiError ---');
const stringErr = new ApiError(404, 'Not Found');
assert.strictEqual(stringErr.statusCode, 404);
assert.strictEqual(stringErr.message, 'Not Found');
assert.strictEqual(stringErr.name, 'ApiError');

const structErr = new ApiError(400, {
  statusCode: 400,
  message: ['Field x is required', 'Field y must be a string'],
  error: 'Bad Request',
  correlationId: 'req-12345',
  timestamp: '2026-09-24T05:00:00Z',
  path: '/api/v1/projects'
});
assert.strictEqual(structErr.statusCode, 400);
assert.strictEqual(structErr.message, 'Field x is required, Field y must be a string');
assert.strictEqual(structErr.correlationId, 'req-12345');
assert.strictEqual(structErr.path, '/api/v1/projects');
assert.strictEqual(structErr.timestamp, '2026-09-24T05:00:00Z');
assert.deepStrictEqual(structErr.details, ['Field x is required', 'Field y must be a string']);

console.log('✔ ApiError tests passed');

console.log('--- Testing customInstance with mock fetch ---');
const originalFetch = globalThis.fetch;

try {
  // Test 1: 204 No Content
  globalThis.fetch = async (url, init) => {
    return {
      status: 204,
      ok: true,
      text: async () => '',
      json: async () => ({})
    };
  };

  const res204 = await customInstance('/api/v1/delete');
  assert.strictEqual(res204, undefined, 'HTTP 204 should return undefined');

  // Test 2: Empty response body
  globalThis.fetch = async (url, init) => {
    return {
      status: 200,
      ok: true,
      text: async () => '   ',
      json: async () => { throw new Error('invalid json'); }
    };
  };

  const resEmpty = await customInstance('/api/v1/empty');
  assert.strictEqual(resEmpty, undefined, 'Empty body should return undefined');

  // Test 3: JSON response
  globalThis.fetch = async (url, init) => {
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ id: 'proj-1', name: 'ERP Migration' })
    };
  };

  const resJson = await customInstance('/api/v1/projects/1');
  assert.deepStrictEqual(resJson, { id: 'proj-1', name: 'ERP Migration' });

  // Test 4: Text fallback response
  globalThis.fetch = async (url, init) => {
    return {
      status: 200,
      ok: true,
      text: async () => 'plain text response'
    };
  };

  const resText = await customInstance('/api/v1/raw');
  assert.strictEqual(resText, 'plain text response');

  // Test 5: Error handling (HTTP 401)
  globalThis.fetch = async (url, init) => {
    return {
      status: 401,
      ok: false,
      json: async () => ({
        statusCode: 401,
        message: 'Unauthorized token expired',
        correlationId: 'corr-999'
      }),
      text: async () => JSON.stringify({
        statusCode: 401,
        message: 'Unauthorized token expired',
        correlationId: 'corr-999'
      })
    };
  };

  await assert.rejects(
    async () => await customInstance('/api/v1/protected'),
    (err) => {
      assert(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 401);
      assert.strictEqual(err.message, 'Unauthorized token expired');
      assert.strictEqual(err.correlationId, 'corr-999');
      return true;
    }
  );

  // Test 6: Default Content-Type for JSON body
  let capturedHeaders;
  globalThis.fetch = async (url, init) => {
    capturedHeaders = init.headers;
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ success: true })
    };
  };

  await customInstance('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ name: 'Test' })
  });

  assert.strictEqual(
    capturedHeaders.get('Content-Type'),
    'application/json'
  );

  // Test 7: AbortSignal forwarding
  let capturedSignal;
  globalThis.fetch = async (url, init) => {
    capturedSignal = init.signal;
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ ok: true })
    };
  };

  const controller = new AbortController();
  await customInstance('/api/v1/cancel', {
    signal: controller.signal
  });
  assert.strictEqual(capturedSignal, controller.signal);

  console.log('✔ customInstance fetch tests passed');

  // Test 8: Browser-side storage & header injection
  // Simulate window and localStorage
  const storage = new Map();
  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear()
  };

  setStoredAuthToken('jwt-sample-token-xyz');
  setStoredTenantId('tenant-uuid-1234');
  assert.strictEqual(getStoredAuthToken(), 'jwt-sample-token-xyz');
  assert.strictEqual(getStoredTenantId(), 'tenant-uuid-1234');

  globalThis.fetch = async (url, init) => {
    capturedHeaders = init.headers;
    return {
      status: 200,
      ok: true,
      text: async () => JSON.stringify({ ok: true })
    };
  };

  await customInstance('/api/v1/tenant-test');
  assert.strictEqual(capturedHeaders.get('Authorization'), 'Bearer jwt-sample-token-xyz');
  assert.strictEqual(capturedHeaders.get('X-Tenant-Id'), 'tenant-uuid-1234');

  // Header override test: if caller supplies explicit X-Tenant-Id, it should be respected
  await customInstance('/api/v1/tenant-override', {
    headers: { 'X-Tenant-Id': 'tenant-override-5678' }
  });
  assert.strictEqual(capturedHeaders.get('X-Tenant-Id'), 'tenant-override-5678');

  console.log('✔ Browser storage and auth/tenant header tests passed');

} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.window;
  delete globalThis.localStorage;
}

console.log('\nALL MUTATOR & UTILITY TESTS PASSED SUCCESSFULLY!');
