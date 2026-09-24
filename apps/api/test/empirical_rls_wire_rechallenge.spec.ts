import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { DatabasePool } from '@erppreflight/database';
import { DatabaseService } from '../src/modules/database/database.service';
import { TenancyContext } from '@erppreflight/tenancy';
import { ConfigService } from '@nestjs/config';
import {
  AnalysisJobRequestSchema,
  AnalysisJobRequestWireSchema,
  AnalysisJobResponseSchema,
  AnalysisJobResponseWireSchema,
  FindingSchema,
  FindingWireSchema,
  EvidenceItemSchema,
  EvidenceItemWireSchema,
  toWireJobRequest,
  fromWireJobRequest,
  toWireFinding,
  fromWireFinding,
  toWireJobResponse,
  fromWireJobResponse,
} from '@erppreflight/schemas';
import { createFindingFingerprint } from '@erppreflight/evidence';

// High-fidelity PostgreSQL client simulation with transaction state, savepoints, and poison tracking
class EmpiricalMockClient {
  public id: string;
  public inTransaction = false;
  public sessionVariables: Record<string, string> = {};
  public transactionVariables: Record<string, string> = {};
  public savepoints: Record<string, Record<string, string>> = {};
  public queryCount = 0;
  public released = false;
  public evictedBroken = false;
  public shouldFailRollback = false;

  constructor(id: string) {
    this.id = id;
  }

  async query(text: string, params: any[] = []): Promise<any> {
    this.queryCount++;

    if (text === 'BEGIN') {
      this.inTransaction = true;
      this.transactionVariables = { ...this.sessionVariables };
      return { rows: [] };
    }

    if (text === 'COMMIT') {
      if (!this.inTransaction) throw new Error('COMMIT called outside transaction');
      this.inTransaction = false;
      this.transactionVariables = {};
      this.savepoints = {};
      return { rows: [] };
    }

    if (text === 'ROLLBACK') {
      if (this.shouldFailRollback) {
        throw new Error('Catastrophic connection socket failure during ROLLBACK');
      }
      this.inTransaction = false;
      this.transactionVariables = {};
      this.savepoints = {};
      return { rows: [] };
    }

    if (text.startsWith('SAVEPOINT')) {
      const spName = text.split(' ')[1];
      this.savepoints[spName] = { ...this.transactionVariables };
      return { rows: [] };
    }

    if (text.startsWith('ROLLBACK TO SAVEPOINT')) {
      const spName = text.split(' ').pop() || '';
      if (this.savepoints[spName]) {
        this.transactionVariables = { ...this.savepoints[spName] };
      }
      return { rows: [] };
    }

    // Handle set_config
    const setConfigMatch = /SELECT set_config\('([^']+)',\s*\$1,\s*(\$2|true|false)\)/i.exec(text);
    if (setConfigMatch) {
      const varName = setConfigMatch[1];
      const val = params[0] || '';
      const isLocal = setConfigMatch[2] === 'true' || params[1] === true;

      if (isLocal) {
        if (!this.inTransaction) {
          // Autocommit: drops immediately!
          return { rows: [{ set_config: val }] };
        }
        this.transactionVariables[varName] = val;
      } else {
        this.sessionVariables[varName] = val;
      }
      return { rows: [{ set_config: val }] };
    }

    // Handle current_setting check
    if (text.includes("current_setting('app.current_tenant_id'")) {
      const activeVal = this.inTransaction
        ? this.transactionVariables['app.current_tenant_id'] || ''
        : this.sessionVariables['app.current_tenant_id'] || '';
      return { rows: [{ current_setting: activeVal }] };
    }

    // Simulated tenant-filtered table query
    if (text.includes('FROM projects') || text.includes('FROM findings')) {
      const currentTenant = this.inTransaction
        ? this.transactionVariables['app.current_tenant_id']
        : this.sessionVariables['app.current_tenant_id'];

      if (!currentTenant) {
        return { rows: [] };
      }
      return {
        rows: [
          { id: 'row-1', organization_id: currentTenant, data: `Data for ${currentTenant}` },
        ],
      };
    }

    return { rows: [{ healthy: 1, result: 'ok' }] };
  }

  release(errOrDestroy?: any) {
    this.released = true;
    if (errOrDestroy === true || Boolean(errOrDestroy)) {
      this.evictedBroken = true;
    }
  }
}

