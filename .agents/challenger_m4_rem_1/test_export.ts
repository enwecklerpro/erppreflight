import { triggerExport, escapeCsvCell } from '../../apps/web/src/lib/export';

// Setup mock DOM / Browser environment for Node
class MockElement {
  href: string = '';
  download: string = '';
  clicked: boolean = false;
  click() {
    this.clicked = true;
  }
}

let createdBlobs: Array<{ content: any[]; type: string; filename: string }> = [];

const mockWindow = {
  location: {
    search: '?page=1&search=test',
  },
  URL: {
    createObjectURL(blob: any) {
      return `blob:mock-url-${Math.random()}`;
    },
    revokeObjectURL(_url: string) {},
  },
};

const mockDocument = {
  createElement(tag: string) {
    if (tag === 'a') return new MockElement();
    return {};
  },
  body: {
    appendChild(_el: any) {},
    removeChild(_el: any) {},
  },
};

(global as any).window = mockWindow;
(global as any).document = mockDocument;

// Intercept Blob constructor to verify created content
const OriginalBlob = global.Blob;
(global as any).Blob = class MockBlob {
  parts: any[];
  options: any;
  constructor(parts: any[], options: any) {
    this.parts = parts;
    this.options = options;
    createdBlobs.push({
      content: parts,
      type: options?.type || '',
      filename: '',
    });
  }
  async text() {
    return this.parts.join('');
  }
};

function createMockTable(data: any[]) {
  const visibleColumns = [
    { id: 'id', columnDef: { header: 'Object ID' } },
    { id: 'name', columnDef: { header: 'Object Name' } },
    { id: 'cleanCoreTier', columnDef: { header: 'Clean Core Tier' } },
  ];

  const rows = data.map((item) => ({
    original: item,
    getValue: (colId: string) => item[colId],
  }));

  return {
    getFilteredRowModel: () => ({ rows }),
    getSelectedRowModel: () => ({ rows: [] }),
    getVisibleLeafColumns: () => visibleColumns,
  } as any;
}

const sampleData = [
  { id: '1', name: 'Z_PROG_TEST1', cleanCoreTier: 'TIER_1_CLOUD' },
  { id: '2', name: 'Z_CLAS_TEST2', cleanCoreTier: 'TIER_2_DEVELOPER' },
  { id: '3', name: 'Z_TABL_TEST3', cleanCoreTier: 'TIER_3_CLASSIC' },
];

