import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { SecretRedactorService } from '../src/modules/redaction/secret-redactor.service';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  canonicalJsonSerialize,
  calculateSha256,
  computeAuditChainHash,
  calculateCompositeTrustScore,
  ReleaseAlignmentValidator,
} from '@erppreflight/evidence';
import {
  RecommendedEngineSchema,
  EngineTypeEnum,
  TamperDetectionResultSchema,
  LedgerAnomalySchema,
} from '@erppreflight/schemas';

describe('Empirical Adversarial Challenges: Milestone 2 Platform', () => {
  const config = new ConfigService({
    MASTER_ENCRYPTION_KEY: 'test-master-encryption-key-for-unit-testing-32-chars',
  });
  const redactor = new SecretRedactorService(config);
  const auditService = new AuditService(null as any);

  // ==========================================================================
  // 1. SECRET REDACTOR CHALLENGES
  // ==========================================================================
  describe('1. SecretRedactor Adversarial Challenges', () => {
    const tenantId = 'c1111111-1111-1111-1111-111111111111';

    it('VALIDATES REMEDIATION: Length-calibrated entropy scanner detects secrets of length 20, 22, and 24', () => {
      const unique20 = 'abcdefghijklmnopqrst';
      expect(unique20.length).toBe(20);
      const entropy20 = redactor.calculateEntropy(unique20);
      expect(entropy20).toBeGreaterThanOrEqual(3.80);
      expect(redactor.isCandidateToken(unique20)).toBe(true);

      const unique22 = 'abcdefghijklmnopqrstuv';
      expect(unique22.length).toBe(22);
      const entropy22 = redactor.calculateEntropy(unique22);
      expect(entropy22).toBeGreaterThanOrEqual(3.80);
      expect(redactor.isCandidateToken(unique22)).toBe(true);

      const unique24 = 'abcdefghijklmnopqrstuvwx';
      const entropy24 = redactor.calculateEntropy(unique24);
      expect(entropy24).toBeGreaterThanOrEqual(4.00);
      expect(redactor.isCandidateToken(unique24)).toBe(true);
    });

    it('REMEDIATED: Length-calibrated thresholds reliably catch secrets of lengths 16, 20, 22, 24, 32, 64', () => {
      const secrets = [
        'k9Z1mP4vL8wQ2xR7',                 // L=16 alnum
        'abcdefghijklmnopqrst',             // L=20 unique
        'abcdefghijklmnopqrstuv',           // L=22 unique
        'abcdefghijklmnopqrstuvwx',         // L=24 unique
        '4f9b8c2e1d0a3f5b7c8e9d0a',         // L=24 hex
        'k9Z1mP4vL8wQ2xR7jA3bC5dEfG8hI0jK', // L=32 alnum
        '4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e4f9b8c2e1d0a3f5b7c8e9d0a1b2c3d4e', // L=64 hex
      ];
      for (const secret of secrets) {
        expect(redactor.isCandidateToken(secret)).toBe(true);
      }
    });

    it('REMEDIATED: Preserves SAP namespaces, architectural prefixes, and DDIC objects', () => {
      const safeTokens = [
        '/COMPANY/ERP_MIGRATION_TOOL',
        '/SDF/RBE_METRIC_COLLECTOR',
        '/UI5/SAP_LIB_CORE',
        'I_PRODUCT_SALES_DELIVERY',
        'C_SALESORDERITEMQUERY',
        'CL_REST_HTTP_CLIENT_FACTORY',
        'ZCUSTOM_TABLE_01',
        'SWWWIHEAD',
        'BKPF',
        'MARA',
        'c1234567-89ab-cdef-0123-456789abcdef', // UUID
      ];
      for (const token of safeTokens) {
        expect(redactor.isCandidateToken(token)).toBe(false);
      }
    });

    it('REMEDIATED: Quoted SAP RFC passwords containing semicolons or spaces are completely redacted', () => {
      const input = 'rfc_password = "Secret;Complex;Pass#123"';
      const res = redactor.redact(input, tenantId);

      expect(res.sanitizedText).not.toContain('Secret;Complex;Pass#123');
      expect(res.sanitizedText).not.toContain(';Complex;Pass#123');
      expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
      expect(res.sanitizedText).toMatch(/rfc_password\s*=\s*"\[REDACTED:SECRET:[a-f0-9]{64}\]"/);
    });

    it('REMEDIATED: Quoted RFC parameters with delimiters and whitespace are completely redacted', () => {
      const input = 'ASHOST=sapdev;PASSWD="my;complex,pwd 123";USER=BWUSER';
      const res = redactor.redact(input, tenantId);

      expect(res.sanitizedText).not.toContain('my;complex,pwd 123');
      expect(res.sanitizedText).not.toContain(';complex,pwd 123');
      expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
      expect(res.sanitizedText).toMatch(/PASSWD="\[REDACTED:SECRET:[a-f0-9]{64}\]"/);
    });

    it('REMEDIATED: SAP Router string with /S/ port and destinations are completely redacted', () => {
      const input = '/H/router.corp/S/3299/W/SecretRouterPassword/H/target.corp/S/3200';
      const res = redactor.redact(input, tenantId);

      expect(res.sanitizedText).not.toContain('SecretRouterPassword');
      expect(res.sanitizedText).toContain('/H/router.corp/S/3299/W/[REDACTED:SECRET:');
      expect(res.sanitizedText).toContain('/H/target.corp/S/3200');
    });

    it('REMEDIATED: SAP Router multi-hop route string masks all passwords cleanly', () => {
      const multiHop = '/H/r1/S/3299/W/p1/H/r2/S/3299/W/p2/H/dest';
      const res = redactor.redact(multiHop, tenantId);
      expect(res.sanitizedText).not.toContain('p1');
      expect(res.sanitizedText).not.toContain('p2');
      expect(res.sanitizedText).toContain('/H/r1/S/3299/W/[REDACTED:SECRET:');
      expect(res.sanitizedText).toContain('/H/r2/S/3299/W/[REDACTED:SECRET:');
      expect(res.sanitizedText).toContain('/H/dest');
    });

    it('redacts multi-line private keys with Windows CRLF endings', () => {
      const crlfKey =
        '-----BEGIN RSA PRIVATE KEY-----\r\n' +
        'MIIEowIBAAKCAQEA0Y1+g43hYjdQkI3+4W5\r\n' +
        'Z1c2d3e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8\r\n' +
        '-----END RSA PRIVATE KEY-----';

      const res = redactor.redact(crlfKey, tenantId);
      expect(res.redactedCategories).toContain('PRIVATE_KEY');
      expect(res.sanitizedText).not.toContain('MIIEowIBAAKCA');
      expect(res.sanitizedText).toContain('[REDACTED:SECRET:');
    });

    it('cryptographic one-way invariant: masks are deterministic per tenant and irreversible without keys', () => {
      const secret = 'DatabaseSecretPassword123!';
      const maskA = redactor.computeMask(secret, tenantId);
      const maskB = redactor.computeMask(secret, 'c2222222-2222-2222-2222-222222222222');

      // Referential determinism
      expect(maskA).toBe(redactor.computeMask(secret, tenantId));
      // Cross-tenant privacy
      expect(maskA).not.toBe(maskB);
      // Valid HMAC-SHA256 hex format
      expect(maskA).toMatch(/^\[REDACTED:SECRET:[a-f0-9]{64}\]$/);
    });
  });

  // ==========================================================================
  // 2. AUDIT TRAIL SERVICE & HASH CHAIN INTEGRITY CHALLENGES
  // ==========================================================================
  describe('2. AuditTrailService & Hash Chain Tamper Simulation', () => {
    const tenantId = 'c1111111-1111-1111-1111-111111111111';
    const genesisPrev = '0'.repeat(64);

    interface MockAuditEvent {
      id: string;
      sequenceNum?: number;
      organization_id: string;
      action: string;
      created_at: string;
      payload: Record<string, unknown>;
      prev_hash: string;
      current_hash: string;
    }

    function createMockChain(length: number): MockAuditEvent[] {
      const chain: MockAuditEvent[] = [];
      let prevHash = genesisPrev;
      for (let i = 0; i < length; i++) {
        const id = `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`;
        const time = new Date(Date.UTC(2026, 8, 24, 3, i, 0)).toISOString();
        const payload = { seq: i, note: `Audit record ${i}` };
        const currHash = computeAuditChainHash(
          prevHash,
          id,
          tenantId,
          `ACTION_${i}`,
          time,
          payload
        );
        chain.push({
          id,
          sequenceNum: i + 1,
          organization_id: tenantId,
          action: `ACTION_${i}`,
          created_at: time,
          payload,
          prev_hash: prevHash,
          current_hash: currHash,
        });
        prevHash = currHash;
      }
      return chain;
    }

    it('verifies valid 10-event audit chain with zero anomalies', () => {
      const chain = createMockChain(10);
      const res = auditService.verifyChain(chain);
      expect(res.isValid).toBe(true);
      expect(res.totalEventsVerified).toBe(10);
      expect(res.anomalies).toHaveLength(0);
    });

    it('REMEDIATED: Audit events with identical timestamps ordered by sequenceNum eliminate false tamper alerts', () => {
      const sharedTime = '2026-09-24T03:00:00.000Z';
      const idA = 'ffffffff-0000-0000-0000-000000000000';
      const hashA = computeAuditChainHash(genesisPrev, idA, tenantId, 'ACT_A', sharedTime, {});

      const evA = {
        id: idA,
        sequenceNum: 1,
        organization_id: tenantId,
        action: 'ACT_A',
        created_at: sharedTime,
        payload: {},
        prev_hash: genesisPrev,
        current_hash: hashA,
      };

      const idB = '00000000-0000-0000-0000-000000000000';
      const hashB = computeAuditChainHash(hashA, idB, tenantId, 'ACT_B', sharedTime, {});

      const evB = {
        id: idB,
        sequenceNum: 2,
        organization_id: tenantId,
        action: 'ACT_B',
        created_at: sharedTime,
        payload: {},
        prev_hash: hashA,
        current_hash: hashB,
      };

      // Even if passed out of order [evB, evA], verifyChain sorts by sequenceNum
      const res = auditService.verifyChain([evB, evA]);
      expect(res.isValid).toBe(true);
      expect(res.totalEventsVerified).toBe(2);
      expect(res.anomalies).toHaveLength(0);
    });

    it('REMEDIATED: Audit trail detects sequence gaps when an event is missing', () => {
      const t0 = '2026-09-24T03:00:00.000Z';
      const t1 = '2026-09-24T03:01:00.000Z';

      const id1 = '11111111-1111-1111-1111-111111111111';
      const h1 = computeAuditChainHash(genesisPrev, id1, tenantId, 'ACT_1', t0, {});
      const ev1 = { id: id1, sequenceNum: 1, organization_id: tenantId, action: 'ACT_1', created_at: t0, payload: {}, prev_hash: genesisPrev, current_hash: h1 };

      const id3 = '33333333-3333-3333-3333-333333333333';
      const h3 = computeAuditChainHash(h1, id3, tenantId, 'ACT_3', t1, {});
      const ev3 = { id: id3, sequenceNum: 3, organization_id: tenantId, action: 'ACT_3', created_at: t1, payload: {}, prev_hash: h1, current_hash: h3 };

      const res = auditService.verifyChain([ev1, ev3]);
      expect(res.isValid).toBe(false);
      const gaps = res.anomalies.filter((a) => a.anomalyType === 'GAP_DETECTED');
      expect(gaps).toHaveLength(1);
      expect(gaps[0].expectedValue).toBe('2');
      expect(gaps[0].actualValue).toBe('3');
    });

    it('detects tampering when past payload is modified', () => {
      const chain = createMockChain(5);
      // Tamper with event at index 2
      chain[2].payload = { seq: 2, note: 'Tampered content!' };

      const res = auditService.verifyChain(chain);
      expect(res.isValid).toBe(false);
      const corrupted = res.anomalies.filter((a) => a.anomalyType === 'CORRUPTED_PAYLOAD');
      expect(corrupted.length).toBeGreaterThanOrEqual(1);
      expect(corrupted[0].eventIndex).toBe(2);
    });

    it('detects broken chain link when prev_hash is altered', () => {
      const chain = createMockChain(5);
      // Corrupt link at index 3
      chain[3].prev_hash = 'f'.repeat(64);

      const res = auditService.verifyChain(chain);
      expect(res.isValid).toBe(false);
      const broken = res.anomalies.filter((a) => a.anomalyType === 'BROKEN_CHAIN_LINK');
      expect(broken.length).toBeGreaterThanOrEqual(1);
      expect(broken[0].eventIndex).toBe(3);
    });

    it('detects missing genesis prev_hash on event 0', () => {
      const chain = createMockChain(3);
      chain[0].prev_hash = 'a'.repeat(64);

      const res = auditService.verifyChain(chain);
      expect(res.isValid).toBe(false);
      expect(res.anomalies[0].anomalyType).toBe('MISSING_GENESIS_PREV_HASH');
    });

    it('detects timestamp anachronisms when events are chronologically inverted', () => {
      const chain = createMockChain(4);
      // Make event 2 earlier than event 1
      chain[2].created_at = new Date(Date.UTC(2026, 8, 24, 3, 0, 30)).toISOString();

      const res = auditService.verifyChain(chain);
      expect(res.isValid).toBe(false);
      const anachronisms = res.anomalies.filter((a) => a.anomalyType === 'TIMESTAMP_ANACHRONISM');
      expect(anachronisms.length).toBeGreaterThanOrEqual(1);
      expect(anachronisms[0].eventIndex).toBe(2);
    });
  });

  // ==========================================================================
  // 3. AI PROBLEM ROUTER & EPISTEMIC CEILING CHALLENGES
  // ==========================================================================
  describe('3. AIProblemRouter Schema & Epistemic Ceiling Invariant', () => {
    it('RecommendedEngineSchema STRICTLY REJECTS confidence above 0.60', () => {
      const validRec = {
        engineType: 'OPD_GUARD',
        confidence: 0.60,
        rationale: 'Valid rationale',
        requiredArtifactsPresent: [],
        missingArtifactsRequired: [],
      };
      expect(RecommendedEngineSchema.safeParse(validRec).success).toBe(true);

      const elevatedRec = {
        ...validRec,
        confidence: 0.61, // Violates 0.60 ceiling
      };
      const res = RecommendedEngineSchema.safeParse(elevatedRec);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0].message).toContain('Number must be less than or equal to 0.6');
      }
    });

    it('RecommendedEngineSchema accepts all 19 valid engine enums', () => {
      const all19 = Object.values(EngineTypeEnum.enum);
      expect(all19).toHaveLength(19);

      for (const eng of all19) {
        const parseRes = RecommendedEngineSchema.safeParse({
          engineType: eng,
          confidence: 0.50,
          rationale: `Testing ${eng}`,
          requiredArtifactsPresent: [],
          missingArtifactsRequired: [],
        });
        expect(parseRes.success).toBe(true);
      }
    });
  });

  // ==========================================================================
  // 4. COMPOSITE TRUST & RELEASE ALIGNMENT REMEDIATION CHALLENGES
  // ==========================================================================
  describe('4. Composite Trust & Release Alignment Remediation Challenges', () => {
    it('REMEDIATED: Composite Trust Accumulator increases score monotonically and bounds properly', () => {
      expect(calculateCompositeTrustScore([{ trustScore: 0.85 }])).toBe(0.85);

      const score2 = calculateCompositeTrustScore([{ trustScore: 0.85 }, { trustScore: 0.85 }]);
      expect(score2).toBe(0.876);
      expect(score2).toBeGreaterThan(0.85);

      const score3 = calculateCompositeTrustScore([{ trustScore: 0.85 }, { trustScore: 0.85 }, { trustScore: 0.85 }]);
      expect(score3).toBe(0.897);
      expect(score3).toBeGreaterThan(score2);

      // Anchored at 1.0
      expect(calculateCompositeTrustScore([{ trustScore: 1.0 }, { trustScore: 0.85 }])).toBe(1.0);

      // LLM ceiling strictly capped at 0.60
      const llmScore = calculateCompositeTrustScore([{ trustScore: 0.85 }, { trustScore: 0.85 }], { isLlmGenerated: true });
      expect(llmScore).toBe(0.60);
    });

    it('REMEDIATED: S/4HANA Cloud releases (2308, 2402, 2408) classify as S4HANA_CLOUD and match regex', () => {
      const res2308 = ReleaseAlignmentValidator.parseRelease('2308');
      expect(res2308.family).toBe('S4HANA_CLOUD');
      expect(res2308.version).toBe(2308);

      const res2402 = ReleaseAlignmentValidator.parseRelease('2402');
      expect(res2402.family).toBe('S4HANA_CLOUD');
      expect(res2402.version).toBe(2402);

      const res2408 = ReleaseAlignmentValidator.parseRelease('2408');
      expect(res2408.family).toBe('S4HANA_CLOUD');
      expect(res2408.version).toBe(2408);

      const res2023 = ReleaseAlignmentValidator.parseRelease('2023');
      expect(res2023.family).toBe('ON_PREMISE');
      expect(res2023.version).toBe(2023);
    });
  });
});
