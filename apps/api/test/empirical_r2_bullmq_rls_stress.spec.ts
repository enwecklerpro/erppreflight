import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobsService, TriggerAnalysisDto } from '../src/modules/jobs/jobs.service';
import { AnalysisProcessor, AnalysisJobData } from '../src/modules/jobs/analysis.processor';
import { DatabaseService } from '../src/modules/database/database.service';
import { S3StorageService } from '../src/modules/storage/s3-storage.service';
import { ConfigService } from '@nestjs/config';
import { EngineType, TargetRelease, ArtifactType } from '@erppreflight/schemas';
import { Readable } from 'node:stream';
import { Job, Queue } from 'bullmq';

describe('Empirical Challenger 2: R2 (BullMQ Pipeline & Tenant RLS Stress)', () => {
  let mockDb: any;
  let mockQueue: any;
  let mockConfig: any;
  let mockStorage: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      get: vi.fn((key: string, defaultVal?: string) => {
        if (key === 'ANALYSIS_SERVICE_URL') return 'http://analysis-test:8000';
        return defaultVal;
      }),
    };

    mockQueue = {
      add: vi.fn().mockResolvedValue({ id: 'bullmq-job-1' }),
    };

    mockStorage = {
      getCleanStream: vi.fn(),
    };
  });

  // ==========================================================================
  // 1. BullMQ Queue Submission & Durability Options (JobsService)
  // ==========================================================================
  describe('JobsService.triggerAnalysis BullMQ Enqueueing & Options', () => {
    it('enqueues job to analysis-queue with exponential backoff and durability options', async () => {
      const dbQueries: Array<{ text: string; params: any[]; options: any }> = [];

      mockDb = {
        query: vi.fn().mockImplementation(async (text, params, options) => {
          dbQueries.push({ text, params, options });
          return { rows: [] };
        }),
      };

      const jobsService = new JobsService(mockDb, mockConfig, mockQueue as unknown as Queue);

      const orgId = '11111111-1111-4111-8111-111111111111';
      const projId = '22222222-2222-4222-8222-222222222222';
      const userId = '33333333-3333-4333-8333-333333333333';

      const dto: TriggerAnalysisDto = {
        projectId: projId,
        engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'],
        targetRelease: 'S4H_2023',
        artifactS3Key: 'artifacts/opd.xml',
        artifactType: 'XML',
        configuration: { customParam: 'test' },
      };

      const result = await jobsService.triggerAnalysis(orgId, userId, dto);

      // 1. Immediately returns HTTP 202-style queued status
      expect(result.status).toBe('QUEUED');
      expect(result.analysisId).toBeDefined();
      expect(result.engineTypes).toEqual(dto.engineTypes);
      expect(result.targetRelease).toBe('S4H_2023');

      // 2. Inserts analyses record with QUEUED status and tenant context
      expect(mockDb.query).toHaveBeenCalled();
      const insertQuery = dbQueries.find((q) => q.text.includes("VALUES ($1, $2, $3, 'QUEUED'")) || dbQueries[0];
      expect(insertQuery).toBeDefined();
      expect(insertQuery.text).toContain("VALUES ($1, $2, $3, 'QUEUED', $4, $5, $6)");
      expect(insertQuery.params[0]).toBe(result.analysisId);
      expect(insertQuery.params[1]).toBe(orgId);
      expect(insertQuery.params[2]).toBe(projId);
      expect(insertQuery.options).toEqual({ tenantId: orgId });

      // 3. Dispatches job to BullMQ queue with exact required durability options
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [jobName, jobData, jobOptions] = mockQueue.add.mock.calls[0];

      expect(jobName).toBe('analyze');
      expect(jobData).toEqual({
        analysisId: result.analysisId,
        organizationId: orgId,
        projectId: projId,
        userId: userId,
        engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'],
        targetRelease: 'S4H_2023',
        artifactS3Key: 'artifacts/opd.xml',
        artifactType: 'XML',
        rawContent: null,
        configuration: {
          customParam: 'test',
          deterministicOnly: false,
          allowAiAssistance: true,
        },
      });

      // Assert BullMQ retry & retention options:
      // attempts: 3, exponential backoff, removeOnComplete: 100, removeOnFail: 500
      expect(jobOptions).toBeDefined();
      expect(jobOptions.attempts).toBe(3);
      expect(jobOptions.backoff).toEqual({ type: 'exponential', delay: 1000 });
      expect(jobOptions.removeOnComplete).toBe(100);
      expect(jobOptions.removeOnFail).toBe(500);
    });

    it('falls back to asynchronous direct run when BullMQ queue is not injected', async () => {
      mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };

      // No queue injected
      const jobsService = new JobsService(mockDb, mockConfig, undefined);

      const orgId = '11111111-1111-4111-8111-111111111119';
      const projId = '22222222-2222-4222-8222-222222222229';
      const userId = '33333333-3333-4333-8333-333333333339';

      const dto: TriggerAnalysisDto = {
        projectId: projId,
        engineTypes: ['OPD_GUARD'],
      };

      const result = await jobsService.triggerAnalysis(orgId, userId, dto);

      expect(result.status).toBe('QUEUED');
      expect(result.analysisId).toBeDefined();
      // Should insert record
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO analyses'),
        expect.any(Array),
        { tenantId: orgId }
      );
    });
  });

  // ==========================================================================
  // 2. BullMQ Worker Status Transitions & Error Handling (AnalysisProcessor)
  // ==========================================================================
  describe('AnalysisProcessor Status Transitions & S3 Ingestion', () => {
    it('transitions status from initial -> RUNNING -> COMPLETED on successful engine execution', async () => {
      const executedQueries: Array<{ text: string; params?: any[]; options?: any }> = [];

      mockDb = {
        query: vi.fn().mockImplementation(async (text, params, options) => {
          executedQueries.push({ text, params, options });
          return { rows: [] };
        }),
        withTenantTransaction: vi.fn().mockImplementation(async (tenantId, cb) => {
          const mockClient = {
            query: vi.fn().mockImplementation(async (text, params) => {
              executedQueries.push({ text, params, options: { txTenant: tenantId } });
              return { rows: [] };
            }),
          };
          return await cb(mockClient);
        }),
      };

      // Mock S3 stream
      const sampleXml = '<OutputParameterDetermination></OutputParameterDetermination>';
      mockStorage.getCleanStream.mockResolvedValue(Readable.from([sampleXml]));

      const analysisId = 'a1111111-1111-4111-8111-111111111111';
      const organizationId = 'b2222222-2222-4222-8222-222222222222';
      const projectId = 'c3333333-3333-4333-8333-333333333333';
      const userId = 'd4444444-4444-4444-8444-444444444444';

      // Mock Python microservice fetch response
      const mockPythonResponse = {
        job_id: analysisId,
        engine_type: 'OPD_GUARD',
        status: 'COMPLETED',
        findings: [
          {
            id: 'e5555555-5555-4555-8555-555555555555',
            ruleId: 'OPD_DETERMINATION_STEP_MISSING',
            severity: 'CRITICAL',
            category: 'Output Determination',
            title: 'Channel missing',
            description: 'No matching rule',
            confidence: 'VERIFIED',
            confidenceScore: 1.0,
            remediation: 'Add rule',
            affectedObjects: [{ name: 'OPD_STEP_CHANNEL' }],
            evidence: [
              {
                id: 'f6666666-6666-4666-8666-666666666666',
                artifactPath: 'artifacts/opd.xml#Channel',
                lineNumber: 23,
                sha256: 'a'.repeat(64),
                provenance: 'VERIFIED',
                trustScore: 1.0,
              },
            ],
          },
        ],
        metrics: { rules_evaluated: 10, artifacts_scanned: 1 },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockPythonResponse,
      });

      const processor = new AnalysisProcessor(mockDb, mockStorage, mockConfig);

      const job: Partial<Job<AnalysisJobData>> = {
        data: {
          analysisId,
          organizationId,
          projectId,
          userId,
          engineTypes: ['OPD_GUARD'],
          targetRelease: 'S4H_2023',
          artifactS3Key: 'tenants/tenant-acme/clean/opd.xml',
          rawContent: null,
          configuration: {},
        },
      };

      await processor.process(job as Job<AnalysisJobData>);

      // Step 1: Status must transition to RUNNING with tenantId
      const runningUpdate = executedQueries.find(
        (q) => q.text.includes("UPDATE analyses SET status = 'RUNNING'")
      );
      expect(runningUpdate).toBeDefined();
      expect(runningUpdate?.params).toEqual([analysisId, organizationId]);
      expect(runningUpdate?.options).toEqual({ tenantId: organizationId });

      // Step 2: Clean artifact fetched from S3
      expect(mockStorage.getCleanStream).toHaveBeenCalledWith(
        'tenants/tenant-acme/clean/opd.xml'
      );

      // Step 3: Python microservice called with tenant header
      expect(global.fetch).toHaveBeenCalledWith(
        'http://analysis-test:8000/api/v1/analyze',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Tenant-Id': organizationId,
          }),
        })
      );

      // Step 4: Findings persisted via withTenantTransaction
      expect(mockDb.withTenantTransaction).toHaveBeenCalledWith(
        organizationId,
        expect.any(Function)
      );

      // Step 5: Final status transition to COMPLETED
      const completedUpdate = executedQueries.find(
        (q) => q.text.includes("UPDATE analyses SET status = $1, completed_at = NOW()")
      );
      expect(completedUpdate).toBeDefined();
      expect(completedUpdate?.params).toEqual(['COMPLETED', analysisId, organizationId]);
      expect(completedUpdate?.options).toEqual({ tenantId: organizationId });
    });

    it('transitions status to PARTIAL when some engines succeed and others fail', async () => {
      const executedQueries: Array<{ text: string; params?: any[] }> = [];

      mockDb = {
        query: vi.fn().mockImplementation(async (text, params) => {
          executedQueries.push({ text, params });
          return { rows: [] };
        }),
        withTenantTransaction: vi.fn().mockImplementation(async (tenantId, cb) => {
          return await cb({ query: vi.fn().mockResolvedValue({ rows: [] }) });
        }),
      };

      const analysisId = 'a1111111-1111-4111-8111-111111111112';
      const organizationId = 'b2222222-2222-4222-8222-222222222223';
      const projectId = 'c3333333-3333-4333-8333-333333333334';
      const userId = 'd4444444-4444-4444-8444-444444444445';

      // Engine 1 succeeds, Engine 2 fails with HTTP 500
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              job_id: analysisId,
              engine_type: 'OPD_GUARD',
              status: 'COMPLETED',
              findings: [],
              metrics: { rules_evaluated: 5, artifacts_scanned: 1 },
            }),
          };
        }
        return {
          ok: false,
          status: 500,
          text: async () => 'Internal Error in Engine 2',
        };
      });

      const processor = new AnalysisProcessor(mockDb, mockStorage, mockConfig);

      const job: Partial<Job<AnalysisJobData>> = {
        data: {
          analysisId,
          organizationId,
          projectId,
          userId,
          engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'],
          targetRelease: 'S4H_2023',
          rawContent: '<xml></xml>',
        },
      };

      await processor.process(job as Job<AnalysisJobData>);

      // Final status must be PARTIAL
      const finalUpdate = executedQueries.find(
        (q) => q.text.includes('UPDATE analyses SET status = $1') && q.params?.[0] === 'PARTIAL'
      );
      expect(finalUpdate).toBeDefined();
    });

    it('transitions status to FAILED and rethrows error when unhandled error occurs', async () => {
      const analysisId = 'a1111111-1111-4111-8111-111111111113';
      const organizationId = 'b2222222-2222-4222-8222-222222222224';
      const projectId = 'c3333333-3333-4333-8333-333333333335';
      const userId = 'd4444444-4444-4444-8444-444444444446';

      mockDb = {
        query: vi.fn().mockImplementation(async (text) => {
          if (text.includes("UPDATE analyses SET status = 'RUNNING'")) {
            throw new Error('Database connection killed');
          }
          return { rows: [] };
        }),
      };

      const processor = new AnalysisProcessor(mockDb, mockStorage, mockConfig);

      const job: Partial<Job<AnalysisJobData>> = {
        data: {
          analysisId,
          organizationId,
          projectId,
          userId,
          engineTypes: ['OPD_GUARD'],
          targetRelease: 'S4H_2023',
        },
      };

      // Must rethrow so BullMQ catches failure and executes exponential retry
      await expect(processor.process(job as Job<AnalysisJobData>)).rejects.toThrow(
        'Database connection killed'
      );

      // Must attempt to set status to FAILED
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE analyses SET status = 'FAILED'"),
        [analysisId, organizationId],
        { tenantId: organizationId }
      );
    });
  });

  // ==========================================================================
  // 3. PostgreSQL RLS Isolation & Transaction Boundary
  // ==========================================================================
  describe('PostgreSQL RLS Transaction Boundary & Tenant Isolation', () => {
    it('strictly isolates tenant finding insertion within withTenantTransaction', async () => {
      const analysisId = 'a1111111-1111-4111-8111-111111111114';
      const organizationId = 'b2222222-2222-4222-8222-222222222225';
      const projectId = 'c3333333-3333-4333-8333-333333333336';
      const userId = 'd4444444-4444-4444-8444-444444444447';
      const findingId = 'e5555555-5555-4555-8555-555555555556';

      // Simulate real DatabaseService behavior with client set_config tracking
      class FakeClient {
        public inTransaction = false;
        public currentTenant: string | null = null;
        public queries: string[] = [];

        async query(text: string, params: any[] = []): Promise<any> {
          this.queries.push(text);
          if (text === 'BEGIN') {
            this.inTransaction = true;
          } else if (text === 'COMMIT' || text === 'ROLLBACK') {
            this.inTransaction = false;
            this.currentTenant = null; // Reverts on end of transaction
          } else if (text.includes("set_config('app.current_tenant_id'")) {
            this.currentTenant = params[0];
          } else if (text.includes('INSERT INTO findings')) {
            // Check that RLS tenant matches organization_id param!
            const orgIdParam = params[1];
            if (this.currentTenant !== orgIdParam) {
              throw new Error(
                `RLS VIOLATION: Transaction tenant '${this.currentTenant}' does not match finding org '${orgIdParam}'`
              );
            }
          }
          return { rows: [] };
        }
      }

      const client = new FakeClient();

      mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        withTenantTransaction: vi.fn().mockImplementation(async (tenantId, cb) => {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
          try {
            const res = await cb(client);
            await client.query('COMMIT');
            return res;
          } catch (e) {
            await client.query('ROLLBACK');
            throw e;
          }
        }),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          job_id: analysisId,
          engine_type: 'OPD_GUARD',
          status: 'COMPLETED',
          findings: [
            {
              id: findingId,
              ruleId: 'OPD_DETERMINATION_STEP_MISSING',
              severity: 'MAJOR',
              category: 'Output Determination',
              title: 'Step missing',
              description: 'Desc',
              confidence: 'VERIFIED',
              confidenceScore: 1.0,
              remediation: 'Fix',
              affectedObjects: [],
              evidence: [],
            },
          ],
        }),
      });

      const processor = new AnalysisProcessor(mockDb, mockStorage, mockConfig);

      const job: Partial<Job<AnalysisJobData>> = {
        data: {
          analysisId,
          organizationId,
          projectId,
          userId,
          engineTypes: ['OPD_GUARD'],
          targetRelease: 'S4H_2023',
          rawContent: '<xml></xml>',
        },
      };

      await processor.process(job as Job<AnalysisJobData>);

      // Verify transaction boundary
      expect(client.queries).toContain('BEGIN');
      expect(client.queries).toContain("SELECT set_config('app.current_tenant_id', $1, true)");
      expect(client.queries).toContain('COMMIT');
      expect(client.inTransaction).toBe(false);
      expect(client.currentTenant).toBeNull(); // Reset after commit!
    });

    it('reverts transaction and rolls back when finding persistence throws error', async () => {
      const analysisId = 'a1111111-1111-4111-8111-111111111115';
      const organizationId = 'b2222222-2222-4222-8222-222222222226';
      const projectId = 'c3333333-3333-4333-8333-333333333337';
      const userId = 'd4444444-4444-4444-8444-444444444448';
      const findingId = 'e5555555-5555-4555-8555-555555555557';

      let rolledBack = false;

      mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        withTenantTransaction: vi.fn().mockImplementation(async (tenantId, cb) => {
          try {
            const fakeClient = {
              query: vi.fn().mockRejectedValue(new Error('PostgreSQL Unique Constraint Violation')),
            };
            return await cb(fakeClient);
          } catch (err) {
            rolledBack = true;
            throw err;
          }
        }),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          job_id: analysisId,
          engine_type: 'OPD_GUARD',
          status: 'COMPLETED',
          findings: [
            {
              id: findingId,
              ruleId: 'TEST_RULE',
              severity: 'MAJOR',
              category: 'Category',
              title: 'Title',
              description: 'Desc',
              confidence: 'VERIFIED',
              confidenceScore: 1.0,
              remediation: 'Remedy',
              affectedObjects: [],
              evidence: [],
            },
          ],
        }),
      });

      const processor = new AnalysisProcessor(mockDb, mockStorage, mockConfig);

      const job: Partial<Job<AnalysisJobData>> = {
        data: {
          analysisId,
          organizationId,
          projectId,
          userId,
          engineTypes: ['OPD_GUARD'],
          targetRelease: 'S4H_2023',
          rawContent: '<xml></xml>',
        },
      };

      // Processor catches the engine error, logs warning, and completes (or marks failed engines)
      await processor.process(job as Job<AnalysisJobData>);

      // withTenantTransaction caught error and rolled back
      expect(rolledBack).toBe(true);
    });
  });
});
