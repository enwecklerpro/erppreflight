import { createHash } from 'node:crypto';

/**
 * Calculates cryptographic SHA-256 hash of text or binary buffer.
 */
export function calculateSha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Generates an idempotent deduplication fingerprint for findings.
 */
export function createFindingFingerprint(
  ruleId: string,
  affectedObjectName: string,
  artifactPath: string
): string {
  return calculateSha256(`${ruleId.trim()}:${affectedObjectName.trim()}:${artifactPath.trim()}`);
}
