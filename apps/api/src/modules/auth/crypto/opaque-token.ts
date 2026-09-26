import { createHash, randomBytes } from 'node:crypto';

/**
 * Single-use opaque tokens (e-mail verification, password reset, invitations).
 * 256 bits of entropy, base64url; only the SHA-256 digest is persisted, so a
 * database leak does not reveal usable links.
 */
export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashOpaqueToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/** Accepts only well-formed tokens (43 base64url chars) before touching the database. */
export function isWellFormedOpaqueToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Recovery codes: 10 characters from an unambiguous alphabet, shown as xxxxx-xxxxx. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = randomBytes(10);
    let code = '';
    for (const b of bytes) code += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
    codes.add(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return [...codes];
}

export function normalizeRecoveryCode(code: string): string {
  const clean = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean.length === 10 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
}

/** Per-user salted digest (the user id prevents cross-account precomputation). */
export function hashRecoveryCode(userId: string, code: string): string {
  return createHash('sha256')
    .update(`recovery:${userId}:${normalizeRecoveryCode(code)}`, 'utf8')
    .digest('hex');
}
