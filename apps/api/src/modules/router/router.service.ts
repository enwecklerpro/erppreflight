import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  EngineTypeEnum,
  ProblemRouteRequestSchema,
  type AiRefinement,
  type EngineType,
  type ProblemRouteResponse,
  type RouterSuggestion,
} from '@erppreflight/schemas';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { AiGatewayService, AiUnavailableError } from '../ai-gateway/ai-gateway.service';
import { ArtifactProfilerService } from '../jobs/orchestration/artifact-profiler.service';
import { EngineCatalogService, type EngineContract } from '../jobs/orchestration/engine-catalog.service';
import { ENGINE_PROFILES, engineName } from '../jobs/orchestration/engine-profiles';
import { classifyProblem, type ClassifierArtifact } from './problem-classifier';

/** Strict schema for the model's answer (Part 17.17): anything else is rejected. */
const AiRoutingAnswerSchema = z
  .object({
    engines: z
      .array(z.object({ engine: EngineTypeEnum, reason: z.string().trim().min(1).max(300) }).strict())
      .max(5),
  })
  .strict();

const AI_CONFIDENCE_CAP = 0.6;

const NOTICE =
  'Routing is advisory: it proposes engines and never produces findings. Suggestions are rule-derived; an optional AI refinement is labelled INFERRED (≤ 0.60) and never overrides the rule-based routing.';

/**
 * AI Problem Router service (Part 05 §5.1, Part 17 AI governance, section C §37/§38).
 * Deterministic classifier first; optional LLM refinement through the AI gateway
 * only when the organization's data policy allows it. Every routing is persisted
 * (problem_routings) with the classifier version for audit and reproducibility.
 */
@Injectable()
export class RouterService {
  private readonly logger = new Logger(RouterService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly catalog: EngineCatalogService,
    private readonly profiler: ArtifactProfilerService,
    @Optional() private readonly ai?: AiGatewayService
  ) {}

