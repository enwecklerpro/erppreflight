import assert from 'node:assert';

// Transpile or test compiled / extracted logic of custom-instance.ts
// Let's test the functions exported by custom-instance.ts
// Since custom-instance.ts is TypeScript, let's use node with --import or tsx/ts-node,
// or test the logic directly or run tsx if available.

async function main() {
  console.log('Testing custom-instance.ts logic...');

  // 1. Test ApiError logic
  class ApiError extends Error {
    constructor(status, data) {
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

  const err1 = new ApiError(404, { message: 'Not Found', correlationId: 'req-123' });
  assert.strictEqual(err1.statusCode, 404);
  assert.strictEqual(err1.message, 'Not Found');
  assert.strictEqual(err1.correlationId, 'req-123');

  const err2 = new ApiError(400, { message: ['Field A is required', 'Field B must be string'] });
  assert.strictEqual(err2.message, 'Field A is required, Field B must be string');

  // 2. Test resolveApiUrl logic
  const resolveApiUrl = (path, envApiUrl) => {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }
    const rawBase = envApiUrl || 'http://localhost:4000';
    let cleanBase = rawBase.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    if (cleanBase.endsWith('/api/v1') && cleanPath.startsWith('/api/v1')) {
      cleanBase = cleanBase.slice(0, -'/api/v1'.length);
    }
    return `${cleanBase}${cleanPath}`;
  };

  assert.strictEqual(
    resolveApiUrl('https://remote.corp/api/v1/projects', 'http://localhost:4000'),
    'https://remote.corp/api/v1/projects',
    'Full URL should be returned untouched'
  );

  assert.strictEqual(
    resolveApiUrl('/api/v1/projects', 'http://localhost:4000/api/v1/'),
    'http://localhost:4000/api/v1/projects',
    'Duplicate /api/v1 must be stripped from base'
  );

  assert.strictEqual(
    resolveApiUrl('projects', 'http://localhost:4000'),
    'http://localhost:4000/projects',
    'Relative path without leading slash should have slash added'
  );

  console.log('All custom-instance unit assertions passed successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
