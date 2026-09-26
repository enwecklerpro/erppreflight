import { Injectable, Logger, Optional, ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

/**
 * Client for the analysis service's rule inventory and deterministic self-test
 * (GET /api/v1/engines, GET /api/v1/rules/golden-coverage, POST /api/v1/rules/{code}/self-test).
 * Every response is validated with Zod: the Rule Admin publish gate must never act on
 * a malformed verdict.
 */
const RuleEntrySchema = z
  .object({
    code: z.string(),
    title: z.string(),
    defaultSeverity: z.string(),
    category: z.string().optional().default(''),
    remediation: z.string().optional().default(''),
    version: z.string().nullable(),
  })
  .passthrough();

const EngineEntrySchema = z
  .object({
    engine_type: z.string(),
    name: z.string(),
    version: z.string(),
    domain: z.string().optional().default(''),
    rules: z.array(RuleEntrySchema).default([]),
    input_validation_rule_codes: z.array(z.string()).default([]),
  })
  .passthrough();

const CoverageRuleSchema = z.object({
  ruleCode: z.string(),
  engineType: z.string(),
  ruleVersion: z.string().nullable(),
  inputValidationRule: z.boolean(),
  positiveCases: z.array(z.string()),
  negativeCases: z.array(z.string()),
  covered: z.boolean(),
  gap: z.string().nullable(),
});

const CoverageSchema = z.object({
  manifestVersion: z.string(),
  totalCases: z.number().int(),
  summary: z.record(z.number()),
  rules: z.array(CoverageRuleSchema),
});

const CaseOutcomeSchema = z.object({
  caseId: z.string(),
  kind: z.enum(['POSITIVE', 'NEGATIVE']),
  fixture: z.string(),
  fixtureSha256: z.string(),
  status: z.string(),
  emittedCodes: z.array(z.string()),
  findingsDigest: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});

export const SelfTestResultSchema = z.object({
  ruleCode: z.string(),
  engineType: z.string(),
  engineVersion: z.string(),
  ruleVersion: z.string(),
  manifestVersion: z.string(),
  status: z.enum(['PASSED', 'FAILED', 'NO_FIXTURES', 'ERROR']),
  passed: z.boolean(),
  coverageGap: z.string().nullable(),
  positiveCount: z.number().int().min(0),
  negativeCount: z.number().int().min(0),
  cases: z.array(CaseOutcomeSchema),
  resultDigest: z.string().regex(/^[0-9a-f]{64}$/),
  durationMs: z.number().int().min(0),
});

export type EngineCatalogEntry = z.infer<typeof EngineEntrySchema>;
export type RuleCoverage = z.infer<typeof CoverageRuleSchema>;
export type RuleCoverageReport = z.infer<typeof CoverageSchema>;
export type SelfTestResult = z.infer<typeof SelfTestResultSchema>;

const CACHE_TTL_MS = 60_000;

@Injectable()
export class AnalysisRulesClient {
  private readonly logger = new Logger(AnalysisRulesClient.name);
  private readonly baseUrl: string;
  private catalogCache: { at: number; value: EngineCatalogEntry[] } | null = null;
  private coverageCache: { at: number; value: RuleCoverageReport } | null = null;

  constructor(@Optional() config?: ConfigService) {
    this.baseUrl = (config?.get<string>('ANALYSIS_SERVICE_URL') || 'http://localhost:8000').replace(/\/+$/, '');
  }

  private async getJson(path: string, init?: RequestInit, timeoutMs = 10_000): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err: any) {
      this.logger.warn(`Analysis service unreachable (${path}): ${err?.message ?? err}`);
      throw new ServiceUnavailableException({
        message: 'The analysis service is not reachable; rule data is unavailable.',
        code: 'ANALYSIS_SERVICE_UNAVAILABLE',
      });
    }
    if (res.status === 404) throw new NotFoundException({ message: 'Rule is not declared by any engine.', code: 'RULE_NOT_FOUND' });
    if (!res.ok) {
      throw new ServiceUnavailableException({
        message: `The analysis service answered HTTP ${res.status}.`,
        code: 'ANALYSIS_SERVICE_UNAVAILABLE',
      });
    }
    return res.json();
  }

  async engineCatalog(): Promise<EngineCatalogEntry[]> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < CACHE_TTL_MS) return this.catalogCache.value;
    const value = z.array(EngineEntrySchema).parse(await this.getJson('/api/v1/engines'));
    this.catalogCache = { at: Date.now(), value };
    return value;
  }

  async coverage(): Promise<RuleCoverageReport> {
    if (this.coverageCache && Date.now() - this.coverageCache.at < CACHE_TTL_MS) return this.coverageCache.value;
    const value = CoverageSchema.parse(await this.getJson('/api/v1/rules/golden-coverage'));
    this.coverageCache = { at: Date.now(), value };
    return value;
  }

  /** Runs the deterministic golden self-test of one rule (never cached). */
  async selfTest(ruleCode: string): Promise<SelfTestResult> {
    const raw = await this.getJson(`/api/v1/rules/${encodeURIComponent(ruleCode)}/self-test`, { method: 'POST' }, 120_000);
    const parsed = SelfTestResultSchema.safeParse(raw);
    if (!parsed.success || parsed.data.ruleCode !== ruleCode) {
      throw new ServiceUnavailableException({
        message: 'The analysis service returned a malformed self-test verdict.',
        code: 'SELF_TEST_MALFORMED',
      });
    }
    return parsed.data;
  }
}
