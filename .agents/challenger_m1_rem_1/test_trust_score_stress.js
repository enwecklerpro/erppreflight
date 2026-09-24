const assert = require('assert');

// 1. Implementation in sap-evidence.md
function calculateCompositeTrustScorePlaybook(sourceScores) {
  if (!sourceScores || sourceScores.length === 0) return 0.30;

  const maxScore = Math.max(...sourceScores);
  // Invariant: Never slash or discount a single verified source
  if (sourceScores.length === 1) return maxScore;

  let compoundProduct = 1.0;
  for (const score of sourceScores) {
    compoundProduct *= (1.0 - 0.20 * score);
  }

  // Multi-source synergy: Corroboration elevates score into remaining headroom
  const synergy = 1.0 - compoundProduct;
  const composite = maxScore + (1.0 - maxScore) * synergy;

  return Math.min(1.0, Math.max(maxScore, Math.round(composite * 100) / 100));
}

// 2. Implementation in packages/evidence/src/trust-score.ts
const { calculateCompositeTrustScore: calculateCompositeTrustScoreCode } = require('H:/erppreflight/packages/evidence/src/trust-score.ts');

console.log('=== TEST 1: Single-source preservation in Playbook formula ===');
const singleSources = [1.0, 0.95, 0.90, 0.85, 0.70, 0.60, 0.50, 0.30, 0.10, 0.0];
for (const s of singleSources) {
  const result = calculateCompositeTrustScorePlaybook([s]);
  console.log(`Single source [${s}] -> result: ${result}`);
  assert.strictEqual(result, s, `Failed for single source [${s}]: expected ${s}, got ${result}`);
}

console.log('\n=== TEST 2: Single-source preservation in Codebase formula ===');
for (const s of singleSources) {
  const result = calculateCompositeTrustScoreCode([s]);
  console.log(`Single source [${s}] -> result: ${result}`);
  assert.strictEqual(result, s, `Failed for codebase single source [${s}]: expected ${s}, got ${result}`);
}

console.log('\n=== TEST 3: Monotonicity Property (Score >= maxScore and <= 1.0) ===');
const testCases = [
  [1.0, 1.0],
  [1.0, 0.5],
  [0.5, 1.0],
  [0.85, 0.50],
  [0.50, 0.85, 0.90],
  [0.30, 0.30, 0.30],
  [0.70, 0.70],
  [0.95, 0.95],
  Array(20).fill(0.5),
  Array(50).fill(0.9)
];

for (const tc of testCases) {
  const maxScore = Math.max(...tc);
  const pbRes = calculateCompositeTrustScorePlaybook(tc);
  const codeRes = calculateCompositeTrustScoreCode(tc);

  console.log(`Input: [${tc.slice(0, 3).join(', ')}${tc.length > 3 ? '...' : ''}] (len: ${tc.length}, max: ${maxScore})`);
  console.log(`   Playbook result: ${pbRes} (>= max: ${pbRes >= maxScore}, <= 1.0: ${pbRes <= 1.0})`);
  console.log(`   Codebase result: ${codeRes} (>= max: ${codeRes >= maxScore}, <= 1.0: ${codeRes <= 1.0})`);

  assert(pbRes >= maxScore, `Playbook violated monotonicity: ${pbRes} < ${maxScore}`);
  assert(pbRes <= 1.0, `Playbook exceeded 1.0: ${pbRes}`);
  assert(codeRes >= maxScore, `Codebase violated monotonicity: ${codeRes} < ${maxScore}`);
  assert(codeRes <= 1.0, `Codebase exceeded 1.0: ${codeRes}`);
}

console.log('\n=== TEST 4: Boundary & Edge Cases ===');
console.log('Empty array playbook:', calculateCompositeTrustScorePlaybook([]));
assert.strictEqual(calculateCompositeTrustScorePlaybook([]), 0.30);
console.log('Null playbook:', calculateCompositeTrustScorePlaybook(null));
assert.strictEqual(calculateCompositeTrustScorePlaybook(null), 0.30);
console.log('Empty array codebase:', calculateCompositeTrustScoreCode([]));
assert.strictEqual(calculateCompositeTrustScoreCode([]), 0.0);

console.log('\nALL TRUST SCORE TESTS PASSED SUCCESSFULLY!');
