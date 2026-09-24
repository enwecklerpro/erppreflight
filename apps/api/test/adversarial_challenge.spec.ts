import { describe, it, expect } from 'vitest';
import {
  FindingSchema,
  AnalysisJobRequestSchema,
  AnalysisJobResponseSchema,
  EvidenceItemSchema,
  SeverityEnum,
  ConfidenceClassEnum,
  EngineTypeEnum,
} from '@erppreflight/schemas';
import {
  calculateSha256,
  createFindingFingerprint,
  classifyProvenance,
  computeAuditNodeHash,
} from '@erppreflight/evidence';
import {
  signAuthToken,
  verifyAuthToken,
  hasPermission,
  PERMISSIONS,
} from '@erppreflight/auth';
import {
  TenancyContext,
  runWithTenantContext,
  assertTenantMatch,
  TenantIsolationViolationException,
} from '@erppreflight/tenancy';

describe('Adversarial Challenge: Milestone 1 Foundation', () => {
  describe('1. Interface Contract Synchronization (NestJS <-> Python Analysis)', () => {
    it('CHALLENGE RESOLVED: AnalysisJobRequestSchema parses wire payload from PROJECT.md / Python specification', () => {
      const pythonWireRequest = {
        job_id: 'c1234567-89ab-cdef-0123-456789abcdef',
        tenant_id: 'a1234567-89ab-cdef-0123-456789abcdef',
        project_id: 'b1234567-89ab-cdef-0123-456789abcdef',
        engine_type: 'OPD_GUARD',
        target_release: 'S4H_2023',
        artifact_s3_key: 'uploads/tenant/file.xml',
        artifact_type: 'XML',
        configuration: {},
      };

      const result = AnalysisJobRequestSchema.safeParse(pythonWireRequest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.jobId).toBe('c1234567-89ab-cdef-0123-456789abcdef');
        expect(result.data.tenantId).toBe('a1234567-89ab-cdef-0123-456789abcdef');
        expect(result.data.engineType).toBe('OPD_GUARD');
        expect(result.data.artifactType).toBe('XML');
      }
    });

    it('CHALLENGE RESOLVED: FindingSchema parses Python Analysis Engine finding output with string[] affected_objects', () => {
      const pythonFindingWire = {
        id: 'd1234567-89ab-cdef-0123-456789abcdef',
        rule_id: 'OPD_BRF_001',
        severity: 'CRITICAL',
        category: 'OUTPUT_DETERMINATION',
        title: 'Missing BRFplus Decision Table Entry',
        description: 'No valid recipient found in OPD table',
        confidence: 'VERIFIED',
        confidence_score: 1.0,
        remediation: 'Maintain decision table in transaction OPD',
        affected_objects: ['APOC_OR_ISS_CHNL', 'BRF_DECISION_TABLE_01'],
        evidence: [
          {
            artifact_path: 'xml/opd_rules.xml',
            line_number: 45,
            column_number: 12,
            snippet: '<ConditionColumn id="C1" />',
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            provenance: 'VERIFIED',
          },
        ],
        technical_details: { brf_id: '001' },
      };

      const result = FindingSchema.safeParse(pythonFindingWire);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ruleId).toBe('OPD_BRF_001');
        expect(result.data.severity).toBe('CRITICAL');
        expect(result.data.confidence).toBe('VERIFIED');
        expect(result.data.confidenceScore).toBe(1.0);
        expect(result.data.affectedObjects).toHaveLength(2);
        expect(result.data.affectedObjects[0].name).toBe('APOC_OR_ISS_CHNL');
        expect(result.data.evidence[0].artifactPath).toBe('xml/opd_rules.xml');
      }
    });

    it('CHALLENGE: EvidenceItemSchema rejects non-64 hex or corrupted SHA-256', () => {
      const corruptShaList = [
        '',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85', // 63 chars
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b8555', // 65 chars
        'g3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // invalid hex char 'g'
      ];

      for (const badSha of corruptShaList) {
        const res = EvidenceItemSchema.safeParse({
          artifactPath: 'some/path.txt',
          sha256: badSha,
        });
        expect(res.success).toBe(false);
      }
    });

    it('CHALLENGE RESOLVED: EvidenceItemSchema strictly rejects non-hex characters in SHA-256', () => {
      const nonHex64CharString = 'Z'.repeat(64);
      const res = EvidenceItemSchema.safeParse({
        artifactPath: 'some/path.txt',
        sha256: nonHex64CharString,
      });
      expect(res.success).toBe(false);
    });
  });

  describe('2. Epistemic Confidence Invariants & Proof of Provenance', () => {
    it('should demote missing evidence to UNKNOWN in TypeScript classifier', () => {
      const res = classifyProvenance({
        hasEvidence: false,
        isExactParserOrAstMatch: true,
      });
      expect(res.confidence).toBe('UNKNOWN');
      expect(res.score).toBe(0.30);
    });

    it('should strictly limit LLM-derived findings to INFERRED (0.60)', () => {
      const res = classifyProvenance({
        hasEvidence: true,
        isLlmGenerated: true,
        isExactParserOrAstMatch: true, // Even if claimed AST match, LLM must not exceed INFERRED
      });
      expect(res.confidence).toBe('INFERRED');
      expect(res.score).toBe(0.60);
    });

    it('should calculate identical SHA-256 for identical inputs (deterministic)', () => {
      const text = 'SELECT SINGLE * FROM mara WHERE matnr = @lv_matnr;';
      const hash1 = calculateSha256(text);
      const hash2 = calculateSha256(text);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should handle Unicode and special characters without crash in fingerprinting', () => {
      const fp1 = createFindingFingerprint('OPD_001', 'Z_PRÜFUNG_ÄÖÜ', 'src/äöü/test.abap');
      const fp2 = createFindingFingerprint('OPD_001', 'Z_PRÜFUNG_ÄÖÜ', 'src/äöü/test.abap');
      expect(fp1).toBe(fp2);
      expect(fp1).toHaveLength(64);
    });

    it('should build tamper-evident audit hash chain and detect breaks', () => {
      const tenantId = '00000000-0000-0000-0000-000000000001';
      const genesisHash = computeAuditNodeHash(null, '2026-09-24T00:00:00Z', tenantId, 'ANALYSIS_STARTED', 'hash1');
      const secondHash = computeAuditNodeHash(genesisHash, '2026-09-24T00:01:00Z', tenantId, 'ANALYSIS_COMPLETED', 'hash2');

      expect(genesisHash).toHaveLength(64);
      expect(secondHash).toHaveLength(64);
      expect(secondHash).not.toBe(genesisHash);

      // Tampered previous hash yields different second node hash
      const tamperedSecond = computeAuditNodeHash('tampered-hash', '2026-09-24T00:01:00Z', tenantId, 'ANALYSIS_COMPLETED', 'hash2');
      expect(tamperedSecond).not.toBe(secondHash);
    });
  });

  describe('3. Multi-Tenancy Isolation & Node.js AsyncLocalStorage', () => {
    it('should maintain tenant isolation across concurrent asynchronous branches', async () => {
      const tenantA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const tenantB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      const taskA = runWithTenantContext({ tenantId: tenantA }, async () => {
        await new Promise((r) => setTimeout(r, 20));
        return TenancyContext.getTenantId();
      });

      const taskB = runWithTenantContext({ tenantId: tenantB }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return TenancyContext.getTenantId();
      });

      const [resA, resB] = await Promise.all([taskA, taskB]);
      expect(resA).toBe(tenantA);
      expect(resB).toBe(tenantB);
    });

    it('should throw when accessing tenant context outside run scope', () => {
      expect(() => TenancyContext.getTenantId()).toThrow(/TenantContextMissingException/);
    });

    it('assertTenantMatch should throw TenantIsolationViolationException on mismatch', () => {
      const t1 = '11111111-1111-1111-1111-111111111111';
      const t2 = '22222222-2222-2222-2222-222222222222';

      expect(() => assertTenantMatch(t1, t1)).not.toThrow();
      expect(() => assertTenantMatch(t1, t2)).toThrow(TenantIsolationViolationException);
    });
  });

  describe('4. Authentication & RBAC Matrix Boundary Verification', () => {
    const testSecret = 'challenge-test-secret-at-least-32-chars-long-1234';

    it('should sign and verify valid JWT tokens', () => {
      const payload = {
        sub: '00000000-0000-0000-0000-000000000001',
        email: 'auditor@customer.corp',
        organizationId: '11111111-1111-1111-1111-111111111111',
        role: 'AUDITOR',
      };

      const token = signAuthToken(payload, testSecret, '1h');
      const verified = verifyAuthToken(token, testSecret);
      expect(verified.sub).toBe(payload.sub);
      expect(verified.organizationId).toBe(payload.organizationId);
      expect(verified.role).toBe(payload.role);
    });

    it('should reject tokens signed with a different secret', () => {
      const token = signAuthToken({
        sub: 'user-1',
        email: 'user@corp.com',
        organizationId: 'org-1',
        role: 'VIEWER',
      }, 'secret-A-must-be-at-least-32-characters-123');

      expect(() =>
        verifyAuthToken(token, 'secret-B-must-be-at-least-32-characters-456')
      ).toThrow();
    });

    it('should strictly deny unauthorized operations across RBAC roles', () => {
      // VIEWER cannot run analyses or delete projects
      expect(hasPermission('VIEWER', PERMISSIONS.ANALYSIS_RUN)).toBe(false);
      expect(hasPermission('VIEWER', PERMISSIONS.PROJECT_DELETE)).toBe(false);
      expect(hasPermission('VIEWER', PERMISSIONS.PROJECT_VIEW)).toBe(true);

      // AUDITOR cannot trigger analysis or mutate projects
      expect(hasPermission('AUDITOR', PERMISSIONS.ANALYSIS_RUN)).toBe(false);
      expect(hasPermission('AUDITOR', PERMISSIONS.PROJECT_CREATE)).toBe(false);
      expect(hasPermission('AUDITOR', PERMISSIONS.REPORT_EXPORT)).toBe(true);

      // MIGRATION_CONSULTANT can run analysis but cannot delete projects
      expect(hasPermission('MIGRATION_CONSULTANT', PERMISSIONS.ANALYSIS_RUN)).toBe(true);
      expect(hasPermission('MIGRATION_CONSULTANT', PERMISSIONS.PROJECT_DELETE)).toBe(false);

      // ORGANIZATION_OWNER has full rights
      expect(hasPermission('ORGANIZATION_OWNER', PERMISSIONS.PROJECT_DELETE)).toBe(true);
      expect(hasPermission('ORGANIZATION_OWNER', PERMISSIONS.SETTINGS_MANAGE)).toBe(true);
    });
  });
});
