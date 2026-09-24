import { describe, it, expect } from 'vitest';
import {
  canonicalJsonSerialize,
  calculateSha256,
  computeAuditChainHash,
  verifyEvidenceSnippet,
  ReleaseAlignmentValidator,
  calculateCompositeTrustScore,
} from '@erppreflight/evidence';

describe('M2 Shared Platform Services Suite (TypeScript)', () => {
  describe('1. Canonical RFC 8785 JSON Serialization & Hashing', () => {
    it('serializes objects with sorted keys and minimal whitespace', () => {
      const obj = { z: 1, a: 'hello', m: { b: 2, a: 1 } };
      const serialized = canonicalJsonSerialize(obj);
      // Keys sorted lexicographically: a, m (with a, b), z
      expect(serialized).toBe('{"a":"hello","m":{"a":1,"b":2},"z":1}');
    });

    it('produces identical SHA-256 hash regardless of original object key insertion order', () => {
      const obj1 = { role: 'ADMIN', user: 'johndoe', active: true };
      const obj2 = { active: true, user: 'johndoe', role: 'ADMIN' };

      const hash1 = calculateSha256(canonicalJsonSerialize(obj1));
      const hash2 = calculateSha256(canonicalJsonSerialize(obj2));
      expect(hash1).toBe(hash2);
    });
  });

  describe('2. Tamper-Evident Audit Trail Chaining Formula', () => {
    it('chains consecutive audit events with SHA-256', () => {
      const genesisPrev = '0'.repeat(64);
      const event1Id = 'e1111111-1111-1111-1111-111111111111';
      const tenantId = 't1111111-1111-1111-1111-111111111111';
      const time1 = '2026-09-24T03:00:00.000Z';
      const payload1 = { file: 'transport.zip' };

      const hash1 = computeAuditChainHash(
        genesisPrev,
        event1Id,
        tenantId,
        'FILE_UPLOAD_QUARANTINED',
        time1,
        payload1
      );
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);

      // Event 2 links to hash1
      const event2Id = 'e2222222-2222-2222-2222-222222222222';
      const time2 = '2026-09-24T03:01:00.000Z';
      const payload2 = { fileId: event1Id, status: 'CLEAN' };

      const hash2 = computeAuditChainHash(
        hash1,
        event2Id,
        tenantId,
        'FILE_PROMOTED_CLEAN',
        time2,
        payload2
      );
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);
      expect(hash2).not.toBe(hash1);
    });
  });

  describe('3. Evidence Snippet & Offset Verification', () => {
    it('verifies evidence snippet against artifact content and expected SHA-256', () => {
      const artifact = 'REPORT zdemo.\nSELECT * FROM mara INTO TABLE @DATA(lt_mara).\nWRITE: / "Done".';
      const snippet = 'SELECT * FROM mara INTO TABLE @DATA(lt_mara).';
      const expectedHash = calculateSha256(snippet);

      const verification = verifyEvidenceSnippet(artifact, snippet, expectedHash);
      expect(verification.isValid).toBe(true);
      expect(verification.matched).toBe(true);
      expect(verification.hashMatches).toBe(true);
    });

    it('detects tampered snippet that does not exist in artifact', () => {
      const artifact = 'REPORT zdemo.\nWRITE: / "Hello".';
      const snippet = 'DROP TABLE mara;';

      const verification = verifyEvidenceSnippet(artifact, snippet);
      expect(verification.isValid).toBe(false);
      expect(verification.matched).toBe(false);
    });
  });

  describe('4. Release Alignment Validation', () => {
    it('marks evidence release-aligned when target satisfies valid_from and valid_to', () => {
      const res = ReleaseAlignmentValidator.validate('S4H_2023', 'S4H_2022', 'S4H_2025');
      expect(res.isAligned).toBe(true);
      expect(res.status).toBe('RELEASE_ALIGNED');
      expect(res.penalty).toBe(1.0);
    });

    it('marks evidence premature when target release is older than valid_from', () => {
      const res = ReleaseAlignmentValidator.validate('S4H_2020', 'S4H_2023');
      expect(res.isAligned).toBe(false);
      expect(res.status).toBe('RELEASE_PREMATURE');
      expect(res.penalty).toBe(0.4);
    });

    it('marks evidence deprecated when target release is newer than valid_to', () => {
      const res = ReleaseAlignmentValidator.validate('S4H_2023', 'S4H_2022', 'S4H_2021');
      expect(res.isAligned).toBe(false);
      expect(res.status).toBe('RELEASE_DEPRECATED');
      expect(res.penalty).toBe(0.0);
    });
  });

  describe('5. Composite Trust Scoring', () => {
    it('calculates composite trust score bounded by maximum evidence trust', () => {
      const composite = calculateCompositeTrustScore([
        { trustScore: 1.0 },
        { trustScore: 0.5 },
      ]);
      expect(composite).toBeGreaterThan(0.0);
      expect(composite).toBeLessThanOrEqual(1.0);
    });
  });
});