describe('Empirical Challenger: M1 Iteration 2 Re-Challenge', () => {
  describe('Suite 1: DatabasePool & DatabaseService RLS Scoping & Socket Lifecycle', () => {
    let mockClientPool: EmpiricalMockClient[];
    let clientCounter = 0;

    const createMockPgPool = () => {
      mockClientPool = [];
      clientCounter = 0;
      return {
        connect: vi.fn().mockImplementation(async () => {
          clientCounter++;
          const c = new EmpiricalMockClient(`client-${clientCounter}`);
          mockClientPool.push(c);
          return c;
        }),
        query: vi.fn(),
        end: vi.fn(),
      } as unknown as Pool;
    };

    it('EMPIRICAL CHALLENGE 1.1: DatabasePool.withTenantTransaction maintains context over 25 sequential queries without premature drop', async () => {
      const mockPool = createMockPgPool();
      const dbPool = new DatabasePool();
      (dbPool as any).pool = mockPool;

      const tenantId = '00000000-1111-2222-3333-444444444444';

      await dbPool.withTenantTransaction(tenantId, async (client) => {
        for (let i = 1; i <= 25; i++) {
          const res = await client.query("SELECT current_setting('app.current_tenant_id', true)");
          expect(res.rows[0].current_setting).toBe(tenantId);

          const projectRes = await client.query('SELECT * FROM projects');
          expect(projectRes.rows.length).toBe(1);
          expect(projectRes.rows[0].organization_id).toBe(tenantId);
        }
      });

      const client = mockClientPool[0];
      expect(client.released).toBe(true);
      expect(client.inTransaction).toBe(false);
      // Clean after commit
      expect(client.transactionVariables['app.current_tenant_id']).toBeUndefined();
    });

    it('EMPIRICAL CHALLENGE 1.2: DatabaseService.withTenantTransaction preserves SET LOCAL across SAVEPOINT and partial rollback', async () => {
      const mockPool = createMockPgPool();
      const mockConfig = { get: vi.fn().mockReturnValue('postgres://fake') } as unknown as ConfigService;
      const dbService = new DatabaseService(mockConfig);
      (dbService as any).pool = mockPool;

      const tenantId = 'aaaa0000-bbbb-cccc-dddd-eeee11112222';

      await dbService.withTenantTransaction(tenantId, async (client) => {
        // Query before savepoint
        const pre = await client.query("SELECT current_setting('app.current_tenant_id', true)");
        expect(pre.rows[0].current_setting).toBe(tenantId);

        // Create savepoint
        await client.query('SAVEPOINT sp_test');

        // Rollback to savepoint
        await client.query('ROLLBACK TO SAVEPOINT sp_test');

        // Verify SET LOCAL is NOT lost after savepoint rollback
        const post = await client.query("SELECT current_setting('app.current_tenant_id', true)");
        expect(post.rows[0].current_setting).toBe(tenantId);
      });
    });

    it('EMPIRICAL CHALLENGE 1.3: Poisoned socket eviction on rollback failure in DatabasePool and DatabaseService', async () => {
      // Test DatabasePool eviction
      const mockPool1 = createMockPgPool();
      const dbPool = new DatabasePool();
      (dbPool as any).pool = mockPool1;

      let clientRef1: EmpiricalMockClient | null = null;
      await expect(
        dbPool.withTenantTransaction('tenant-fail-pool', async (client) => {
          clientRef1 = client as unknown as EmpiricalMockClient;
          clientRef1.shouldFailRollback = true;
          throw new Error('Application error triggering rollback failure');
        })
      ).rejects.toThrow('Application error triggering rollback failure');

      expect(clientRef1).not.toBeNull();
      expect(clientRef1!.evictedBroken).toBe(true);
      expect(clientRef1!.released).toBe(true);

      // Test DatabaseService eviction
      const mockPool2 = createMockPgPool();
      const mockConfig = { get: vi.fn().mockReturnValue('postgres://fake') } as unknown as ConfigService;
      const dbService = new DatabaseService(mockConfig);
      (dbService as any).pool = mockPool2;

      let clientRef2: EmpiricalMockClient | null = null;
      await expect(
        dbService.withTenantTransaction('tenant-fail-svc', async (client) => {
          clientRef2 = client as unknown as EmpiricalMockClient;
          clientRef2.shouldFailRollback = true;
          throw new Error('Application error triggering rollback failure in service');
        })
      ).rejects.toThrow('Application error triggering rollback failure in service');

      expect(clientRef2).not.toBeNull();
      expect(clientRef2!.evictedBroken).toBe(true);
      expect(clientRef2!.released).toBe(true);
    });

    it('EMPIRICAL CHALLENGE 1.4: Cross-tenant connection recycling stress test (100 interleaved runs)', async () => {
      const mockPool = createMockPgPool();
      const dbPool = new DatabasePool();
      (dbPool as any).pool = mockPool;

      const tenantIds = [
        'tenant-alpha-001',
        'tenant-bravo-002',
        'tenant-charlie-003',
        'tenant-delta-004',
        'tenant-echo-005',
      ];

      // Run 100 interleaved operations
      const promises = Array.from({ length: 100 }, (_, idx) => {
        const expectedTenant = tenantIds[idx % tenantIds.length];
        return dbPool.withTenantTransaction(expectedTenant, async (client) => {
          await new Promise((r) => setTimeout(r, Math.random() * 5));
          const check = await client.query("SELECT current_setting('app.current_tenant_id', true)");
          expect(check.rows[0].current_setting).toBe(expectedTenant);
          const data = await client.query('SELECT * FROM projects');
          expect(data.rows[0].organization_id).toBe(expectedTenant);
          return { expectedTenant, actualTenant: check.rows[0].current_setting };
        });
      });

      const results = await Promise.all(promises);
      expect(results.length).toBe(100);
      for (const res of results) {
        expect(res.actualTenant).toBe(res.expectedTenant);
      }
    });

    it('EMPIRICAL CHALLENGE 1.5: Validation on invalid or empty tenantId parameters', async () => {
      const mockPool = createMockPgPool();
      const dbPool = new DatabasePool();
      (dbPool as any).pool = mockPool;

      // Empty string
      await expect(dbPool.withTenantTransaction('', async () => {})).rejects.toThrow(
        /tenantId is required/
      );

      // Missing TenancyContext
      await expect(
        dbPool.withTenantTransaction(async () => {})
      ).rejects.toThrow();

      // Ensure no client was connected from pool on immediate validation failure
      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('EMPIRICAL CHALLENGE 1.6: Automatic transaction wrapping in query() vs bypassRls', async () => {
      const mockPool = createMockPgPool();
      const dbPool = new DatabasePool();
      (dbPool as any).pool = mockPool;

      const tenantId = 'auto-wrap-tenant-uuid';

      // 1. query() with active context wraps in transaction
      await TenancyContext.run({ tenantId }, async () => {
        const res = await dbPool.query('SELECT * FROM projects');
        expect(res.rows[0].organization_id).toBe(tenantId);
      });

      // 2. query() with bypassRls does NOT wrap in tenant transaction
      await TenancyContext.run({ tenantId }, async () => {
        const res = await dbPool.query('SELECT 1 as healthy', [], { bypassRls: true });
        expect(res.rows[0].healthy).toBe(1);
      });
    });

    it('EMPIRICAL CHALLENGE 1.7: DatabasePool.withTenantTransaction automatically retrieves tenantId from TenancyContext when omitted', async () => {
      const mockPool = createMockPgPool();
      const dbPool = new DatabasePool();
      (dbPool as any).pool = mockPool;

      const tenantId = 'context-resolved-uuid-pool';

      await TenancyContext.run({ tenantId }, async () => {
        const res = await dbPool.withTenantTransaction(async (client) => {
          const check = await client.query("SELECT current_setting('app.current_tenant_id', true)");
          return check.rows[0].current_setting;
        });
        expect(res).toBe(tenantId);
      });
    });

    it('EMPIRICAL CHALLENGE 1.8: Nested withTenantTransaction executions maintain distinct isolated client sessions', async () => {
      const mockPool = createMockPgPool();
      const dbPool = new DatabasePool();
      (dbPool as any).pool = mockPool;

      const tenantOuter = 'outer-tenant-111';
      const tenantInner = 'inner-tenant-222';

      await dbPool.withTenantTransaction(tenantOuter, async (outerClient) => {
        const outerCheck1 = await outerClient.query("SELECT current_setting('app.current_tenant_id', true)");
        expect(outerCheck1.rows[0].current_setting).toBe(tenantOuter);

        // Nested call with a different tenant checks out a distinct client
        await dbPool.withTenantTransaction(tenantInner, async (innerClient) => {
          expect(innerClient).not.toBe(outerClient);
          const innerCheck = await innerClient.query("SELECT current_setting('app.current_tenant_id', true)");
          expect(innerCheck.rows[0].current_setting).toBe(tenantInner);
        });

        // After inner transaction completes, outer client still has outer tenant
        const outerCheck2 = await outerClient.query("SELECT current_setting('app.current_tenant_id', true)");
        expect(outerCheck2.rows[0].current_setting).toBe(tenantOuter);
      });
    });
  });

  describe('Suite 2: Dual-Case Wire Serialization & JobsService Ingestion', () => {
    it('EMPIRICAL CHALLENGE 2.1: Dual-case AnalysisJobRequest parsing (camelCase, snake_case, and mixed)', () => {
      const camelCasePayload = {
        jobId: '12345678-1234-1234-1234-123456789abc',
        tenantId: '87654321-4321-4321-4321-cba987654321',
        projectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        engineType: 'OPD_GUARD',
        targetRelease: 'S4H_2023',
        artifactS3Key: 'path/to/artifact.xml',
        artifactType: 'XML',
        configuration: { customParam: true },
        rawContent: '<xml></xml>',
      };

      const snakeCasePayload = {
        job_id: '12345678-1234-1234-1234-123456789abc',
        tenant_id: '87654321-4321-4321-4321-cba987654321',
        project_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        engine_type: 'OPD_GUARD',
        target_release: 'S4H_2023',
        artifact_s3_key: 'path/to/artifact.xml',
        artifact_type: 'XML',
        configuration: { customParam: true },
        raw_content: '<xml></xml>',
      };

      const mixedPayload = {
        job_id: '12345678-1234-1234-1234-123456789abc',
        tenantId: '87654321-4321-4321-4321-cba987654321',
        projectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        engine_type: 'OPD_GUARD',
      };

      // Both must parse successfully into canonical camelCase AnalysisJobRequest
      const parsed1 = AnalysisJobRequestSchema.parse(camelCasePayload);
      const parsed2 = AnalysisJobRequestSchema.parse(snakeCasePayload);
      const parsed3 = AnalysisJobRequestSchema.parse(mixedPayload);

      expect(parsed1.jobId).toBe('12345678-1234-1234-1234-123456789abc');
      expect(parsed2.jobId).toBe('12345678-1234-1234-1234-123456789abc');
      expect(parsed3.jobId).toBe('12345678-1234-1234-1234-123456789abc');

      expect(parsed1.tenantId).toBe('87654321-4321-4321-4321-cba987654321');
      expect(parsed2.tenantId).toBe('87654321-4321-4321-4321-cba987654321');
      expect(parsed3.tenantId).toBe('87654321-4321-4321-4321-cba987654321');

      // Wire schema must output pure snake_case
      const wire1 = toWireJobRequest(parsed1);
      expect(wire1.job_id).toBe('12345678-1234-1234-1234-123456789abc');
      expect(wire1.tenant_id).toBe('87654321-4321-4321-4321-cba987654321');
      expect(wire1.engine_type).toBe('OPD_GUARD');
      expect((wire1 as any).jobId).toBeUndefined();
    });

    it('EMPIRICAL CHALLENGE 2.2: FindingSchema handles polymorphic affected_objects (strings, objects, JSON-stringified)', () => {
      const validSha = 'a'.repeat(64);

      // Case A: string[] from Python engine
      const pyFinding = {
        id: '11111111-1111-1111-1111-111111111111',
        rule_id: 'RULE_01',
        severity: 'CRITICAL',
        category: 'CLEAN_CORE',
        title: 'Direct Table Access',
        description: 'Direct access to MARA',
        confidence: 'VERIFIED',
        confidence_score: 1.0,
        remediation: 'Use released CDS view',
        affected_objects: ['MARA', 'VBAK'],
        evidence: [{ artifact_path: 'code.abap', sha256: validSha }],
      };

      const parsedA = FindingSchema.parse(pyFinding);
      expect(parsedA.affectedObjects).toHaveLength(2);
      expect(parsedA.affectedObjects[0].name).toBe('MARA');
      expect(parsedA.affectedObjects[1].name).toBe('VBAK');

      // Case B: AffectedObject[] with metadata
      const objFinding = {
        ...pyFinding,
        affected_objects: [
          { name: 'Z_CUSTOM_PROG', type: 'PROGRAM', package: 'ZPACKAGE', tier: 'TIER_2_DEVELOPER' },
        ],
      };
      const parsedB = FindingSchema.parse(objFinding);
      expect(parsedB.affectedObjects[0].name).toBe('Z_CUSTOM_PROG');
      expect(parsedB.affectedObjects[0].type).toBe('PROGRAM');
      expect(parsedB.affectedObjects[0].tier).toBe('TIER_2_DEVELOPER');

      // Case B.2: Invalid tier enum is strictly rejected
      const invalidTierFinding = {
        ...pyFinding,
        affected_objects: [
          { name: 'Z_INVALID', type: 'PROGRAM', tier: 'INVALID_TIER' },
        ],
      };
      expect(() => FindingSchema.parse(invalidTierFinding)).toThrow();

      // Case C: JSON stringified string array (from PostgreSQL JSON column)
      const dbFinding = {
        ...pyFinding,
        affected_objects: '["BAPI_USER_GET_DETAIL", "RFC_READ_TABLE"]',
        technical_details: '{"subsystem": "AUTH"}',
      };
      const parsedC = FindingSchema.parse(dbFinding);
      expect(parsedC.affectedObjects).toHaveLength(2);
      expect(parsedC.affectedObjects[0].name).toBe('BAPI_USER_GET_DETAIL');
      expect(parsedC.technicalDetails).toEqual({ subsystem: 'AUTH' });
    });

    it('EMPIRICAL CHALLENGE 2.3: Database numeric string to float conversion in FindingSchema', () => {
      const validSha = 'b'.repeat(64);
      const dbRow = {
        id: '22222222-2222-2222-2222-222222222222',
        rule_id: 'RULE_02',
        severity: 'MAJOR',
        title: 'Title',
        description: 'Desc',
        confidence_class: 'RULE_DERIVED',
        confidence_score: '0.85', // pg returns numeric columns as strings!
        remediation: 'Fix it',
        evidence: [{ artifact_path: 'file.txt', sha256: validSha }],
      };

      const parsed = FindingSchema.parse(dbRow);
      expect(parsed.confidence).toBe('RULE_DERIVED');
      expect(parsed.confidenceScore).toBe(0.85);
      expect(typeof parsed.confidenceScore).toBe('number');
    });

    it('EMPIRICAL CHALLENGE 2.4: Bidirectional converter round-trip fidelity', () => {
      const validSha = 'c'.repeat(64);
      const original = {
        job_id: '33333333-3333-3333-3333-333333333333',
        tenant_id: '44444444-4444-4444-4444-444444444444',
        project_id: '55555555-5555-5555-5555-555555555555',
        engine_type: 'FORM_DOCTOR',
        target_release: 'S4H_2023',
        artifact_s3_key: 'forms/invoice.xdp',
        artifact_type: 'XDP',
        configuration: { strict: true },
        raw_content: null,
      };

      const wire = toWireJobRequest(original);
      const internal = fromWireJobRequest(wire);
      const roundTripWire = toWireJobRequest(internal);

      expect(roundTripWire).toEqual(wire);
      expect(internal.engineType).toBe('FORM_DOCTOR');
      expect(internal.artifactType).toBe('XDP');
    });

    it('EMPIRICAL CHALLENGE 2.5: JobsService payload parsing safety with empty arrays and boundary findings', () => {
      const pythonResponseJson = {
        job_id: '66666666-6666-6666-6666-666666666666',
        engine_type: 'CLEAN_CORE_OBJECT_GUARD',
        status: 'COMPLETED',
        findings: [
          {
            id: '77777777-7777-7777-7777-777777777777',
            rule_id: 'CC_TIER_VIOLATION',
            severity: 'BLOCKER',
            category: 'CLEAN_CORE',
            title: 'Modification to Standard Table',
            description: 'Customer append structure on standard table',
            confidence: 'VERIFIED',
            confidence_score: 1.0,
            remediation: 'Use custom field extensibility',
            affected_objects: [], // Empty affected objects
            evidence: [],         // Empty evidence
            technical_details: {},
          },
        ],
        metrics: {
          execution_time_ms: 142,
          rules_evaluated: 12,
          artifacts_scanned: 2,
        },
      };

      const parsedResponse = AnalysisJobResponseSchema.parse(pythonResponseJson);
      expect(parsedResponse.findings.length).toBe(1);

      const f = parsedResponse.findings[0];
      // Test the exact fallback logic from jobs.service.ts lines 168-171:
      const firstObjName = f.affectedObjects[0]?.name || 'GLOBAL';
      const firstArtifact = f.evidence[0]?.artifactPath || 'UNKNOWN_SOURCE';
      const fingerprint = f.fingerprint || createFindingFingerprint(f.ruleId, firstObjName, firstArtifact);

      expect(firstObjName).toBe('GLOBAL');
      expect(firstArtifact).toBe('UNKNOWN_SOURCE');
      expect(fingerprint).toHaveLength(64);
    });

    it('EMPIRICAL CHALLENGE 2.6: EvidenceItemSchema boundary constraints and dual-case mapping', () => {
      const validHex = '0123456789abcdef0123456789ABCDEF0123456789abcdef0123456789ABCDEF';

      // 1. Valid dual-case snake_case evidence
      const snakeEvidence = {
        artifact_path: 'src/custom.abap',
        line_number: 10,
        column_number: 5,
        snippet: 'DATA: lv_test TYPE string.',
        sha256: validHex,
        provenance: 'VERIFIED',
        source_type: 'CUSTOMER_EVIDENCE',
        source_url: 'https://example.com/spec',
        trust_score: 0.95,
      };

      const parsed = EvidenceItemSchema.parse(snakeEvidence);
      expect(parsed.artifactPath).toBe('src/custom.abap');
      expect(parsed.lineNumber).toBe(10);
      expect(parsed.columnNumber).toBe(5);
      expect(parsed.sourceType).toBe('CUSTOMER_EVIDENCE');
      expect(parsed.trustScore).toBe(0.95);

      // 2. Out of bounds trustScore (> 1.0 or < 0.0)
      expect(() => EvidenceItemSchema.parse({ ...snakeEvidence, trust_score: 1.5 })).toThrow();
      expect(() => EvidenceItemSchema.parse({ ...snakeEvidence, trust_score: -0.1 })).toThrow();

      // 3. Non-positive line numbers (must be positive int)
      expect(() => EvidenceItemSchema.parse({ ...snakeEvidence, line_number: 0 })).toThrow();
      expect(() => EvidenceItemSchema.parse({ ...snakeEvidence, line_number: -5 })).toThrow();

      // 4. Invalid sourceUrl (not a valid url)
      expect(() => EvidenceItemSchema.parse({ ...snakeEvidence, source_url: 'not-a-valid-url' })).toThrow();
    });

    it('EMPIRICAL CHALLENGE 2.7: FindingSchema confidenceScore bounds and engineType nullability', () => {
      const validSha = 'd'.repeat(64);
      const base = {
        id: '99999999-9999-9999-9999-999999999999',
        rule_id: 'TEST_01',
        severity: 'INFO',
        title: 'Title',
        description: 'Desc',
        confidence: 'INFERRED',
        remediation: 'None',
        evidence: [{ artifact_path: 'a.txt', sha256: validSha }],
      };

      // 1. Out of bounds confidenceScore (> 1.0 or < 0.0)
      expect(() => FindingSchema.parse({ ...base, confidence_score: 1.01 })).toThrow();
      expect(() => FindingSchema.parse({ ...base, confidence_score: -0.01 })).toThrow();

      // 2. engineType is nullable / optional
      const withoutEngine = FindingSchema.parse({ ...base, engineType: null });
      expect(withoutEngine.engineType).toBeNull();

      const withEngine = FindingSchema.parse({ ...base, engine_type: 'MFS_BLACKBOX' });
      expect(withEngine.engineType).toBe('MFS_BLACKBOX');
    });
  });
});

