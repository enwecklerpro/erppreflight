import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';

/**
 * Connector Credential Vault (Part 16.25, Part 18, C §35).
 *
 * Secrets are encrypted at rest with AES-256-GCM. The data key is derived from
 * MASTER_ENCRYPTION_KEY with HKDF-SHA256 (purpose-separated from the other uses of
 * the master key, e.g. redaction masks). Every ciphertext records the key id
 * (first 16 hex chars of SHA-256 over the derived key) so the master key can be
 * rotated: set the new key as MASTER_ENCRYPTION_KEY and the old one as
 * MASTER_ENCRYPTION_KEY_PREVIOUS; old ciphertexts keep decrypting and are
 * re-encrypted with the current key on the next write (`needsRotation`).
 *
 * The additional authenticated data binds a ciphertext to its tenant and purpose,
 * so a ciphertext copied into another tenant's row fails authentication.
 *
 * Format: `v1.<keyId>.<iv b64url>.<tag b64url>.<ciphertext b64url>`
 */

const FORMAT_VERSION = 'v1';
const HKDF_INFO = 'erppreflight/connector-credential-vault/v1';

export class CredentialVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialVaultError';
  }
}

interface VaultKey {
  id: string;
  key: Buffer;
}

export function deriveVaultKey(masterKey: string): VaultKey {
  if (!masterKey || masterKey.length < 16) {
    throw new CredentialVaultError('MASTER_ENCRYPTION_KEY is not configured');
  }
  const ikm = /^[0-9a-fA-F]{64}$/.test(masterKey) ? Buffer.from(masterKey, 'hex') : Buffer.from(masterKey, 'utf8');
  const key = Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), HKDF_INFO, 32));
  const id = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  return { id, key };
}

function aad(organizationId: string, purpose: string): Buffer {
  return Buffer.from(`${organizationId}|${purpose}`, 'utf8');
}

export class CredentialCipher {
  private readonly current: VaultKey;
  private readonly keys = new Map<string, VaultKey>();

  constructor(masterKey: string, previousKeys: string[] = []) {
    this.current = deriveVaultKey(masterKey);
    this.keys.set(this.current.id, this.current);
    for (const prev of previousKeys) {
      if (!prev) continue;
      const k = deriveVaultKey(prev);
      if (!this.keys.has(k.id)) this.keys.set(k.id, k);
    }
  }

  get currentKeyId(): string {
    return this.current.id;
  }

  encrypt(organizationId: string, purpose: string, plaintext: string): { ciphertext: string; keyId: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.current.key, iv);
    cipher.setAAD(aad(organizationId, purpose));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: [FORMAT_VERSION, this.current.id, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.'),
      keyId: this.current.id,
    };
  }

  decrypt(organizationId: string, purpose: string, payload: string): string {
    const parts = String(payload || '').split('.');
    if (parts.length !== 5 || parts[0] !== FORMAT_VERSION) {
      throw new CredentialVaultError('Unsupported credential ciphertext format');
    }
    const [, keyId, ivB64, tagB64, ctB64] = parts;
    const key = this.keys.get(keyId);
    if (!key) {
      throw new CredentialVaultError(`Credential was encrypted with unknown key id ${keyId}; configure MASTER_ENCRYPTION_KEY_PREVIOUS`);
    }
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key.key, Buffer.from(ivB64, 'base64url'));
      decipher.setAAD(aad(organizationId, purpose));
      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new CredentialVaultError('Credential ciphertext failed authentication');
    }
  }

  needsRotation(payload: string | null | undefined): boolean {
    if (!payload) return false;
    const keyId = String(payload).split('.')[1];
    return keyId !== this.current.id;
  }
}

@Injectable()
export class CredentialVault {
  private cipher: CredentialCipher | null = null;

  constructor(@Optional() private readonly config?: ConfigService) {}

  private getCipher(): CredentialCipher {
    if (!this.cipher) {
      const master =
        this.config?.get<string>('MASTER_ENCRYPTION_KEY') || process.env.MASTER_ENCRYPTION_KEY || '';
      const previous = (process.env.MASTER_ENCRYPTION_KEY_PREVIOUS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      this.cipher = new CredentialCipher(master, previous);
    }
    return this.cipher;
  }

  get currentKeyId(): string {
    return this.getCipher().currentKeyId;
  }

  encryptJson(organizationId: string, purpose: string, value: unknown): { ciphertext: string; keyId: string } {
    return this.getCipher().encrypt(organizationId, purpose, JSON.stringify(value));
  }

  decryptJson<T = Record<string, unknown>>(organizationId: string, purpose: string, payload: string): T {
    return JSON.parse(this.getCipher().decrypt(organizationId, purpose, payload)) as T;
  }

  encryptString(organizationId: string, purpose: string, value: string) {
    return this.getCipher().encrypt(organizationId, purpose, value);
  }

  decryptString(organizationId: string, purpose: string, payload: string): string {
    return this.getCipher().decrypt(organizationId, purpose, payload);
  }

  needsRotation(payload: string | null | undefined): boolean {
    return this.getCipher().needsRotation(payload);
  }
}
