const fs = require('fs');
const path = require('path');

const repoRoot = 'H:/erppreflight';
const skillsDir = path.join(repoRoot, '.agents', 'skills');

const checks = [
  {
    file: 'frontend-design-system.md',
    bans: ['react-hook-form', 'formik', 'antd', 'chakra-ui']
  },
  {
    file: 'data-table-and-large-list.md',
    bans: ['ag-grid', 'mui/x-data-grid', 'react-data-grid']
  },
  {
    file: 'dependency-graph.md',
    bans: ['cytoscape', 'vis.js', 'mxgraph']
  },
  {
    file: 'multi-tenant-security.md',
    bans: ['prisma', 'typeorm', 'kue']
  },
  {
    file: 'sap-evidence.md',
    bans: ['joi', 'yup', 'murmurhash']
  },
  {
    file: 'engine-authoring.md',
    bans: ['langchain', 'llamaindex', 'marshmallow']
  },
  {
    file: 'release-aware-knowledge.md',
    bans: ['prisma']
  },
  {
    file: 'secure-file-parser.md',
    bans: ['xml2js', 'adm-zip']
  }
];

console.log('=== Checking Forbidden Library Bans in Playbooks ===\n');
for (const c of checks) {
  const content = fs.readFileSync(path.join(skillsDir, c.file), 'utf-8').toLowerCase();
  console.log(`[${c.file}]:`);
  for (const b of c.bans) {
    const present = content.includes(b.toLowerCase());
    console.log(`  - Ban '${b}': ${present}`);
    if (!present) {
      console.error(`    MISSING BAN: ${b} in ${c.file}`);
    }
  }
}
