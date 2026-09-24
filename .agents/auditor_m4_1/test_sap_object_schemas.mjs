import {
  SapObjectTypeEnum,
  ModificationStatusEnum,
  ComplexityLevelEnum,
  ComplexityMetricsSchema,
  ObjectDependencySchema,
  ObjectFindingSummarySchema,
  SapObjectSchema,
  SapObjectListResponseSchema,
} from '../../packages/schemas/dist/index.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${message}`);
  }
}

function expectThrows(fn, message) {
  try {
    fn();
    failed++;
    console.error(`FAIL (expected throw): ${message}`);
  } catch (err) {
    passed++;
  }
}

console.log('Testing SapObjectTypeEnum...');
assert(SapObjectTypeEnum.safeParse('PROG').success, 'PROG is valid');
assert(SapObjectTypeEnum.safeParse('CDS').success, 'CDS is valid');
assert(SapObjectTypeEnum.safeParse('WSDL').success, 'WSDL is valid');
expectThrows(() => SapObjectTypeEnum.parse('UNKNOWN_TYPE'), 'Reject UNKNOWN_TYPE');
expectThrows(() => SapObjectTypeEnum.parse(123), 'Reject number for enum');

console.log('Testing ModificationStatusEnum...');
assert(ModificationStatusEnum.safeParse('CUSTOM_Z').success, 'CUSTOM_Z is valid');
assert(ModificationStatusEnum.safeParse('SAP_MODIFIED').success, 'SAP_MODIFIED is valid');
expectThrows(() => ModificationStatusEnum.parse('HACKED'), 'Reject invalid status');

console.log('Testing ComplexityMetricsSchema...');
assert(
  ComplexityMetricsSchema.safeParse({
    score: 85,
    level: 'HIGH',
    linesOfCode: 1500,
    statementsCount: 420,
    cyclomaticComplexity: 24,
  }).success,
  'Valid complexity metrics'
);
expectThrows(
  () =>
    ComplexityMetricsSchema.parse({
      score: 150, // exceeds max 100
      level: 'HIGH',
      linesOfCode: 1500,
      statementsCount: 420,
      cyclomaticComplexity: 24,
    }),
  'Reject score > 100'
);
expectThrows(
  () =>
    ComplexityMetricsSchema.parse({
      score: -10, // below min 0
      level: 'HIGH',
      linesOfCode: 1500,
      statementsCount: 420,
      cyclomaticComplexity: 24,
    }),
  'Reject score < 0'
);
expectThrows(
  () =>
    ComplexityMetricsSchema.parse({
      score: 50,
      level: 'HIGH',
      linesOfCode: -10, // negative integer
      statementsCount: 420,
      cyclomaticComplexity: 24,
    }),
  'Reject negative linesOfCode'
);
expectThrows(
  () =>
    ComplexityMetricsSchema.parse({
      score: 50,
      level: 'HIGH',
      linesOfCode: 10.5, // float integer
      statementsCount: 420,
      cyclomaticComplexity: 24,
    }),
  'Reject non-integer linesOfCode'
);

console.log('Testing ObjectDependencySchema...');
assert(
  ObjectDependencySchema.safeParse({
    targetName: 'ACDOCA',
    targetType: 'TABL',
    direction: 'OUTBOUND',
    dependencyType: 'DIRECT_SQL',
    releaseContract: 'NOT_RELEASED',
    cleanCoreTier: 'TIER_3_CLASSIC',
    isCleanCoreHazard: true,
    recommendedSuccessor: 'I_JournalEntryItem',
  }).success,
  'Valid dependency schema'
);
expectThrows(
  () =>
    ObjectDependencySchema.parse({
      targetName: 'ACDOCA',
      targetType: 'TABL',
      direction: 'LATERAL', // invalid direction
      dependencyType: 'DIRECT_SQL',
      releaseContract: 'NOT_RELEASED',
      cleanCoreTier: 'TIER_3_CLASSIC',
      isCleanCoreHazard: true,
    }),
  'Reject invalid direction'
);

console.log('Testing SapObjectSchema...');
const validObject = {
  id: '1a91cf25-87a4-4a41-b0db-6e69001b9201',
  projectId: '2b91cf25-87a4-4a41-b0db-6e69001b9202',
  name: 'ZCL_FIN_POSTING',
  objectType: 'CLAS',
  description: 'Financial journal posting orchestrator',
  package: 'Z_FIN',
  softwareComponent: 'ZCUSTOM',
  cleanCoreTier: 'TIER_2_DEVELOPER',
  modificationStatus: 'CUSTOM_Z',
  complexity: {
    score: 65,
    level: 'MEDIUM',
    linesOfCode: 980,
    statementsCount: 310,
    cyclomaticComplexity: 14,
  },
  findingSummary: {
    totalCount: 1,
    blockerCount: 0,
    criticalCount: 1,
    majorCount: 0,
    minorCount: 0,
    infoCount: 0,
    highestSeverity: 'CRITICAL',
    findings: [
      {
        id: '3c91cf25-87a4-4a41-b0db-6e69001b9203',
        ruleId: 'CLEAN_CORE_UNRELEASED_API',
        severity: 'CRITICAL',
        title: 'Unreleased BAPI invocation',
        remediation: 'Migrate to RAP BO I_JournalEntryTP',
      },
    ],
  },
  lastChangedAt: new Date().toISOString(),
  lastChangedBy: 'SAP_CONSULTANT_1',
  transportRequest: 'DEVK901234',
  dependencies: [],
};

assert(SapObjectSchema.safeParse(validObject).success, 'Valid SapObject passes');

expectThrows(
  () =>
    SapObjectSchema.parse({
      ...validObject,
      id: 'not-a-uuid', // non-uuid
    }),
  'Reject non-uuid ID'
);

expectThrows(
  () =>
    SapObjectSchema.parse({
      ...validObject,
      name: '', // empty name
    }),
  'Reject empty object name'
);

console.log('Testing SapObjectListResponseSchema...');
assert(
  SapObjectListResponseSchema.safeParse({
    items: [validObject],
    totalCount: 1,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    facets: {
      typeCounts: { CLAS: 1 },
      tierCounts: { TIER_2_DEVELOPER: 1 },
      packageCounts: { Z_FIN: 1 },
      findingsStatusCounts: { withFindings: 1, clean: 0 },
    },
  }).success,
  'Valid SapObjectListResponse passes'
);

console.log(`\nSummary: ${passed} assertions passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
