function brokenFormula(sourceScores) {
  if (sourceScores.length === 0) return 0.30;
  const maxScore = Math.max(...sourceScores);
  let compoundProduct = 1.0;
  for (const score of sourceScores) {
    compoundProduct *= (1.0 - 0.20 * score);
  }
  const composite = maxScore * (1.0 - compoundProduct);
  return Math.min(maxScore, Math.max(0.10, Math.round(composite * 100) / 100));
}

function fixedFormula(sourceScores) {
  if (!sourceScores || sourceScores.length === 0) return 0.30;
  const maxScore = Math.max(...sourceScores);
  if (sourceScores.length === 1) return maxScore;

  let compoundProduct = 1.0;
  for (const score of sourceScores) {
    compoundProduct *= (1.0 - 0.20 * score);
  }

  // Synergy factor represents corroboration from multiple sources
  const synergy = 1.0 - compoundProduct;
  // Composite score starts at maxScore and scales upward into remaining headroom (1.0 - maxScore)
  const composite = maxScore + (1.0 - maxScore) * synergy;
  return Math.min(1.0, Math.max(maxScore, Math.round(composite * 100) / 100));
}

const testCases = [
  { name: 'Empty array', input: [] },
  { name: 'Single Official Metadata (1.0)', input: [1.0] },
  { name: 'Single Curated Rule (0.85)', input: [0.85] },
  { name: 'Single Customer Evidence (0.50)', input: [0.50] },
  { name: 'Customer (0.50) + Rule (0.85)', input: [0.50, 0.85] },
  { name: 'Rule (0.85) + Official Note (0.90)', input: [0.85, 0.90] },
  { name: 'Customer (0.50) + Rule (0.85) + SAP Note (0.90)', input: [0.50, 0.85, 0.90] },
  { name: 'Official Metadata (1.0) + Customer (0.50)', input: [1.0, 0.50] },
  { name: 'Multiple identical 0.85 sources', input: [0.85, 0.85, 0.85] },
];

console.log('--- TRUST SCORE COMPARISON ---');
for (const tc of testCases) {
  const broken = brokenFormula(tc.input);
  const fixed = fixedFormula(tc.input);
  console.log(`Test: ${tc.name}`);
  console.log(`  Input: [${tc.input.join(', ')}]`);
  console.log(`  Broken result: ${broken}`);
  console.log(`  Fixed result:  ${fixed}`);
  console.log(`  Valid synergy? ${fixed >= (tc.input.length > 0 ? Math.max(...tc.input) : 0.30)}`);
}
