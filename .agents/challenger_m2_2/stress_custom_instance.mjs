import assert from 'node:assert';
import { resolveApiUrl, ApiError, customInstance, setStoredAuthToken, setStoredTenantId, getStoredAuthToken, getStoredTenantId } from '../../apps/web/src/lib/api/custom-instance.ts';

console.log('--- EMPIRICAL STRESS TEST: custom-instance.ts ---');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
    failed++;
  }
}

// 1. URL Resolution
test('resolveApiUrl: absolute URLs passed through unchanged', () => {
  assert.strictEqual(resolveApiUrl('https://example.com/api/v1/test'), 'https://example.com/api/v1/test');
  assert.strictEqual(resolveApiUrl('http://example.com/data'), 'http://example.com/data');
});

test('resolveApiUrl: strips trailing slash from base and redundant /api/v1', () => {
  const origEnv = process.env.NEXT_PUBLIC_API_URL;
  try {
    process.env.NEXT_PUBLIC_API_URL = 'http://api.local/api/v1/';
    assert.strictEqual(resolveApiUrl('/api/v1/projects'), 'http://api.local/api/v1/projects');
    assert.strictEqual(resolveApiUrl('api/v1/projects'), 'http://api.local/api/v1/projects');

    process.env.NEXT_PUBLIC_API_URL = 'http://api.local/api/v1';
    assert.strictEqual(resolveApiUrl('/api/v1/projects'), 'http://api.local/api/v1/projects');

    process.env.NEXT_PUBLIC_API_URL = 'http://api.local';
    assert.strictEqual(resolveApiUrl('/api/v1/projects'), 'http://api.local/api/v1/projects');
    assert.strictEqual(resolveApiUrl('/health'), 'http://api.local/health');
  } finally {
    process.env.NEXT_PUBLIC_API_URL = origEnv;
  }
});

// 2. ApiError handling
test('ApiError: constructs from string error payload', () => {
  const err = new ApiError(404, 'Not Found');
  assert.strictEqual(err.statusCode, 404);
  assert.strictEqual(err.message, 'Not Found');
  assert.strictEqual(err.name, 'ApiError');
});

test('ApiError: constructs from structured object with array message', () => {
  const err = new ApiError(400, {
    statusCode: 400,
    message: ['field1 is required', 'field2 must be positive'],
    correlationId: 'req-1234',
    timestamp: '2026-09-24T05:00:00Z',
    path: '/api/v1/projects',
  });
  assert.strictEqual(err.statusCode, 400);
  assert.strictEqual(err.message, 'field1 is required, field2 must be positive');
  assert.strictEqual(err.correlationId, 'req-1234');
  assert.deepStrictEqual(err.details, ['field1 is required', 'field2 must be positive']);
});

// 3. Storage SSR safety
test('Storage helpers: safely no-op in SSR without window', () => {
  assert.strictEqual(getStoredAuthToken(), null);
  assert.strictEqual(getStoredTenantId(), null);
  // Setting must not throw
  setStoredAuthToken('dummy-token');
  setStoredTenantId('dummy-tenant');
  assert.strictEqual(getStoredAuthToken(), null);
  assert.strictEqual(getStoredTenantId(), null);
});

// 4. Mock Fetch for customInstance behavior
const origFetch = global.fetch;

async function runMockFetchTests() {
  await asyncTest('customInstance: 204 No Content returns undefined', async () => {
    global.fetch = async () => new Response(null, { status: 204, statusText: 'No Content' });
    const res = await customInstance('/api/v1/empty');
    assert.strictEqual(res, undefined);
  });

  await asyncTest('customInstance: empty body (status 200) returns undefined without JSON error', async () => {
    global.fetch = async () => new Response('', { status: 200, statusText: 'OK' });
    const res = await customInstance('/api/v1/empty-body');
    assert.strictEqual(res, undefined);
  });

  await asyncTest('customInstance: JSON body parses correctly', async () => {
    const payload = { id: 'p1', name: 'Project Alpha' };
    global.fetch = async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await customInstance('/api/v1/projects/p1');
    assert.deepStrictEqual(res, payload);
  });

  await asyncTest('customInstance: Non-JSON plain text body returns raw text without throwing', async () => {
    const textData = 'RAW_METRICS_DATA';
    global.fetch = async () => new Response(textData, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
    const res = await customInstance('/api/v1/metrics');
    assert.strictEqual(res, textData);
  });

  await asyncTest('customInstance: 400 error throws ApiError with JSON details', async () => {
    const errorBody = {
      statusCode: 400,
      message: 'Invalid project ID',
      correlationId: 'corr-999',
    };
    global.fetch = async () => new Response(JSON.stringify(errorBody), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    try {
      await customInstance('/api/v1/projects/bad');
      assert.fail('Should have thrown ApiError');
    } catch (err) {
      assert(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.message, 'Invalid project ID');
      assert.strictEqual(err.correlationId, 'corr-999');
    }
  });

  await asyncTest('customInstance: 502 HTML error throws ApiError with text content', async () => {
    const htmlError = '<html><body>502 Bad Gateway</body></html>';
    global.fetch = async () => new Response(htmlError, {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });
    try {
      await customInstance('/api/v1/down');
      assert.fail('Should have thrown ApiError');
    } catch (err) {
      assert(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 502);
      assert.strictEqual(err.message, htmlError);
    }
  });

  await asyncTest('customInstance: JSON mutation automatically adds Content-Type application/json', async () => {
    let capturedHeaders = null;
    global.fetch = async (url, init) => {
      capturedHeaders = init.headers;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await customInstance('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Project' }),
    });

    assert(capturedHeaders.has('Content-Type'));
    assert.strictEqual(capturedHeaders.get('Content-Type'), 'application/json');
  });

  await asyncTest('customInstance: browser environment injects stored token and tenantId', async () => {
    const mockStorage = {
      erppreflight_token: 'jwt-token-xyz',
      erppreflight_tenant_id: 'tenant-guid-123',
    };
    global.window = {};
    global.localStorage = {
      getItem: (k) => mockStorage[k] || null,
      setItem: (k, v) => { mockStorage[k] = v; },
      removeItem: (k) => { delete mockStorage[k]; },
    };

    let capturedHeaders = null;
    global.fetch = async (url, init) => {
      capturedHeaders = init.headers;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await customInstance('/api/v1/projects');

    assert.strictEqual(capturedHeaders.get('Authorization'), 'Bearer jwt-token-xyz');
    assert.strictEqual(capturedHeaders.get('X-Tenant-Id'), 'tenant-guid-123');

    // Clean up mock window
    delete global.window;
    delete global.localStorage;
  });

  // Restore origFetch
  global.fetch = origFetch;

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runMockFetchTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
