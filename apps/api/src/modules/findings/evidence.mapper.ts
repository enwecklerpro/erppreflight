/**
 * Maps persisted evidence rows (snake_case from PostgreSQL / json_agg) into the
 * camelCase API contract consumed by the web client. Accepts already-camelCase
 * objects as well so callers can pass either shape safely.
 *
 * The pgvector `embedding` column is intentionally never exposed.
 */
export interface EvidenceItemResponse {
  id: string;
  findingId: string | null;
  artifactPath: string;
  lineNumber: number | null;
  columnNumber: number | null;
  snippet: string | null;
  sha256: string;
  provenance: string;
  sourceTitle: string | null;
  sourceUrl: string | null;
  trustScore: number;
  createdAt: string | null;
}

function toNullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function mapEvidenceRow(row: Record<string, any>): EvidenceItemResponse {
  const trust = row.trustScore ?? row.trust_score;
  const trustNum = trust === null || trust === undefined ? 1 : Number(trust);
  return {
    id: row.id,
    findingId: row.findingId ?? row.finding_id ?? null,
    artifactPath: row.artifactPath ?? row.artifact_path ?? '',
    lineNumber: toNullableInt(row.lineNumber ?? row.line_number),
    columnNumber: toNullableInt(row.columnNumber ?? row.column_number),
    snippet: row.snippet ?? null,
    sha256: row.sha256 ?? '',
    provenance: row.provenance ?? 'VERIFIED',
    sourceTitle: row.sourceTitle ?? row.source_title ?? null,
    sourceUrl: row.sourceUrl ?? row.source_url ?? null,
    trustScore: Number.isFinite(trustNum) ? trustNum : 1,
    createdAt: toIso(row.createdAt ?? row.created_at),
  };
}

export function mapEvidenceList(value: unknown): EvidenceItemResponse[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((e) => e && typeof e === 'object')
    .map((e) => mapEvidenceRow(e as Record<string, any>));
}

/**
 * SQL fragment aggregating evidence for finding alias `f` without the embedding
 * vector, in deterministic order.
 */
export const EVIDENCE_JSON_AGG_SQL = `(SELECT json_agg(json_build_object(
    'id', e.id,
    'finding_id', e.finding_id,
    'artifact_path', e.artifact_path,
    'line_number', e.line_number,
    'column_number', e.column_number,
    'snippet', e.snippet,
    'sha256', e.sha256,
    'provenance', e.provenance,
    'source_title', e.source_title,
    'source_url', e.source_url,
    'trust_score', e.trust_score,
    'created_at', e.created_at
  ) ORDER BY e.created_at ASC, e.id ASC) FROM evidence e WHERE e.finding_id = f.id AND e.organization_id = f.organization_id)`;
