const fs = require('fs');
const path = require('path');

const repoRoot = 'H:/erppreflight';
const skillsDir = path.join(repoRoot, '.agents', 'skills');
const playbooks = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));

console.log('=== Checking Cardinal Axiom Anchoring in Playbooks ===\n');

for (const pb of playbooks) {
  const content = fs.readFileSync(path.join(skillsDir, pb), 'utf-8');
  const hasAxiom1 = /cardinal axiom 1/i.test(content);
  const hasAxiom2 = /cardinal axiom 2/i.test(content);
  const hasAgentsMd = /agents\.md/i.test(content);

  console.log(`[${pb}]:`);
  console.log(`  - Cardinal Axiom 1: ${hasAxiom1}`);
  console.log(`  - Cardinal Axiom 2: ${hasAxiom2}`);
  console.log(`  - AGENTS.md reference: ${hasAgentsMd}`);
}
