const assert = require('assert');
const fs = require('fs');

// Verify snippet in multi-tenant-security.md
const playbookContent = fs.readFileSync('H:/erppreflight/.agents/skills/multi-tenant-security.md', 'utf-8');

// Ensure no parameterized SET remains
assert.strictEqual(
  /SET\s+(\$\{.*?\})?\s*app\.current_tenant_id\s*=\s*\$1/i.test(playbookContent),
  false,
  'Found invalid parameterized SET query in multi-tenant-security.md!'
);

// Ensure SELECT set_config is present
assert(
  playbookContent.includes("SELECT set_config('app.current_tenant_id', $1, $2)"),
  'multi-tenant-security.md missing SELECT set_config parameterized query'
);

assert(
  playbookContent.includes("SELECT set_config('app.current_tenant_id', '', $1)"),
  'multi-tenant-security.md missing SELECT set_config reset query'
);

// Verify packages/database/src/rls.ts
const rlsContent = fs.readFileSync('H:/erppreflight/packages/database/src/rls.ts', 'utf-8');
assert(
  rlsContent.includes("SELECT set_config('app.current_tenant_id', $1, $2)"),
  'packages/database/src/rls.ts missing SELECT set_config query'
);

console.log('PASS: multi-tenant-security.md and packages/database/src/rls.ts use valid SELECT set_config SQL syntax with parameters ($1, $2)!');
