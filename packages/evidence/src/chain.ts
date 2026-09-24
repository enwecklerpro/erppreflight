import { calculateSha256 } from './hashing';
import { canonicalJsonSerialize } from './canonical_json';

/**
 * Computes tamper-evident audit ledger node hash linking to previous entry.
 * (Legacy pipe-delimited format for backward compatibility).
 */
export function computeAuditNodeHash(
  prevHash: string | null | undefined,
  timestamp: string,
  tenantId: string,
  action: string,
  payloadHash: string
): string {
  const previous = prevHash || '0000000000000000000000000000000000000000000000000000000000000000';
  return calculateSha256(`${previous}|${timestamp}|${tenantId}|${action}|${payloadHash}`);
}

/**
 * Canonical RFC 8785 compliant Audit Ledger chaining formula:
 * hash_n = SHA256(prev_hash:event_id:organization_id:action:created_at:JCS(payload))
 */
export function computeAuditChainHash(
  prevHash: string | null | undefined,
  eventId: string,
  organizationId: string,
  action: string,
  createdAt: string,
  payload: Record<string, unknown> | unknown
): string {
  const previous = prevHash || '0000000000000000000000000000000000000000000000000000000000000000';
  const jcsPayload = canonicalJsonSerialize(payload);
  const raw = `${previous}:${eventId}:${organizationId}:${action}:${createdAt}:${jcsPayload}`;
  return calculateSha256(raw);
}

/**
 * Verifies that a snippet exists within artifact text and matches the expected SHA-256 hash.
 */
export function verifyEvidenceSnippet(
  artifactText: string,
  snippet: string,
  expectedSha256?: string
): { isValid: boolean; matched: boolean; hashMatches: boolean; calculatedHash: string } {
  const normalizedSnippet = snippet.trim();
  const matched = artifactText.includes(normalizedSnippet);
  const calculatedHash = calculateSha256(normalizedSnippet);
  const hashMatches = expectedSha256 ? calculatedHash.toLowerCase() === expectedSha256.toLowerCase() : true;

  return {
    isValid: matched && hashMatches,
    matched,
    hashMatches,
    calculatedHash,
  };
}