  async route(tenantId: string, userId: string, body: unknown): Promise<ProblemRouteResponse> {
    const parsed = ProblemRouteRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_ROUTE_REQUEST',
        message: 'Invalid problem routing request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const dto = parsed.data;

    // Project context (tenant-scoped) — defaults for release and routing.
    let project: any = null;
    if (dto.projectId) {
      const res = await this.db.query(
        `SELECT id, target_release, source_erp, target_product, deployment_type, modules, countries
           FROM projects WHERE id = $1 AND organization_id = $2`,
        [dto.projectId, tenantId],
        { tenantId }
      );
      project = res.rows?.[0];
      if (!project) throw new NotFoundException(`Project '${dto.projectId}' not found`);
    } else if (dto.fileIds?.length) {
      throw new BadRequestException({ code: 'PROJECT_REQUIRED', message: 'fileIds require a projectId.' });
    }
    const modules = jsonArray(project?.modules);
    const countries = jsonArray(project?.countries);

    // Artifact signals for the selected CLEAN files of that project.
    let artifacts: ClassifierArtifact[] = [];
    if (project && dto.fileIds?.length) {
      const profile = await this.profiler.profileProjectArtifacts(tenantId, project.id, dto.fileIds);
      const found = new Set(profile.artifacts.map((a) => a.fileId).concat(profile.skipped.map((s) => s.fileId)));
      const missing = dto.fileIds.filter((id) => !found.has(id));
      if (missing.length) {
        throw new NotFoundException({
          code: 'ARTIFACT_NOT_FOUND',
          message: `CLEAN artifact(s) not found in the project: ${missing.join(', ')}`,
        });
      }
      artifacts = profile.artifacts.map((a) => ({
        fileId: a.fileId,
        fileName: a.fileName,
        signals: a.signals,
        contractAccepted: a.contractAccepted,
      }));
    }

    const classification = classifyProblem({
      text: dto.problem,
      objectIdentifier: dto.objectIdentifier,
      artifacts,
      context: project
        ? {
            sourceErp: project.source_erp,
            targetProduct: project.target_product,
            deploymentType: project.deployment_type,
            modules,
          }
        : undefined,
    });

    const contracts = await this.catalog.getContracts();
    const suggestions: RouterSuggestion[] = classification.suggestions.map((s) => {
      const contract = contracts?.get(s.engine) ?? null;
      return {
        engine: s.engine,
        engineName: contract?.name ?? s.engineName,
        role: s.role,
        score: s.score,
        confidence: s.confidence,
        confidenceClass: 'RULE_DERIVED',
        why: s.why,
        condition: s.condition,
        acceptedFormats: contract?.acceptedFormats ?? [],
        inputSummary: contract?.summary ?? null,
        requiredInputs: contract ? requiredInputs(contract, s.engine, artifacts) : null,
        matchingFileIds: s.matchingFileIds,
      };
    });

    const ai = await this.refineWithAi(tenantId, dto.problem, dto.useAi === true, suggestions, artifacts);

    const routingId = uuidv4();
    const context = {
      projectId: project?.id ?? null,
      targetRelease: project?.target_release ?? null,
      sourceErp: project?.source_erp ?? null,
      targetProduct: project?.target_product ?? null,
      deploymentType: project?.deployment_type ?? null,
      modules,
      countries,
    };
    await this.db.query(
      `INSERT INTO problem_routings (id, organization_id, project_id, created_by, problem_text, object_identifier,
                                     classifier_version, context, suggestions, ai_refinement)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        routingId,
        tenantId,
        project?.id ?? null,
        userId ?? null,
        dto.problem,
        dto.objectIdentifier ?? null,
        classification.version,
        JSON.stringify({ ...context, fileIds: dto.fileIds ?? [] }),
        JSON.stringify(suggestions),
        ai.status === 'NOT_REQUESTED' ? null : JSON.stringify(ai),
      ],
      { tenantId }
    );

    return {
      routingId,
      classifierVersion: classification.version,
      problem: dto.problem,
      suggestions,
      unmatched: classification.unmatched,
      contractsAvailable: contracts !== null,
      context,
      ai,
      notice: NOTICE,
    };
  }

  /** Engine catalog with declared input contracts (manual expert selection). */
  async engineCatalog() {
    const contracts = await this.catalog.getContracts();
    return {
      available: contracts !== null,
      engines: (Object.keys(ENGINE_PROFILES) as EngineType[]).map((engine) => {
        const c = contracts?.get(engine);
        return {
          engine,
          engineName: c?.name ?? engineName(engine),
          domain: ENGINE_PROFILES[engine].domain,
          acceptedFormats: c?.acceptedFormats ?? [],
          inputSummary: c?.summary ?? null,
          requiredInputs: c?.required ?? [],
        };
      }),
    };
  }

  /**
   * Optional LLM refinement through the AI gateway. Only when requested AND the
   * organization's data policy allows AI. The answer is schema-validated, capped at
   * INFERRED 0.60, kept separate from the rule-based suggestions and never
   * reorders or removes them; disagreements are reported as conflicts.
   */
  private async refineWithAi(
    tenantId: string,
    problem: string,
    requested: boolean,
    suggestions: RouterSuggestion[],
    artifacts: ClassifierArtifact[]
  ): Promise<AiRefinement> {
    const base: AiRefinement = {
      status: 'NOT_REQUESTED',
      provider: null,
      model: null,
      tokens: null,
      latencyMs: null,
      suggestions: [],
      conflicts: [],
      note: 'AI refinement was not requested; routing is fully rule-based.',
    };
    if (!requested) return base;
    if (!this.ai) {
      return { ...base, status: 'PROVIDER_UNAVAILABLE', note: 'AI gateway is not available.' };
    }
    const gate = await this.ai.aiAllowed(tenantId);
    if (!gate.allowed) {
      if (gate.reason === 'POLICY') {
        return { ...base, status: 'DISABLED_BY_POLICY', note: 'The organization data policy does not allow AI assistance; rule-based routing only.' };
      }
      if (gate.reason === 'GOVERNANCE') {
        return { ...base, status: 'PROVIDER_UNAVAILABLE', note: 'AI is switched off by the platform administrator (AI Admin); rule-based routing only.' };
      }
      return { ...base, status: 'PROVIDER_UNAVAILABLE', note: 'No AI provider is configured; rule-based routing only.' };
    }
    const engineList = (Object.keys(ENGINE_PROFILES) as EngineType[])
      .map((e) => `${e}: ${ENGINE_PROFILES[e].name} (${ENGINE_PROFILES[e].domain})`)
      .join('\n');
    try {
      const completion = await this.ai.completeJson(
        {
          purpose: 'problem_routing',
          system:
            'You classify SAP problem descriptions into preflight engines. You never state findings or diagnoses. ' +
            'Answer with JSON only: {"engines":[{"engine":"<ENGINE_ID>","reason":"<max 30 words>"}]} using at most 3 engine ids from this list:\n' +
            engineList,
          user: `Problem: ${problem}\nUploaded artifact names: ${artifacts.map((a) => a.fileName).join(', ') || 'none'}`,
          maxTokens: 400,
        },
        { tenantId }
      );
      const answer = AiRoutingAnswerSchema.safeParse(completion.json);
      if (!answer.success) {
        return {
          ...base,
          status: 'REJECTED_INVALID_OUTPUT',
          provider: completion.provider,
          model: completion.model,
          tokens: completion.tokens,
          latencyMs: completion.latencyMs,
          note: 'The model answer did not match the required schema and was discarded.',
        };
      }
      const ruleEngines = new Set(suggestions.map((s) => s.engine));
      const aiEngines = [...new Map(answer.data.engines.map((e) => [e.engine, e])).values()];
      const conflicts: string[] = [];
      for (const s of suggestions.filter((x) => x.role === 'PRIMARY')) {
        if (!aiEngines.some((e) => e.engine === s.engine)) {
          conflicts.push(`AI did not confirm the rule-based primary route ${s.engineName}; the rule-based route stands.`);
        }
      }
      for (const e of aiEngines) {
        if (!ruleEngines.has(e.engine)) {
          conflicts.push(`AI additionally proposes ${engineName(e.engine)} (no rule matched); review before running it.`);
        }
      }
      return {
        status: 'APPLIED',
        provider: completion.provider,
        model: completion.model,
        tokens: completion.tokens,
        latencyMs: completion.latencyMs,
        suggestions: aiEngines.map((e) => ({
          engine: e.engine,
          reason: e.reason,
          confidence: AI_CONFIDENCE_CAP,
          confidenceClass: 'INFERRED' as const,
          agreesWithDeterministic: ruleEngines.has(e.engine),
        })),
        conflicts,
        note: 'AI refinement (INFERRED, ≤ 0.60). Rule-based routing wins on conflict (Part 17.16).',
      };
    } catch (err: any) {
      if (err instanceof AiUnavailableError) {
        const status = err.code === 'DISABLED_BY_POLICY' ? 'DISABLED_BY_POLICY' : err.code === 'BUDGET_EXCEEDED' || err.code === 'COST_CEILING' ? 'BUDGET_EXCEEDED' : 'PROVIDER_UNAVAILABLE';
        return { ...base, status, note: `${err.message} Rule-based routing only.` };
      }
      this.logger.warn(`AI routing refinement failed: ${err?.message ?? err}`);
      return { ...base, status: 'PROVIDER_UNAVAILABLE', note: 'AI refinement failed; rule-based routing only.' };
    }
  }
}

function jsonArray(value: unknown): string[] {
  const v = typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return []; } })() : value;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * "Additional required inputs" from the engine's declared input contract, marking
 * which uploaded files already look like they satisfy the engine's input.
 */
function requiredInputs(contract: EngineContract, engine: EngineType, artifacts: ClassifierArtifact[]) {
  const matching = artifacts
    .filter((a) => a.signals.engines[engine] && (a.contractAccepted === null || a.contractAccepted.includes(engine) || engine === 'FORM_DOCTOR' || engine === 'API_CHANGE_GUARD'))
    .map((a) => a.fileName)
    .sort();
  const items = contract.required.length ? contract.required : [contract.summary].filter(Boolean);
  return items.map((description) => ({ description, satisfiedBy: matching }));
}
