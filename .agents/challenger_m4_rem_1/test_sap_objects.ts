import { generateMockSapObjects, fetchProjectObjects } from '../../apps/web/src/components/objects/types';

async function run() {
  console.log('=== EMPIRICAL TEST 1: generateMockSapObjects(10000) ===');
  const count = 10000;
  const objects = generateMockSapObjects(count);

  console.log(`Generated objects count: ${objects.length}`);
  if (objects.length !== count) {
    throw new Error(`Expected ${count} objects, got ${objects.length}`);
  }

  let tier1Count = 0;
  let tier2Count = 0;
  let tier3Count = 0;
  let otherTierCount = 0;
  let totalBlockers = 0;
  let objectsWithBlockers = 0;
  let objectsWithDependencies = 0;
  let totalDependencies = 0;

  for (const obj of objects) {
    if (obj.cleanCoreTier === 'TIER_1_CLOUD') {
      tier1Count++;
    } else if (obj.cleanCoreTier === 'TIER_2_DEVELOPER') {
      tier2Count++;
    } else if (obj.cleanCoreTier === 'TIER_3_CLASSIC') {
      tier3Count++;
    } else {
      otherTierCount++;
    }

    if (obj.findingSummary && obj.findingSummary.blockerCount > 0) {
      objectsWithBlockers++;
      totalBlockers += obj.findingSummary.blockerCount;
    }

    if (obj.dependencies && obj.dependencies.length > 0) {
      objectsWithDependencies++;
      totalDependencies += obj.dependencies.length;
    }
  }

  console.log('Tier distribution:');
  console.log(`- TIER_1_CLOUD: ${tier1Count} (${((tier1Count / count) * 100).toFixed(2)}%)`);
  console.log(`- TIER_2_DEVELOPER: ${tier2Count} (${((tier2Count / count) * 100).toFixed(2)}%)`);
  console.log(`- TIER_3_CLASSIC: ${tier3Count} (${((tier3Count / count) * 100).toFixed(2)}%)`);
  console.log(`- Other Tiers: ${otherTierCount}`);

  console.log(`Objects with blockers: ${objectsWithBlockers}, Total blocker findings: ${totalBlockers}`);
  console.log(`Objects with dependencies: ${objectsWithDependencies}, Total dependencies: ${totalDependencies}`);

  if (tier1Count <= 0) throw new Error('Tier 1 objects count must be > 0');
  if (tier2Count <= 0) throw new Error('Tier 2 objects count must be > 0');
  if (tier3Count <= 0) throw new Error('Tier 3 objects count must be > 0');
  if (objectsWithBlockers <= 0) throw new Error('Blockers count must be > 0');
  if (objectsWithDependencies <= 0) throw new Error('Dependencies count must be > 0');

  console.log('✔ generateMockSapObjects(10000) PASSED ALL CHECKS');

  console.log('\n=== EMPIRICAL TEST 1B: fetchProjectObjects({ enableVirtualization: true }) ===');
  const resVirtual = await fetchProjectObjects({
    projectId: '1a91cf25-87a4-4a41-b0db-6e69001b9201',
    enableVirtualization: true,
  });

  console.log(`fetchProjectObjects({ enableVirtualization: true }) returned:`);
  console.log(`- items.length: ${resVirtual.items.length}`);
  console.log(`- totalCount: ${resVirtual.totalCount}`);
  console.log(`- pageSize: ${resVirtual.pageSize}`);
  console.log(`- totalPages: ${resVirtual.totalPages}`);
  console.log(`- page: ${resVirtual.page}`);

  if (resVirtual.items.length !== 10000) {
    throw new Error(`Expected resVirtual.items.length === 10000, got ${resVirtual.items.length}`);
  }
  if (resVirtual.totalCount !== 10000) {
    throw new Error(`Expected resVirtual.totalCount === 10000, got ${resVirtual.totalCount}`);
  }

  console.log('\n=== EMPIRICAL TEST 1C: fetchProjectObjects({ enableVirtualization: false }) ===');
  const resPaginated = await fetchProjectObjects({
    projectId: '1a91cf25-87a4-4a41-b0db-6e69001b9201',
    enableVirtualization: false,
    pageSize: 50,
    page: 1,
  });

  console.log(`fetchProjectObjects({ enableVirtualization: false, pageSize: 50 }) returned:`);
  console.log(`- items.length: ${resPaginated.items.length}`);
  console.log(`- totalCount: ${resPaginated.totalCount}`);
  console.log(`- pageSize: ${resPaginated.pageSize}`);
  console.log(`- totalPages: ${resPaginated.totalPages}`);

  if (resPaginated.items.length !== 50) {
    throw new Error(`Expected resPaginated.items.length === 50, got ${resPaginated.items.length}`);
  }

  console.log('✔ fetchProjectObjects virtualization & pagination behavior verified 100%!');
}

run().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
