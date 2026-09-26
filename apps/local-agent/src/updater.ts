import * as crypto from 'crypto';
import * as fs from 'fs/promises';

/**
 * Signed agent updates (Part 18.8): an update is accepted only if
 *  1. the manifest `{channel, sha256, url, version, notes?}` is signed (Ed25519,
 *     canonical JSON) by the ERP Preflight key pinned at enrollment, and
 *  2. the downloaded artifact's SHA-256 equals the signed manifest digest.
 * Unsigned or mismatching updates are never executed.
 */

export interface UpdateManifest {
  version: string;
  url: string;
  sha256: string;
  channel: string;
  notes?: string;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export class SignedUpdateVerifier {
  static verifyManifest(manifest: UpdateManifest, signatureB64: string, pinnedPublicKeyPem: string): boolean {
    if (!signatureB64 || !pinnedPublicKeyPem) return false;
    try {
      return crypto.verify(null, Buffer.from(canonicalJson(manifest), 'utf8'), crypto.createPublicKey(pinnedPublicKeyPem), Buffer.from(signatureB64, 'base64'));
    } catch {
      return false;
    }
  }

  static verifyArtifact(payload: Buffer, manifest: UpdateManifest): boolean {
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(String(manifest.sha256 || ''), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Full check used before an update may be applied. */
  static verifyUpdate(payload: Buffer, manifest: UpdateManifest, signatureB64: string, pinnedPublicKeyPem: string): { ok: boolean; reason?: string } {
    if (!this.verifyManifest(manifest, signatureB64, pinnedPublicKeyPem)) return { ok: false, reason: 'manifest signature invalid or missing' };
    if (!this.verifyArtifact(payload, manifest)) return { ok: false, reason: 'artifact SHA-256 does not match the signed manifest' };
    return { ok: true };
  }

  static async verifyFile(filePath: string, manifest: UpdateManifest, signatureB64: string, pinnedPublicKeyPem: string) {
    const data = await fs.readFile(filePath);
    return this.verifyUpdate(data, manifest, signatureB64, pinnedPublicKeyPem);
  }
}
