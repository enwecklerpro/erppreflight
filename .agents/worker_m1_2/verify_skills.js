const fs = require('fs');

function testFile(name, checks) {
  const content = fs.readFileSync('H:/erppreflight/.agents/skills/' + name, 'utf-8');
  console.log(`=== Testing ${name} ===`);
  for (const [desc, fn] of Object.entries(checks)) {
    const passed = fn(content);
    console.log(`  ${passed ? 'PASS' : 'FAIL'}: ${desc}`);
  }
}

testFile('frontend-design-system.md', {
  'Has Axiom 1': c => /Cardinal Axiom 1/i.test(c),
  'Has TanStack Form': c => /@tanstack\/react-form/i.test(c),
  'Has FormField': c => /export function FormField/i.test(c),
  'Has useUnsavedChangesGuard': c => /export function useUnsavedChangesGuard/i.test(c),
  'Has SapConnectorConfigForm': c => /export function SapConnectorConfigForm/i.test(c),
  'Has react-hook-form ban': c => /react-hook-form/i.test(c),
});

testFile('data-table-and-large-list.md', {
  'Has Axiom 1': c => /Cardinal Axiom 1/i.test(c),
  'Has compound tbody': c => /<tbody[\s\S]*?ref={rowVirtualizer\.measureElement}/.test(c),
  'Has ag-grid ban': c => /ag-grid/i.test(c),
  'Has mui/x-data-grid ban': c => /mui\/x-data-grid/i.test(c),
});

testFile('dependency-graph.md', {
  'Has Axiom 1': c => /Cardinal Axiom 1/i.test(c),
  'Has requestId in worker': c => c.includes('requestId: string'),
  'Has cytoscape ban': c => /cytoscape/i.test(c),
  'Has vis.js ban': c => /vis\.js/i.test(c),
  'Has O(|E|) degreeMap': c => c.includes('degreeMap'),
});

testFile('multi-tenant-security.md', {
  'Has Axiom 1 and 2': c => /Cardinal Axiom 1/i.test(c) && /Cardinal Axiom 2/i.test(c),
  'Has SELECT set_config': c => c.includes("SELECT set_config('app.current_tenant_id'"),
  'No invalid SET param': c => !c.includes('SET app.current_tenant_id ='),
  'Has prisma ban': c => /prisma/i.test(c),
  'Has kue/bee-queue ban': c => /kue/i.test(c) && /bee-queue/i.test(c),
});


testFile('sap-evidence.md', {
  'Has Axiom 2': c => /Cardinal Axiom 2/i.test(c),
  'Has single-source guard': c => c.includes('if (sourceScores.length === 1) return maxScore;'),
  'Has synergy formula': c => c.includes('const synergy = 1.0 - compoundProduct;'),
  'Has joi/yup ban': c => /joi/i.test(c) && /yup/i.test(c),
  'Has murmurhash ban': c => /murmurhash/i.test(c),
});

testFile('engine-authoring.md', {
  'Has Axiom 2': c => /Cardinal Axiom 2/i.test(c),
  'Has LineNumberTreeBuilder': c => c.includes('class LineNumberTreeBuilder'),
  'Has LineElement': c => c.includes('class LineElement'),
  'Has langchain/llamaindex ban': c => /langchain/i.test(c) && /llamaindex/i.test(c),
  'Has marshmallow ban': c => /marshmallow/i.test(c),
});

testFile('release-aware-knowledge.md', {
  'Has Axiom 2': c => /Cardinal Axiom 2/i.test(c),
  'Has prisma ban': c => /prisma/i.test(c),
  'Has mutable in-place update ban': c => /mutable in-place update/i.test(c),
  'Has dynamic code execution ban': c => /eval\(\)/i.test(c),
});

testFile('secure-file-parser.md', {
  'Has Axiom 2': c => /Cardinal Axiom 2/i.test(c),
  'Has unzipper/adm-zip ban': c => /unzipper/i.test(c) && /adm-zip/i.test(c),
  'Has xml2js ban': c => /xml2js/i.test(c),
  'Has external scrubbing services ban': c => /external scrubbing services/i.test(c),
});



