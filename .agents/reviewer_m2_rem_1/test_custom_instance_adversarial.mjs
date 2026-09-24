import assert from 'node:assert';
import { resolveApiUrl, ApiError, customInstance } from '../../apps/web/src/lib/api/custom-instance.ts';

console.log('--- ADVERSARIAL STRESS TEST: custom-instance.ts ---');

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err);
    failed++;
  }
}

const origFetch = global.fetch;

async function run() {
  // Test 1: Empty error body (HTTP 500)
  await check('HTTP 500 with empty body throws ApiError with HTTP 500 message', async () => {
    global.fetch = async () => new Response('', { status: 500 });
    try {
      await customInstance('/test-500-empty');
      assert.fail('Should have thrown');
    } catch (err) {
      assert(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 500);
      assert.strictEqual(err.message, 'HTTP 500');
    }
  });

  // Test 2: Whitespace only error body (HTTP 503)
  await check('HTTP 503 with whitespace only body throws ApiError', async () => {
    global.fetch = async () => new Response('   \n\t  ', { status: 503 });
    try {
      await customInstance('/test-503-whitespace');
      assert.fail('Should have thrown');
    } catch (err) {
      assert(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 503);
      assert.strictEqual(err.message.trim(), '');
    }
  });

  // Test 3: Truncated JSON in error body (e.g. proxy dropped connection mid-stream)
  await check('HTTP 502 with truncated JSON payload', async () => {
    const truncated = '{"error": "Internal", "detail":';
    global.fetch = async () => new Response(truncated, { status: 502 });
    try {
      await customInstance('/test-502-truncated');
      assert.fail('Should have thrown');
    } catch (err) {
      assert(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 502);
      assert.strictEqual(err.message, truncated);
    }
  });

  // Test 4: JSON error with object missing message property
  await check('HTTP 400 with JSON missing message field', async () => {
    const raw = JSON.stringify({ error: 'Bad Request', code: 'INVALID_HEADER' });
    global.fetch = async () => new Response(raw, {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
    try {
      await customInstance('/test-400-no-message');
      assert.fail('Should have thrown');
    } catch (err) {
      assert(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.message, 'API request failed with HTTP 400');
    }
  });

  // Test 5: AbortSignal rejection propagation
  await check('AbortSignal forwards and throws AbortError cleanly', async () => {
    const controller = new AbortController();
    global.fetch = async (url, init) => {
      return new Promise((_, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      });
    };

    const promise = customInstance('/test-abort', { signal: controller.signal });
    controller.abort();
    try {
      await promise;
      assert.fail('Should have aborted');
    } catch (err) {
      assert.strictEqual(err.name, 'AbortError');
      assert(!(err instanceof ApiError));
    }
  });

  // Test 6: HTTP 200 with whitespace-only payload returns undefined
  await check('HTTP 200 with whitespace-only payload returns undefined', async () => {
    global.fetch = async () => new Response('   \n  \t', { status: 200 });
    const res = await customInstance('/test-200-whitespace');
    assert.strictEqual(res, undefined);
  });

  // Test 7: HTTP 200 with valid boolean / number JSON
  await check('HTTP 200 with boolean JSON returns boolean value', async () => {
    global.fetch = async () => new Response('true', { status: 200 });
    const res = await customInstance('/test-200-bool');
    assert.strictEqual(res, true);
  });

  // Test 8: Large 256KB HTML error body
  await check('HTTP 500 with 256KB HTML stacktrace', async () => {
    const hugeHtml = '<div>' + 'A'.repeat(256 * 1024) + '</div>';
    global.fetch = async () => new Response(hugeHtml, { status: 500 });
    try {
      await customInstance('/test-huge-error');
      assert.fail('Should have thrown');
    } catch (err) {
      assert(err instanceof ApiError);
      assert.strictEqual(err.statusCode, 500);
      assert.strictEqual(err.message, hugeHtml);
    }
  });

  global.fetch = origFetch;
  console.log(`\nReviewer adversarial tests: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
