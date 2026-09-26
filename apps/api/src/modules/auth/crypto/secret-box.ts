import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption (AES-256-GCM) for secrets stored at rest, e.g. TOTP seeds.
 * The 256-bit key is derived from MASTER_ENCRYPTION_KEY with HKDF-SHA256 and a
 * purpose-specific `info` string, so every purpose gets an independent key.
 *
 * Format: `v1.<iv b64url>.<tag b64url>.<ciphertext b64url>`
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(masterKey: string, purpose: string) {
    if (!masterKey || masterKey.length < 32) {
      throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
    }
    this.key = Buffer.from(
      hkdfSync('sha256', Buffer.from(masterKey, 'utf8'), Buffer.from('erppreflight', 'utf8'), Buffer.from(purpose, 'utf8'), 32)
    );
  }

  encrypt(plaintext: string, associatedData?: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    if (associatedData) cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(payload: string, associatedData?: string): string {
    const parts = String(payload || '').split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Unsupported encrypted secret format');
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64url'));
    if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
  }
}
