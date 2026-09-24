/**
 * Independent Forensic Test: 10,000 Object Virtualization Pipeline & Distribution
 * Author: auditor_m4_rem_2
 */

import { generateMockSapObjects, fetchProjectObjects } from '../../apps/web/src/components/objects/types';

console.log('=== FORENSIC TEST: 10,000 SAP Object Virtualization & Clean Core Distribution ===\n');

// 1. Generate full dataset
const totalCount = 10000;
const objects = generateMockSapObjects(totalCount);

console.log(`Generated count: ${objects.length}`);
if (objects.length !== 10000) {
  throw new Error(`Expected exactly 10,000 objects, got ${objects.length}`);
}

// 2. Empirical distribution verification
const tierCounts: Record<string, number> = {};
const typeCounts: Record<string, number> = {};
let blockerObjectsCount = 0;
let totalBlockerFindings = 0;
let dependenciesCount = 0;
let directSqlCount = 0;
let modifiedCount = 0;

for (const obj of objects) {
  tierCounts[obj.cleanCoreTier] = (tierCounts[obj.cleanCoreTier] || 0) + 1;
  typeCounts[obj.objectType] = (typeCounts[obj.objectType] || 0) + 1;

  if (obj.findingSummary.blockerCount > 0) {
    blockerObjectsCount++;
    totalBlockerFindings += obj.findingSummary.blockerCount;
  }

  if (obj.dependencies && obj.dependencies.length > 0) {
    dependenciesCount += obj.dependencies.length;
    for (const dep of obj.dependencies) {
      if (dep.dependencyType === 'DIRECT_SQL') {
        directSqlCount++;
      }
    }
  }

  if (obj.modificationStatus === 'SAP_MODIFIED') {
    modifiedCount++;
  }
}

console.log('Tier distribution:');
Object.entries(tierCounts).forEach(([tier, count]) => {
  const pct = ((count / totalCount) * 100).toFixed(2);
  console.log(`  - ${tier}: ${count} (${pct}%)`);
});

console.log('\nObject Type distribution:');
Object.entries(typeCounts).forEach(([type, count]) => {
  console.log(`  - ${type}: ${count}`);
});

console.log(`\nBlocker metrics:`);
console.log(`  - Objects with blockers: ${blockerObjectsCount}`);
console.log(`  - Total blocker findings: ${totalBlockerFindings}`);
console.log(`\nDependency metrics:`);
console.log(`  - Total outbound dependencies: ${dependenciesCount}`);
console.log(`  - Direct SQL dependencies to ACDOCA: ${directSqlCount}`);
console.log(`\nModifications:`);
console.log(`  - SAP Modified: ${modifiedCount}`);

// Assertions on tier distribution
if (tierCounts['TIER_1_CLOUD'] !== 5333) {
  throw new Error(`Expected TIER_1_CLOUD to be 5,333, got ${tierCounts['TIER_1_CLOUD']}`);
}
if (tierCounts['TIER_2_DEVELOPER'] !== 2667) {
  throw new Error(`Expected TIER_2_DEVELOPER to be 2,667, got ${tierCounts['TIER_2_DEVELOPER']}`);
}
if (tierCounts['TIER_3_CLASSIC'] !== 2000) {
  throw new Error(`Expected TIER_3_CLASSIC to be 2,000, got ${tierCounts['TIER_3_CLASSIC']}`);
}
if (blockerObjectsCount !== 285) {
  throw new Error(`Expected blockerObjectsCount to be 285, got ${blockerObjectsCount}`);
}
if (dependenciesCount !== 2000) {
  throw new Error(`Expected dependenciesCount to be 2000, got ${dependenciesCount}`);
}
console.log('\n✔ All tier and blocker counts match mathematically expected distribution');

// 3. Test fetchProjectObjects API behavior with enableVirtualization
console.log('\n=== Testing fetchProjectObjects with enableVirtualization ===');

async function testFetch() {
  const virtResult = await fetchProjectObjects({
    projectId: 'test-p1',
    enableVirtualization: true,
  });

  console.log(`Virtualization result items: ${virtResult.items.length}, total: ${virtResult.totalCount}`);
  if (virtResult.items.length !== 10000) {
    throw new Error(`Expected items.length to be 10000 with enableVirtualization: true, got ${virtResult.items.length}`);
  }
  if (virtResult.pageSize !== 10000) {
    throw new Error(`Expected pageSize to be 10000, got ${virtResult.pageSize}`);
  }
  if (virtResult.totalPages !== 1) {
    throw new Error(`Expected totalPages to be 1, got ${virtResult.totalPages}`);
  }

  // Non-virtualized (paginated) call
  const paginatedResult = await fetchProjectObjects({
    projectId: 'test-p1',
    enableVirtualization: false,
    page: 2,
    pageSize: 50,
  });

  console.log(`Paginated result items: ${paginatedResult.items.length}, total: ${paginatedResult.totalCount}`);
  if (paginatedResult.items.length !== 50) {
    throw new Error(`Expected items.length to be 50 with enableVirtualization: false, got ${paginatedResult.items.length}`);
  }
  if (paginatedResult.page !== 2 || paginatedResult.totalPages !== 200) {
    throw new Error(`Expected page 2 and totalPages 200, got page ${paginatedResult.page}, totalPages ${paginatedResult.totalPages}`);
  }

  // Filtered virtualized call
  const filteredVirt = await fetchProjectObjects({
    projectId: 'test-p1',
    enableVirtualization: true,
    filters: { cleanCoreTier: ['TIER_3_CLASSIC'] },
  });

  console.log(`Filtered virtualization (TIER_3_CLASSIC) items: ${filteredVirt.items.length}, total: ${filteredVirt.totalCount}`);
  if (filteredVirt.items.length !== 2000) {
    throw new Error(`Expected exactly 2000 TIER_3_CLASSIC items, got ${filteredVirt.items.length}`);
  }

  console.log('\n✔ fetchProjectObjects virtualization pipeline verified 100%');
}

testFetch().catch((err) => {
  console.error(err);
  process.exit(1);
});
