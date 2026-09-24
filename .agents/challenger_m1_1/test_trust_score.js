function calculateCompositeTrustScore(sourceScores) {
  if (sourceScores.length === 0) return 0.30;

  const maxScore = Math.max(...sourceScores);
  let compoundProduct = 1.0;

  for (const score of sourceScores) {
    compoundProduct *= (1.0 - 0.20 * score);
  }

  const composite = maxScore * (1.0 - compoundProduct);
  return Math.min(maxScore, Math.max(0.10, Math.round(composite * 100) / 100));
}

console.log("Single source 1.0:", calculateCompositeTrustScore([1.0]));
console.log("Single source 0.85:", calculateCompositeTrustScore([0.85]));
console.log("Single source 0.50:", calculateCompositeTrustScore([0.50]));
console.log("Three sources [0.50, 0.85, 0.90]:", calculateCompositeTrustScore([0.50, 0.85, 0.90]));
console.log("Ten perfect sources (1.0 x 10):", calculateCompositeTrustScore(Array(10).fill(1.0)));
