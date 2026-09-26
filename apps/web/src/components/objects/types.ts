import type {
  SapObject,
  SapObjectType,
  CleanCoreTier,
  ModificationStatus,
  ComplexityLevel,
  ObjectDependency,
  ObjectFindingSummary,
} from '@erppreflight/schemas';
import { fetchProjectObjectsApi } from '@/lib/api-client';

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

/**
 * Fetch project objects backed by real PostgreSQL 16 persistence via NestJS Core API.
 */
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
  const objectType = filters?.objectType?.length ? filters.objectType.join(',') : undefined;
  const cleanCoreTier = filters?.cleanCoreTier?.length ? filters.cleanCoreTier.join(',') : undefined;
  const pkg = filters?.package?.length ? filters.package.join(',') : undefined;

  const actualPageSize = enableVirtualization || fetchAll ? 1000 : pageSize;

  // Errors propagate so the grid can show its error state with a retry action.
  const res = await fetchProjectObjectsApi({
      projectId,
      search,
      objectType,
      cleanCoreTier,
      package: pkg,
      page,
      pageSize: actualPageSize,
      sortField,
      sortOrder,
    });

  return {
    items: res.items as SapObject[],
    totalCount: res.totalCount,
    page: res.page,
    pageSize: res.pageSize,
    totalPages: res.totalPages,
  };
}
