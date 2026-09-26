import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 4226 (HOTP) / RFC 6238 (TOTP) implementation on node:crypto.
 * SHA-1, 6 digits, 30-second period — the parameters every authenticator app supports.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error('Invalid base32 character');
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit random secret (RFC 4226 §4 recommends >= 128 bits; 160 matches SHA-1). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function timeStep(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totp(base32Secret: string, nowMs: number = Date.now()): string {
  return hotp(base32Decode(base32Secret), timeStep(nowMs));
}

/**
 * Verifies a code within ±`window` steps (clock drift tolerance).
 * Returns the matched time step (used for replay protection) or null.
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  options: { nowMs?: number; window?: number } = {}
): number | null {
  const normalized = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) {
    return null;
  }
  const secret = base32Decode(base32Secret);
  const current = timeStep(options.nowMs ?? Date.now());
  const window = options.window ?? 1;
  let matched: number | null = null;
  // Evaluate every candidate (no early exit) to keep timing independent of the match position.
  for (let step = current - window; step <= current + window; step++) {
    const candidate = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(candidate, Buffer.from(normalized)) && matched === null) {
      matched = step;
    }
  }
  return matched;
}

/** otpauth:// URI (Key Uri Format) understood by Google Authenticator, 1Password, Authy, etc. */
export function buildOtpauthUri(params: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(params.issuer)}:${encodeURIComponent(params.account)}`;
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
