import assert from 'node:assert/strict';

// Test resolveApiUrl logic
const resolveApiUrl = (path, envUrl) => {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const rawBase = envUrl || 'http://localhost:4000';
  let cleanBase = rawBase.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  if (cleanBase.endsWith('/api/v1') && cleanPath.startsWith('/api/v1')) {
    cleanBase = cleanBase.slice(0, -'/api/v1'.length);
  }

  return `${cleanBase}${cleanPath}`;
};

console.log('Testing resolveApiUrl...');
assert.equal(
  resolveApiUrl('/api/v1/projects', 'http://localhost:4000'),
  'http://localhost:4000/api/v1/projects'
);
assert.equal(
  resolveApiUrl('/api/v1/projects', 'http://localhost:4000/'),
  'http://localhost:4000/api/v1/projects'
);
assert.equal(
  resolveApiUrl('/api/v1/projects', 'http://localhost:4000/api/v1'),
  'http://localhost:4000/api/v1/projects',
  'Should strip redundant /api/v1 from base'
);
assert.equal(
  resolveApiUrl('/health/liveness', 'http://localhost:4000/api/v1'),
  'http://localhost:4000/api/v1/health/liveness'
);
assert.equal(
  resolveApiUrl('https://other-domain.com/data', 'http://localhost:4000'),
  'https://other-domain.com/data'
);
console.log('✔ resolveApiUrl passed all assertions');

// Test ApiError class
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

console.log('Testing ApiError...');
const err1 = new ApiError(400, {
  statusCode: 400,
  message: ['name should not be empty', 'slug must be lowercase'],
  correlationId: 'corr-xyz-123',
  path: '/api/v1/projects',
  timestamp: '2026-09-24T05:00:00Z',
});
assert.equal(err1.statusCode, 400);
assert.equal(err1.message, 'name should not be empty, slug must be lowercase');
assert.equal(err1.correlationId, 'corr-xyz-123');
assert.equal(err1.path, '/api/v1/projects');
assert.deepEqual(err1.details, ['name should not be empty', 'slug must be lowercase']);
console.log('✔ ApiError passed all assertions');
