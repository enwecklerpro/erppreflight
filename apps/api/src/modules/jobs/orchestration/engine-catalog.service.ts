import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EngineTypeEnum, type EngineType } from '@erppreflight/schemas';
import { z } from 'zod';

/**
 * Client for the analysis service's engine catalog and input-contract matcher
 * (GET /api/v1/engines, POST /api/v1/contracts/match). Declared input contracts are
 * the single source for "which formats / inputs does an engine need" (Part 05 §5.1
 * "additional required inputs", §5.6 "detect relevant engines").
 */
const CatalogEntrySchema = z
  .object({
    engine_type: z.string(),
    name: z.string().optional(),
    supported_artifact_types: z.array(z.string()).optional(),
    input_contract: z
      .object({
        acceptedFormats: z.array(z.string()).default([]),
        summary: z.string().default(''),
        required: z.array(z.string()).default([]),
        notes: z.array(z.string()).default([]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ContractMatchResponseSchema = z.object({
  sniffed_format: z.string().nullable().optional(),
  matches: z.array(
    z.object({
      engine_type: z.string(),
      accepted: z.boolean(),
      code: z.string().nullable().optional(),
      message: z.string().nullable().optional(),
    })
  ),
});

export interface EngineContract {
  engine: EngineType;
  name: string;
  acceptedFormats: string[];
  summary: string;
  required: string[];
  notes: string[];
}

/** Max payload the contract matcher accepts (mirrors the analysis service limit). */
export const MAX_CONTRACT_MATCH_CHARS = 2 * 1024 * 1024;
const CATALOG_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class EngineCatalogService {
  private readonly logger = new Logger(EngineCatalogService.name);
  private readonly analysisUrl: string;
  private cache: { at: number; contracts: Map<EngineType, EngineContract> } | null = null;

  constructor(@Optional() config?: ConfigService) {
    this.analysisUrl = config?.get<string>('ANALYSIS_SERVICE_URL') || 'http://localhost:8000';
  }

  /** Engine input contracts keyed by engine, or null when the analysis service is unreachable. */
  async getContracts(): Promise<Map<EngineType, EngineContract> | null> {
    if (this.cache && Date.now() - this.cache.at < CATALOG_TTL_MS) return this.cache.contracts;
    try {
      const res = await fetch(`${this.analysisUrl}/api/v1/engines`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = z.array(CatalogEntrySchema).parse(await res.json());
      const contracts = new Map<EngineType, EngineContract>();
      for (const entry of list) {
        const engine = EngineTypeEnum.safeParse(entry.engine_type);
        if (!engine.success) continue;
        contracts.set(engine.data, {
          engine: engine.data,
          name: entry.name ?? engine.data,
          acceptedFormats: entry.input_contract?.acceptedFormats ?? entry.supported_artifact_types ?? [],
          summary: entry.input_contract?.summary ?? '',
          required: entry.input_contract?.required ?? [],
          notes: entry.input_contract?.notes ?? [],
        });
      }
      this.cache = { at: Date.now(), contracts };
      return contracts;
    } catch (err: any) {
      this.logger.warn(`Engine catalog unavailable: ${err?.message ?? err}`);
      return this.cache?.contracts ?? null;
    }
  }

  /**
   * Engines whose declared contract accepts the artifact. Returns null when the
   * matcher is unreachable or the payload exceeds its limit (callers then rely on
   * content signals only).
   */
  async matchContracts(
    rawContent: string,
    encoding: 'utf-8' | 'base64',
    fileName: string | null
  ): Promise<EngineType[] | null> {
    if (rawContent.length > MAX_CONTRACT_MATCH_CHARS) return null;
    try {
      const res = await fetch(`${this.analysisUrl}/api/v1/contracts/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ raw_content: rawContent, raw_content_encoding: encoding, file_name: fileName ?? undefined }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = ContractMatchResponseSchema.parse(await res.json());
      const accepted: EngineType[] = [];
      for (const m of body.matches) {
        const engine = EngineTypeEnum.safeParse(m.engine_type);
        if (engine.success && m.accepted) accepted.push(engine.data);
      }
      return accepted;
    } catch (err: any) {
      this.logger.warn(`Contract matching unavailable for '${fileName ?? 'artifact'}': ${err?.message ?? err}`);
      return null;
    }
  }
}
