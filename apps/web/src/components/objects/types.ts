import type {
  SapObject,
  SapObjectType,
  CleanCoreTier,
  ModificationStatus,
  ComplexityLevel,
  ObjectDependency,
  ObjectFindingSummary,
} from '@erppreflight/schemas';

export interface ObjectTierBadgeProps {
  tier: CleanCoreTier;
  className?: string;
  size?: 'sm' | 'default';
  showIcon?: boolean;
}

export interface ObjectTypeBadgeProps {
  type: SapObjectType;
  className?: string;
  size?: 'sm' | 'default';
  showIcon?: boolean;
}

export interface ObjectDetailDrawerProps {
  object: SapObject | null;
  onClose: () => void;
}

export interface FetchObjectsParams {
  projectId: string;
  search?: string;
  filters?: Record<string, string[]>;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  enableVirtualization?: boolean;
  fetchAll?: boolean;
}

export interface FetchObjectsResult {
  items: SapObject[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const TYPES: SapObjectType[] = ['PROG', 'CLAS', 'TABL', 'CDS', 'FUGR', 'INTF', 'FORM', 'TRAN'];
const PACKAGES = ['Z_SALES_ORDER', 'Z_FIN_ACDOCA', 'Z_MM_PURCHASING', 'Z_CLEAN_CORE', '$TMP'];
const TIERS: CleanCoreTier[] = ['TIER_1_CLOUD', 'TIER_2_DEVELOPER', 'TIER_3_CLASSIC'];

/**
 * Deterministic PRNG seeded generator for 10,000+ realistic SAP Objects.
 */
export function generateMockSapObjects(count = 10000, projectId = '1a91cf25-87a4-4a41-b0db-6e69001b9201'): SapObject[] {
  const result: SapObject[] = [];

  for (let i = 1; i <= count; i++) {
    const type = TYPES[i % TYPES.length];
    const pkg = PACKAGES[i % PACKAGES.length];
    const tier = i % 5 === 0 ? 'TIER_3_CLASSIC' : i % 3 === 0 ? 'TIER_2_DEVELOPER' : 'TIER_1_CLOUD';
    const isModified = i % 47 === 0;
    const hasFindings = i % 7 === 0;
    const blockerCount = hasFindings && tier === 'TIER_3_CLASSIC' ? (i % 3) + 1 : 0;
    const totalFindings = hasFindings ? blockerCount + (i % 4) + 1 : 0;

    result.push({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      projectId,
      name: `Z${type}_${pkg.replace('Z_', '')}_${String(i).padStart(4, '0')}`,
      objectType: type,
      description: `Custom ${type} handling ${pkg.toLowerCase().replace('_', ' ')} enterprise logic`,
      package: pkg,
      softwareComponent: 'ZCUSTOM',
      cleanCoreTier: tier,
      modificationStatus: isModified ? 'SAP_MODIFIED' : 'CUSTOM_Z',
      complexity: {
        score: (i * 17) % 100,
        level: (i * 17) % 100 > 75 ? 'VERY_HIGH' : (i * 17) % 100 > 50 ? 'HIGH' : 'LOW',
        linesOfCode: ((i * 137) % 4500) + 50,
        statementsCount: ((i * 47) % 1200) + 10,
        cyclomaticComplexity: (i % 35) + 1,
      },
      findingSummary: {
        totalCount: totalFindings,
        blockerCount,
        criticalCount: hasFindings && blockerCount === 0 ? 1 : 0,
        majorCount: hasFindings ? 1 : 0,
        minorCount: 0,
        infoCount: 0,
        highestSeverity: blockerCount > 0 ? 'BLOCKER' : hasFindings ? 'CRITICAL' : null,
        findings: hasFindings
          ? [
              {
                id: `f0000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
                ruleId:
                  tier === 'TIER_3_CLASSIC'
                    ? 'CLEAN_CORE_TIER3_DIRECT_DB_MUTATION'
                    : 'CLEAN_CORE_UNRELEASED_API',
                severity: blockerCount > 0 ? 'BLOCKER' : 'CRITICAL',
                title: `Clean Core violation detected in object Z${type}_${String(i).padStart(4, '0')}`,
                remediation:
                  'Refactor direct table mutation to released SAP Cloud BAPI / RAP BO `I_JournalEntryTP`.',
              },
            ]
          : [],
      },
      lastChangedAt: new Date(Date.now() - (i % 180) * 86400000).toISOString(),
      lastChangedBy: `DEVELOPER_${(i % 12) + 1}`,
      transportRequest: `DEVK90${String(1000 + (i % 200)).padStart(4, '0')}`,
      dependencies:
        tier === 'TIER_3_CLASSIC'
          ? [
              {
                targetName: 'ACDOCA',
                targetType: 'TABL',
                direction: 'OUTBOUND',
                dependencyType: 'DIRECT_SQL',
                releaseContract: 'NOT_RELEASED',
                cleanCoreTier: 'TIER_3_CLASSIC',
                isCleanCoreHazard: true,
                recommendedSuccessor: 'I_JournalEntryItem',
              },
            ]
          : [],
    });
  }

  return result;
}

// In-memory cached dataset to prevent re-generating 10,000 items on every render
let cachedMockObjects: SapObject[] | null = null;

export async function fetchProjectObjects({
  projectId,
  search,
  filters,
  page = 1,
  pageSize = 50,
  sortField,
  sortOrder,
  enableVirtualization = false,
  fetchAll = false,
}: FetchObjectsParams): Promise<FetchObjectsResult> {
  if (!cachedMockObjects) {
    cachedMockObjects = generateMockSapObjects(10000, projectId);
  }

  let all = cachedMockObjects;

  if (search) {
    const q = search.toLowerCase();
    all = all.filter(
      (o) => o.name.toLowerCase().includes(q) || o.description.toLowerCase().includes(q)
    );
  }

  if (filters?.objectType?.length) {
    all = all.filter((o) => filters.objectType.includes(o.objectType));
  }

  if (filters?.cleanCoreTier?.length) {
    all = all.filter((o) => filters.cleanCoreTier.includes(o.cleanCoreTier));
  }

  if (filters?.package?.length) {
    all = all.filter((o) => filters.package.includes(o.package));
  }

  if (sortField) {
    all = [...all].sort((a: any, b: any) => {
      const valA = a[sortField] ?? a.findingSummary?.[sortField] ?? a.complexity?.[sortField] ?? 0;
      const valB = b[sortField] ?? b.findingSummary?.[sortField] ?? b.complexity?.[sortField] ?? 0;
      if (valA < valB) return sortOrder === 'desc' ? 1 : -1;
      if (valA > valB) return sortOrder === 'desc' ? -1 : 1;
      return 0;
    });
  }

  const shouldReturnAll = enableVirtualization || fetchAll;
  const start = (page - 1) * pageSize;
  const items = shouldReturnAll ? all : all.slice(start, start + pageSize);

  return {
    items,
    totalCount: all.length,
    page: shouldReturnAll ? 1 : page,
    pageSize: shouldReturnAll ? all.length : pageSize,
    totalPages: shouldReturnAll ? 1 : Math.ceil(all.length / pageSize),
  };
}
