const fs = require('fs');
const path = require('path');

const repoRoot = 'H:/erppreflight';
const skillsDir = path.join(repoRoot, '.agents', 'skills');

const playbooks = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
console.log('Playbooks found:', playbooks);

// Files to check: AGENTS.md + all playbooks
const filesToCheck = [
  path.join(repoRoot, 'AGENTS.md'),
  ...playbooks.map(p => path.join(skillsDir, p))
];

const results = [];

for (const file of filesToCheck) {
  const content = fs.readFileSync(file, 'utf-8');
  // Match any markdown file reference like foo-bar.md or path/to/file.md
  const matches = [...content.matchAll(/([a-zA-Z0-9_\-\.\/]+\.md)\b/g)].map(m => m[1]);
  const uniqueRefs = [...new Set(matches)];

  for (const ref of uniqueRefs) {
    // Ignore self-references, URLs, or generic anchors like PROGRESS.md if template
    if (ref.startsWith('http://') || ref.startsWith('https://')) continue;
    
    // Resolve candidates:
    // 1. In skillsDir
    // 2. Relative to file dir
    // 3. Relative to repoRoot
    // 4. Absolute path
    let exists = false;
    let resolved = '';

    const candidates = [
      path.resolve(path.dirname(file), ref),
      path.resolve(skillsDir, path.basename(ref)),
      path.resolve(repoRoot, ref),
      ref.startsWith('H:/') || ref.startsWith('/') ? ref : null
    ].filter(Boolean);

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        exists = true;
        resolved = cand;
        break;
      }
    }

    results.push({
      source: path.relative(repoRoot, file),
      reference: ref,
      exists,
      resolved
    });
  }
}

const missing = results.filter(r => !r.exists);
console.log('\n--- Missing References Check ---');
if (missing.length === 0) {
  console.log('SUCCESS: Zero missing .md references found!');
} else {
  console.log(`FOUND ${missing.length} missing references:`);
  for (const m of missing) {
    console.log(`  Source: ${m.source} -> Reference: ${m.reference}`);
  }
}
