const fs = require('fs');
const path = require('path');

const SKILLS_DIR = 'H:/erppreflight/.agents/skills';
const AGENTS_MD_PATH = 'H:/erppreflight/AGENTS.md';
const ORIGINAL_REQUEST_PATH = 'H:/erppreflight/.agents/ORIGINAL_REQUEST.md';

const results = {
  playbooksOnDisk: [],
  routingTableChecks: {
    primaryPlaybooks: [],
    secondaryPlaybooks: [],
    allReferenced: [],
    missingReferenced: [],
    unreferencedPlaybooks: [],
    compositeRulesPlaybooks: [],
    missingCompositeReferenced: []
  },
  cardinalAxiomsChecks: {
    agentsMdHasAxiom1: false,
    agentsMdHasAxiom2: false,
    playbookAxiomReferences: {},
    axiom1CriteriaCoverage: {},
    axiom2PointsCoverage: {},
    localAxiomsFound: {}
  },
  noDependencySoupChecks: {
    agentsMdCategories: [],
    playbookMentions: {},
    packageJsonStatus: {}
  },
  tanstackCoverage: {
    tanstackQuery: {},
    tanstackTable: {},
    tanstackVirtual: {},
    tanstackForm: {},
    tanstackPacer: {}
  }
};

// 1. Check playbooks on disk
results.playbooksOnDisk = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));

// 2. Parse AGENTS.md routing table
const agentsMd = fs.readFileSync(AGENTS_MD_PATH, 'utf-8');

// Match table rows in Section 3
const routingTableRegex = /\|\s*\*\*([^*]+)\*\*\s*\|\s*`?([a-zA-Z0-9_\-\.]+)`?\s*\|\s*([^|]+)\|\s*([^|]+)\|/g;
let match;
const primarySet = new Set();
const secondarySet = new Set();
const allReferencedSet = new Set();

while ((match = routingTableRegex.exec(agentsMd)) !== null) {
  const role = match[1].trim();
  const primary = match[2].trim().replace(/`/g, '');
  const secondaries = match[3].split(',').map(s => s.trim().replace(/`/g, '')).filter(Boolean);
  
  primarySet.add(primary);
  allReferencedSet.add(primary);
  results.routingTableChecks.primaryPlaybooks.push({ role, primary });

  for (const sec of secondaries) {
    secondarySet.add(sec);
    allReferencedSet.add(sec);
    results.routingTableChecks.secondaryPlaybooks.push({ role, secondary: sec });
  }
}

// Check composite rules (Section 3.1)
const compositeRegex = /-\s*\*\*([^*]+)\*\*:\s*([^.\n]+)/g;
while ((match = compositeRegex.exec(agentsMd)) !== null) {
  const compName = match[1].trim();
  const compText = match[2].trim();
  const playbookRefs = compText.match(/[a-zA-Z0-9_\-]+\.md/g) || [];
  results.routingTableChecks.compositeRulesPlaybooks.push({ compName, playbookRefs, raw: compText });
  for (const ref of playbookRefs) {
    if (!results.playbooksOnDisk.includes(ref)) {
      results.routingTableChecks.missingCompositeReferenced.push({ compName, ref });
    }
  }
}

for (const ref of allReferencedSet) {
  results.routingTableChecks.allReferenced.push(ref);
  if (!results.playbooksOnDisk.includes(ref)) {
    results.routingTableChecks.missingReferenced.push(ref);
  }
}

for (const disk of results.playbooksOnDisk) {
  if (!allReferencedSet.has(disk)) {
    results.routingTableChecks.unreferencedPlaybooks.push(disk);
  }
}

// 3. Cardinal Axioms checks
results.cardinalAxiomsChecks.agentsMdHasAxiom1 = agentsMd.includes('Axiom 1:') && agentsMd.includes('A page that renders is not a completed feature');
results.cardinalAxiomsChecks.agentsMdHasAxiom2 = agentsMd.includes('Axiom 2:') && agentsMd.includes('An engine without deterministic logic/evidence/fixtures is not complete');

for (const pb of results.playbooksOnDisk) {
  const pbPath = path.join(SKILLS_DIR, pb);
  const pbContent = fs.readFileSync(pbPath, 'utf-8');

  // Check explicit mention of Cardinal Axioms or AGENTS.md
  results.cardinalAxiomsChecks.playbookAxiomReferences[pb] = {
    mentionsAxiom1: /cardinal axiom 1|axiom 1/i.test(pbContent),
    mentionsAxiom2: /cardinal axiom 2|axiom 2/i.test(pbContent),
    mentionsAgentsMd: /agents\.md/i.test(pbContent),
    mentionsTwoCardinalAxioms: /two cardinal axioms|cardinal axioms/i.test(pbContent)
  };

  // Find local axioms
  const localAxiomMatches = pbContent.match(/[A-Z][a-zA-Z0-9\s\-]+Axiom/g) || [];
  results.cardinalAxiomsChecks.localAxiomsFound[pb] = [...new Set(localAxiomMatches)];

  // TanStack coverage
  results.tanstackCoverage.tanstackQuery[pb] = /tanstack\/react-query|tanstack query|react-query/i.test(pbContent);
  results.tanstackCoverage.tanstackTable[pb] = /tanstack\/react-table|tanstack table|react-table/i.test(pbContent);
  results.tanstackCoverage.tanstackVirtual[pb] = /tanstack\/react-virtual|tanstack virtual|react-virtual/i.test(pbContent);
  results.tanstackCoverage.tanstackForm[pb] = /tanstack\/react-form|tanstack form|react-form/i.test(pbContent);
  results.tanstackCoverage.tanstackPacer[pb] = /pacer/i.test(pbContent);
}

// 4. Form State Integrity in Axiom 1
// Check if TanStack Form or Form State Integrity is described in any playbook
const formRegex = /tanstack\/react-form|tanstack form|react-form|form state integrity|dirty-state/i;
const playbooksWithForms = results.playbooksOnDisk.filter(pb => {
  const content = fs.readFileSync(path.join(SKILLS_DIR, pb), 'utf-8');
  return formRegex.test(content);
});
results.tanstackCoverage.playbooksCoveringForms = playbooksWithForms;

// Output result JSON
fs.writeFileSync('H:/erppreflight/.agents/challenger_m1_2/challenge_test_results.json', JSON.stringify(results, null, 2));
console.log('Results written to challenge_test_results.json');
