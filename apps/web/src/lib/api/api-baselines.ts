/**
 * API Change Guard stored baselines (project scoped): registry client. Responses are validated with the
 * shared Zod contracts (@erppreflight/schemas) at the boundary (Axiom 1.2).
 */
import { z } from 'zod';
import { ApiBaselineSchema, CreateApiBaselineSchema, type ApiBaseline, type CreateApiBaselineDto } from '@erppreflight/schemas';
import { customInstance } from './custom-instance';
import { parse } from './commercial';

export type { ApiBaseline, CreateApiBaselineDto };

export const apiBaselineKeys = {
  list: (projectId: string) => ['project', projectId, 'api-baselines'] as const,
};

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/api-baselines`;

export async function fetchApiBaselines(projectId: string): Promise<ApiBaseline[]> {
  const endpoint = base(projectId);
  return parse(z.array(ApiBaselineSchema), endpoint, await customInstance<unknown>(endpoint));
}

export async function createApiBaseline(projectId: string, body: CreateApiBaselineDto): Promise<ApiBaseline> {
  const endpoint = base(projectId);
  const payload = CreateApiBaselineSchema.parse(body);
  return parse(
    ApiBaselineSchema,
    endpoint,
    await customInstance<unknown>(endpoint, { method: 'POST', body: JSON.stringify(payload) })
  );
}

export async function activateApiBaseline(projectId: string, id: string): Promise<ApiBaseline> {
  const endpoint = `${base(projectId)}/${encodeURIComponent(id)}/activate`;
  return parse(ApiBaselineSchema, endpoint, await customInstance<unknown>(endpoint, { method: 'POST' }));
}

const DeleteResultSchema = z.object({ id: z.string(), deleted: z.literal(true), wasActive: z.boolean() });

export async function deleteApiBaseline(projectId: string, id: string): Promise<z.infer<typeof DeleteResultSchema>> {
  const endpoint = `${base(projectId)}/${encodeURIComponent(id)}`;
  return parse(DeleteResultSchema, endpoint, await customInstance<unknown>(endpoint, { method: 'DELETE' }));
}
