import assert from 'node:assert';
import { resolveApiUrl, ApiError, customInstance, setStoredAuthToken, setStoredTenantId, getStoredAuthToken, getStoredTenantId } from '../../apps/web/src/lib/api/custom-instance.ts';

console.log('--- REPRODUCING FETCH STREAM CONSUMPTION BUG ---');

const htmlError = '<html><body>502 Bad Gateway</body></html>';
global.fetch = async () => new Response(htmlError, {
  status: 502,
  headers: { 'Content-Type': 'text/html' },
});

try {
  await customInstance('/api/v1/down');
  console.log('Did not throw');
} catch (err) {
  console.log('Caught error name:', err.name);
  console.log('Caught error message:', err.message);
  console.log('Caught error constructor:', err.constructor.name);
  console.log('Is ApiError?:', err instanceof ApiError);
}
