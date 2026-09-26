'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchFindings, type FindingsPage, type FindingsQueryParams } from '../lib/api-client';
import { queryKeys, type FindingFilters } from '../lib/query/query-keys';
import type { TableUrlState } from './useTableUrlSync';

/** The findings API caps pageSize at 100. */
export const FINDINGS_MAX_PAGE_SIZE = 100;

/**
 * Maps URL table state to the server-side findings query.
 * The API filters on a single severity / engine value; multi-value selections
 * are left to client-side filtering of the current page.
 */
export function buildFindingsQueryParams(
  state: Pick<TableUrlState, 'page' | 'pageSize' | 'search' | 'filters'>,
  projectId?: string
): FindingsQueryParams {
  const severity = state.filters.severity;
  const engine = state.filters.engineType;
  const status = state.filters.status;
  const assignee = state.filters.assignee?.[0];
  const due = state.filters.due?.[0];
  return {
    projectId: projectId || undefined,
    page: Math.max(1, state.page),
    pageSize: Math.min(FINDINGS_MAX_PAGE_SIZE, Math.max(1, state.pageSize)),
    search: state.search || undefined,
    severity: severity && severity.length === 1 ? severity[0] : undefined,
    engine: engine && engine.length === 1 ? engine[0] : undefined,
    // Finding lifecycle filters are evaluated server-side (multi-status allowed).
    status: status && status.length > 0 ? status.join(',') : undefined,
    assignee: assignee || undefined,
    due: due || undefined,
    latest: projectId ? true : undefined,
  };
}

export function useFindingsPage(
  state: Pick<TableUrlState, 'page' | 'pageSize' | 'search' | 'filters'>,
  projectId?: string
) {
  const params = buildFindingsQueryParams(state, projectId);
  const filters: Omit<FindingFilters, 'projectId'> & { status?: string; assignee?: string; due?: string; latest?: boolean } = {
    page: params.page,
    limit: params.pageSize,
    search: params.search,
    severity: params.severity as FindingFilters['severity'],
    engineType: params.engine as FindingFilters['engineType'],
    status: params.status,
    assignee: params.assignee,
    due: params.due,
    latest: params.latest,
  };
  return useQuery<FindingsPage, Error>({
    queryKey: projectId
      ? queryKeys.findings.byProject(projectId, filters)
      : queryKeys.findings.list(filters),
    queryFn: () => fetchFindings(params),
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
  });
}