async function runTests() {
  console.log('=== EMPIRICAL TEST 2: triggerExport Fallback & Resilience ===\n');

  const table = createMockTable(sampleData);

  // --- Scenario 1: serverExportUrl is undefined ---
  console.log('--- Test 1.1: serverExportUrl is undefined (CSV) ---');
  createdBlobs = [];
  await triggerExport({
    table,
    format: 'csv',
    filename: 'export-test-undefined.csv',
    serverExportUrl: undefined,
  });
  if (createdBlobs.length !== 1) throw new Error('Expected 1 blob generated for undefined URL');
  const csvContent1 = createdBlobs[0].content.join('');
  console.log('Generated CSV content preview:\n', csvContent1);
  if (!csvContent1.includes('Object ID,Object Name,Clean Core Tier')) {
    throw new Error('CSV missing expected headers');
  }
  if (!csvContent1.includes('Z_PROG_TEST1') || !csvContent1.includes('TIER_3_CLASSIC')) {
    throw new Error('CSV missing expected rows');
  }
  console.log('✔ Test 1.1 PASSED (fallback to client-side CSV)');

  // --- Scenario 2: serverExportUrl is absent ---
  console.log('\n--- Test 1.2: serverExportUrl is absent (JSON) ---');
  createdBlobs = [];
  await triggerExport({
    table,
    format: 'json',
    filename: 'export-test-absent.json',
  });
  if (createdBlobs.length !== 1) throw new Error('Expected 1 blob generated for absent URL');
  const jsonContent2 = JSON.parse(createdBlobs[0].content.join(''));
  console.log(`Generated JSON contains ${jsonContent2.length} items`);
  if (jsonContent2.length !== 3 || jsonContent2[0].name !== 'Z_PROG_TEST1') {
    throw new Error('JSON serialization invalid');
  }
  console.log('✔ Test 1.2 PASSED (fallback to client-side JSON)');

  // --- Scenario 3: serverExportUrl fails with 404 Not Found ---
  console.log('\n--- Test 1.3: serverExportUrl fails with HTTP 404 ---');
  (global as any).fetch = async (url: string) => {
    console.log(`[Mock Fetch] Called ${url} -> returning HTTP 404`);
    return {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    };
  };

  createdBlobs = [];
  let threw404 = false;
  try {
    await triggerExport({
      table,
      format: 'csv',
      filename: 'export-test-404.csv',
      serverExportUrl: 'https://api.erppreflight.test/api/projects/p1/export',
    });
  } catch (e) {
    threw404 = true;
    console.error('Unexpected throw on 404:', e);
  }

  if (threw404) throw new Error('triggerExport threw error on 404 instead of falling back!');
  if (createdBlobs.length !== 1) throw new Error('Expected 1 blob generated on 404 fallback');
  const csvContent3 = createdBlobs[0].content.join('');
  if (!csvContent3.includes('Z_CLAS_TEST2')) {
    throw new Error('Fallback CSV content does not match expected client serialization');
  }
  console.log('✔ Test 1.3 PASSED (404 cleanly caught and fell back to client serialization without rejection)');

  // --- Scenario 4: serverExportUrl throws network error / reject ---
  console.log('\n--- Test 1.4: fetch throws TypeError (Network Error) ---');
  (global as any).fetch = async () => {
    console.log('[Mock Fetch] Simulating network drop / DNS failure');
    throw new TypeError('Failed to fetch');
  };

  createdBlobs = [];
  let threwNetwork = false;
  try {
    await triggerExport({
      table,
      format: 'json',
      filename: 'export-test-network-fail.json',
      serverExportUrl: 'https://api.erppreflight.test/api/projects/p1/export',
    });
  } catch (e) {
    threwNetwork = true;
  }

  if (threwNetwork) throw new Error('triggerExport threw error on network error instead of falling back!');
  if (createdBlobs.length !== 1) throw new Error('Expected 1 blob generated on network error fallback');
  console.log('✔ Test 1.4 PASSED (Network error cleanly caught and fell back to client serialization)');

  // --- Scenario 5: serverExportUrl returns 500 Internal Server Error ---
  console.log('\n--- Test 1.5: serverExportUrl returns HTTP 500 ---');
  (global as any).fetch = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
  });

  createdBlobs = [];
  await triggerExport({
    table,
    format: 'csv',
    serverExportUrl: 'https://api.erppreflight.test/api/projects/p1/export',
  });
  if (createdBlobs.length !== 1) throw new Error('Expected fallback blob on 500');
  console.log('✔ Test 1.5 PASSED (500 cleanly handled with fallback)');

  // --- Scenario 6: serverExportUrl returns 200 OK (server streaming path) ---
  console.log('\n--- Test 1.6: serverExportUrl returns 200 OK (server path) ---');
  let serverBlobServed = false;
  (global as any).fetch = async () => ({
    ok: true,
    status: 200,
    blob: async () => {
      serverBlobServed = true;
      return new (global as any).Blob(['server-streamed-content'], { type: 'text/csv' });
    },
  });

  createdBlobs = [];
  await triggerExport({
    table,
    format: 'csv',
    serverExportUrl: 'https://api.erppreflight.test/api/projects/p1/export',
  });
  if (!serverBlobServed) throw new Error('Expected server streaming blob to be served on 200 OK');
  console.log('✔ Test 1.6 PASSED (200 OK properly downloads server blob without client fallback)');

  console.log('\n=== ALL triggerExport RESILIENCE TESTS PASSED 100% ===');
}

runTests().catch((err) => {
  console.error('triggerExport test failed:', err);
  process.exit(1);
});
