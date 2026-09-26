import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { UsageService } from '../usage/usage.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { PlanLimitExceededException } from '../billing/plan-limit.exception';
import { AiGovernanceService } from './ai-governance.service';
import { defaultAiTaskPolicy, estimateTokens, routeAiCandidates, type AiRouteCandidate } from './ai-governance.routing';
import type { AiExternalProvider, ResolvedAiTaskPolicy } from './ai-governance.types';
import {
  AiProviderType,
  AiRequestOptions,
  CircuitBreakerState,
  FindingExplanationRequest,
  FindingExplanationResponse,
  IntentClassificationRequest,
  IntentClassificationResponse,
  TenantDataPolicy,
} from './ai-gateway.interface';

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly circuitBreakers = new Map<AiProviderType, CircuitBreakerState>();
  private readonly failureThreshold = 3;
  private readonly resetTimeoutMs = 60000;
  private readonly tenantTokenUsage = new Map<string, { month: string; count: number }>();

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly config?: ConfigService,
    @Optional() private readonly usage?: UsageService,
    @Optional() private readonly entitlements?: EntitlementsService,
    @Optional() private readonly governance?: AiGovernanceService
  ) {
    this.initCircuitBreaker('ANTHROPIC');
    this.initCircuitBreaker('OPENAI');
    this.initCircuitBreaker('OLLAMA_LOCAL');
  }

  private initCircuitBreaker(provider: AiProviderType) {
    this.circuitBreakers.set(provider, {
      failureCount: 0,
      lastFailureTime: null,
      isOpen: false,
    });
  }

  async resolveTenantPolicy(tenantId: string, explicitPolicy?: TenantDataPolicy): Promise<TenantDataPolicy> {
    if (explicitPolicy) return explicitPolicy;
    if (!this.db) return { deterministicOnly: true, allowAiAssistance: false };
    try {
      const res = await this.db.query(
        `SELECT data_policy FROM organizations WHERE id = $1`,
        [tenantId],
        { bypassRls: true }
      );
      if (res.rows.length > 0 && res.rows[0].data_policy) {
        return typeof res.rows[0].data_policy === 'string'
          ? JSON.parse(res.rows[0].data_policy)
          : res.rows[0].data_policy;
      }
    } catch (err: any) {
      this.logger.warn(`Could not fetch data_policy for tenant ${tenantId}: ${err.message}`);
    }
    return { deterministicOnly: false, allowAiAssistance: true };
  }

  private async enforceTokenBudget(tenantId: string, estimatedTokens: number = 0): Promise<any | null> {
    // Plan limit (spec 10.3/10.5): monthly AI tokens metered in usage_events across all instances.
    if (this.entitlements) {
      try {
        await this.entitlements.checkEntitlement(tenantId, 'AI_TOKENS');
      } catch (err: any) {
        if (err instanceof PlanLimitExceededException) {
          return { blocked: true, reason: 'PLAN_AI_TOKEN_LIMIT_REACHED', currentUsage: err.used, limit: err.limit };
        }
        this.logger.warn(`AI token entitlement check failed: ${err?.message ?? err}`);
      }
    }
    if (!this.db) return null;
    try {
      const res = await this.db.query(
        `SELECT token_budget_monthly FROM organizations WHERE id = $1`,
        [tenantId],
        { bypassRls: true }
      );
      const limit = res.rows[0]?.token_budget_monthly ?? 100000;
      const currentMonth = new Date().toISOString().slice(0, 7);
      let usage = this.tenantTokenUsage.get(tenantId);
      if (!usage || usage.month !== currentMonth) {
        usage = { month: currentMonth, count: 0 };
        this.tenantTokenUsage.set(tenantId, usage);
      }
      if (usage.count + estimatedTokens > limit) {
        return {
          blocked: true,
          reason: 'MONTHLY_TOKEN_BUDGET_EXCEEDED',
          currentUsage: usage.count,
          limit,
        };
      }
    } catch (e: any) {
      this.logger.warn(`Failed to check token budget: ${e.message}`);
    }
    return null;
  }

  private scrubPii(text: string): string {
    let scrubbed = text;
    // Scrub passwords, tokens, API keys
    scrubbed = scrubbed.replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*["']?[^"'\s]+["']?/gi, '$1: [REDACTED]');
    // Scrub emails
    scrubbed = scrubbed.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');
    // Scrub IP addresses
    scrubbed = scrubbed.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP_REDACTED]');
    return scrubbed;
  }


  private static readonly EXPLANATION_SYSTEM =
    'Explain SAP preflight findings and provide remediation steps. Never invent findings. Reply with JSON only: ' +
    '{"explanation":"<string>","remediationSteps":["<string>", ...]}.';

  async explainFinding(request: FindingExplanationRequest, options: AiRequestOptions): Promise<any> {
    const policy = await this.resolveTenantPolicy(options.tenantId, options.dataPolicy);
    if (policy.deterministicOnly || policy.allowAiAssistance === false) {
      return this.generateDeterministicFindingExplanation(request);
    }
    const budgetCheck = await this.enforceTokenBudget(options.tenantId, 100);
    if (budgetCheck) return budgetCheck;

    const promptText =
      `Title: ${request.title}\nDescription: ${request.description}\nCategory: ${request.category}\n` +
      `Rule: ${request.ruleId}\nAffected: ${request.affectedObjects.join(', ')}`;
    try {
      const completion = await this.completeJson(
        { purpose: 'finding_explanation', system: AiGatewayService.EXPLANATION_SYSTEM, user: promptText, maxTokens: options.maxTokens },
        options
      );
      const json: any = completion.json;
      const explanation = typeof json?.explanation === 'string' ? json.explanation.slice(0, 4000) : null;
      const steps = Array.isArray(json?.remediationSteps)
        ? json.remediationSteps.filter((x: unknown) => typeof x === 'string').slice(0, 12).map((x: string) => x.slice(0, 600))
        : [];
      if (!explanation) {
        return this.withUnavailableReason(this.generateDeterministicFindingExplanation(request), 'REJECTED_INVALID_OUTPUT');
      }
      return {
        explanation,
        remediationSteps: steps.length > 0 ? steps : [request.remediation || 'Inspect technical details and resolve release compatibility delta.'],
        caveats: ['Assisted analysis result capped at epistemic confidence <= 0.60 (INFERRED).'],
        confidenceScore: 0.6,
        confidenceClass: 'INFERRED',
        providerUsed: completion.provider,
        deterministicBypass: false,
      } satisfies FindingExplanationResponse;
    } catch (err: any) {
      const reason = err instanceof AiUnavailableError ? err.code : 'PROVIDER_UNAVAILABLE';
      return this.withUnavailableReason(this.generateDeterministicFindingExplanation(request), reason);
    }
  }

  async classifyIntent(request: IntentClassificationRequest, options: AiRequestOptions): Promise<any> {
    const policy = await this.resolveTenantPolicy(options.tenantId, options.dataPolicy);
    if (policy.deterministicOnly || policy.allowAiAssistance === false) {
      return this.generateDeterministicIntentClassification(request);
    }
    const budgetCheck = await this.enforceTokenBudget(options.tenantId, 100);
    if (budgetCheck) return budgetCheck;
    try {
      return await this.callProviderIntent(request, options);
    } catch (err: any) {
      const reason = err instanceof AiUnavailableError ? err.code : 'PROVIDER_UNAVAILABLE';
      return this.withUnavailableReason(this.generateDeterministicIntentClassification(request), reason);
    }
  }

  /** Deterministic fallback annotated with why AI was not used (kill switch, ceiling, …). */
  private withUnavailableReason<T extends object>(response: T, reason: string): T & { aiUnavailableReason: string } {
    return { ...response, aiUnavailableReason: reason };
  }

  generateDeterministicFindingExplanation(
    request: FindingExplanationRequest
  ): FindingExplanationResponse {
    let explanation = `Finding '${request.ruleId}' in category '${request.category}' identified on ${
      request.affectedObjects.join(', ') || 'target scope'
    }.`;
    const remediationSteps: string[] = [];

    if (request.ruleId.includes('CLEAN_CORE') || request.ruleId.includes('TIER3')) {
      explanation += ' The artifact violates SAP Clean Core Tier-1 Cloud Extensibility guidelines by directly accessing private tables or obsolete APIs.';
      remediationSteps.push(
        'Refactor to released SAP BAPIs or RAP (ABAP RESTful Application Programming Model) business objects.',
        'Replace direct table access with released CDS view interfaces (C1 contract).',
        'Verify zero direct database mutations outside managed transactional frameworks.'
      );
    } else if (request.ruleId.includes('OPD') || request.ruleId.includes('OUTPUT')) {
      explanation += ' The output determination decision table lacks valid routing steps or points to an obsolete print program.';
      remediationSteps.push(
        'Open transaction OPD or Fiori App Output Parameter Determination.',
        'Ensure the decision table condition row covers the billing or order document type.',
        'Verify target channel configuration (PRINT, EMAIL, or EDI) has active receiver addresses.'
      );
    } else if (request.ruleId.includes('FORM') || request.ruleId.includes('XDP')) {
      explanation += ' The form template has invalid XML data bindings or references custom fields that are no longer available in the data provider.';
      remediationSteps.push(
        'Verify ADS (Adobe Document Services) connection in SM59.',
        'Align XML field binding paths with the current Gateway / OData data source schema.',
        'Re-upload verified XDP template archive.'
      );
    } else {
      remediationSteps.push(request.remediation || 'Inspect technical details and resolve release compatibility delta.');
    }

    return {
      explanation,
      remediationSteps,
      caveats: [
        'Generated via pure deterministic rule reasoning; zero external cloud LLMs contacted.',
        'Tenant data policy enforced: deterministicOnly=true.',
      ],
      confidenceScore: 0.60,
      confidenceClass: 'RULE_DERIVED',
      providerUsed: 'DETERMINISTIC_FALLBACK',
      deterministicBypass: true,
    };
  }

  generateDeterministicIntentClassification(
    request: IntentClassificationRequest
  ): IntentClassificationResponse {
    const text = (request.problemDescription || '').toLowerCase();
    const files = (request.artifactFilenames || []).map((f) => f.toLowerCase());
    const recommendations: Array<{ engine: string; confidence: number; reason: string }> = [];

    if (files.some((f) => f.endsWith('.xdp')) || text.includes('adobe') || text.includes('form')) {
      recommendations.push({ engine: 'FORM_DOCTOR', confidence: 0.60, reason: 'Detected Adobe Form XDP file or form rendering keywords' });
    }
    if (text.includes('opd') || text.includes('output') || text.includes('brfplus')) {
      recommendations.push({ engine: 'OPD_GUARD', confidence: 0.60, reason: 'Detected Output Parameter Determination / BRFplus keywords' });
    }
    if (files.some((f) => f.endsWith('.abap')) || text.includes('clean core') || text.includes('tier1')) {
      recommendations.push({ engine: 'CLEAN_CORE_OBJECT_GUARD', confidence: 0.60, reason: 'Detected ABAP source artifact or Clean Core compliance keywords' });
    }
    if (files.some((f) => f.endsWith('.edmx')) || text.includes('odata') || text.includes('api')) {
      recommendations.push({ engine: 'API_CHANGE_GUARD', confidence: 0.60, reason: 'Detected EDMX metadata or OData API keywords' });
    }
    if (recommendations.length === 0) {
      recommendations.push({ engine: 'ECC2CLOUD_NAVIGATOR', confidence: 0.40, reason: 'Default general preflight assessment recommendation' });
    }

    return {
      recommendedEngines: recommendations,
      suggestedWorkflow: recommendations.length > 1 ? 'MULTI_ENGINE_CHAIN' : 'SINGLE_ENGINE',
      confidenceScore: Math.min(0.60, recommendations[0].confidence),
      providerUsed: 'DETERMINISTIC_FALLBACK',
      deterministicBypass: true,
    };
  }

  private isCircuitOpen(provider: AiProviderType): boolean {
    const state = this.circuitBreakers.get(provider);
    if (!state) return false;
    if (!state.isOpen) return false;

    if (state.lastFailureTime && Date.now() - state.lastFailureTime > this.resetTimeoutMs) {
      state.isOpen = false;
      state.failureCount = 0;
      return false;
    }
    return true;
  }

  private recordSuccess(provider: AiProviderType) {
    const state = this.circuitBreakers.get(provider);
    if (state) {
      state.failureCount = 0;
      state.isOpen = false;
    }
  }

  private recordFailure(provider: AiProviderType) {
    const state = this.circuitBreakers.get(provider);
    if (state) {
      state.failureCount++;
      state.lastFailureTime = Date.now();
      if (state.failureCount >= this.failureThreshold) {
        state.isOpen = true;
        this.logger.warn(`Trip circuit breaker OPEN for AI provider ${provider}`);
      }
    }
  }


  private async callProviderIntent(
    request: IntentClassificationRequest,
    options: AiRequestOptions
  ): Promise<IntentClassificationResponse> {
    const completion = await this.completeJson(
      {
        purpose: 'intent_classification',
        system:
          'You route SAP problem descriptions to preflight engines. Reply with JSON only: ' +
          '{"engines":[{"engine":"<ENGINE_ID>","reason":"<short reason>"}]}. Never invent findings.',
        user: `Problem: ${request.problemDescription}\nFiles: ${(request.artifactFilenames ?? []).join(', ')}`,
        maxTokens: options.maxTokens,
      },
      options
    );
    const engines: Array<{ engine: string; reason: string }> = Array.isArray((completion.json as any)?.engines)
      ? (completion.json as any).engines
          .filter((e: any) => typeof e?.engine === 'string')
          .slice(0, 5)
          .map((e: any) => ({ engine: String(e.engine), reason: String(e.reason ?? '').slice(0, 300) }))
      : [];
    if (engines.length === 0) {
      return this.withUnavailableReason(this.generateDeterministicIntentClassification(request), 'REJECTED_INVALID_OUTPUT');
    }
    return {
      recommendedEngines: engines.map((e) => ({ engine: e.engine, confidence: 0.6, reason: e.reason })),
      suggestedWorkflow: engines.length > 1 ? 'MULTI_ENGINE_CHAIN' : 'SINGLE_ENGINE',
      confidenceScore: 0.6,
      providerUsed: completion.provider,
      deterministicBypass: false,
    };
  }

  /**
   * Effective AI Admin policy for a task (spec 10.11). Without the governance service
   * (unit tests, tooling) the platform defaults apply. Fails closed: when the governance
   * configuration cannot be read, no provider is called.
   */
  private async resolveTaskPolicy(task: string): Promise<ResolvedAiTaskPolicy> {
    if (!this.governance) return defaultAiTaskPolicy(task, this.config);
    try {
      return await this.governance.resolvePolicy(task);
    } catch (err: any) {
      this.logger.error(`AI governance configuration unavailable for task ${task}: ${err?.message ?? err}`);
      throw new AiUnavailableError('PROVIDER_UNAVAILABLE', 'AI governance configuration is unavailable; AI is off.');
    }
  }

  private explicitProvider(options: AiRequestOptions): AiExternalProvider | null {
    const p = options.preferredProvider;
    return p && p !== 'DETERMINISTIC_FALLBACK' ? p : null;
  }

  /** Whether an external model may be used for this tenant and task (data policy + AI Admin governance). */
  async aiAllowed(
    tenantId: string,
    task = 'problem_routing'
  ): Promise<{ allowed: boolean; reason: 'POLICY' | 'NO_PROVIDER' | 'GOVERNANCE' | null; provider: AiProviderType }> {
    const policy = await this.resolveTenantPolicy(tenantId);
    if (policy.deterministicOnly || policy.allowAiAssistance === false) {
      return { allowed: false, reason: 'POLICY', provider: 'DETERMINISTIC_FALLBACK' };
    }
    let taskPolicy: ResolvedAiTaskPolicy;
    try {
      taskPolicy = await this.resolveTaskPolicy(task);
    } catch {
      return { allowed: false, reason: 'GOVERNANCE', provider: 'DETERMINISTIC_FALLBACK' };
    }
    const route = routeAiCandidates(taskPolicy, null, this.config);
    if (route.candidates.length === 0) {
      return {
        allowed: false,
        reason: route.blocked === 'NO_PROVIDER' ? 'NO_PROVIDER' : 'GOVERNANCE',
        provider: 'DETERMINISTIC_FALLBACK',
      };
    }
    return { allowed: true, reason: null, provider: route.candidates[0].provider };
  }

  /**
   * Structured JSON completion through the governed provider route (Part 03 §3.9,
   * section C §37, spec 10.11). Enforces, in this order: the tenant data policy, the
   * AI Admin task configuration (enabled, provider kill switches, privacy mode), the
   * tenant token budget and the task's monthly cost ceiling (worst-case projection of
   * this call); then calls the primary provider and, on failure, the fallback. A
   * killed provider is never called. Records provider, model, tokens, latency and
   * purpose (usage_events AI_TOKENS metadata + AI spend ledger). Throws
   * AiUnavailableError whenever no model may or can answer. Callers validate `json`
   * with a strict schema; AI output is capped at INFERRED (0.60) by every caller.
   */
  async completeJson(
    request: { purpose: string; system: string; user: string; maxTokens?: number },
    options: AiRequestOptions
  ): Promise<AiCompletion> {
    const tenantPolicy = await this.resolveTenantPolicy(options.tenantId, options.dataPolicy);
    if (tenantPolicy.deterministicOnly || tenantPolicy.allowAiAssistance === false) {
      throw new AiUnavailableError('DISABLED_BY_POLICY', 'Organization data policy does not allow AI assistance.');
    }
    const policy = await this.resolveTaskPolicy(request.purpose);
    const route = routeAiCandidates(policy, this.explicitProvider(options), this.config);
    if (route.candidates.length === 0) {
      await this.governance?.recordBlocked(request.purpose, route.killed[0] ?? null);
      if (route.blocked === 'TASK_DISABLED') {
        throw new AiUnavailableError('TASK_DISABLED', `AI task '${request.purpose}' is disabled by the platform administrator.`);
      }
      if (route.blocked === 'KILL_SWITCH') {
        throw new AiUnavailableError('KILL_SWITCH', `AI provider ${route.killed.join(', ')} is switched off (kill switch).`);
      }
      if (route.blocked === 'PRIVACY_MODE') {
        throw new AiUnavailableError('PRIVACY_MODE', `AI task '${request.purpose}' allows self-hosted providers only.`);
      }
      throw new AiUnavailableError('PROVIDER_UNAVAILABLE', 'No AI provider is configured (AI_DEFAULT_PROVIDER / AI Admin).');
    }

    // Admin-configured token limit caps the caller's request; unconfigured tasks keep the caller's value.
    const requested = request.maxTokens ?? policy.maxTokens;
    const maxTokens = Math.min(Math.max(policy.configured ? Math.min(requested, policy.maxTokens) : requested, 64), 4096);

    const budget = await this.enforceTokenBudget(options.tenantId, maxTokens);
    if (budget) throw new AiUnavailableError('BUDGET_EXCEEDED', 'Monthly AI token budget exceeded.');

    const system = request.system;
    const user = this.scrubPii(request.user);

    if (policy.costCeilingEurMonthly !== null && this.governance) {
      const spent = await this.governance.spentThisMonth(request.purpose);
      const projected = AiGovernanceService.costOf(policy, estimateTokens(system, user), maxTokens);
      if (spent + projected > policy.costCeilingEurMonthly) {
        await this.governance.recordBlocked(request.purpose, route.candidates[0].provider);
        throw new AiUnavailableError(
          'COST_CEILING',
          `AI task '${request.purpose}' reached its monthly cost ceiling (${policy.costCeilingEurMonthly} EUR).`
        );
      }
    }

    const started = Date.now();
    let answer: { candidate: AiRouteCandidate; model: string; text: string; inputTokens: number; outputTokens: number } | null = null;
    for (const candidate of route.candidates) {
      if (this.isCircuitOpen(candidate.provider)) {
        this.logger.warn(`AI completion (${request.purpose}): ${candidate.provider} circuit is open, skipping`);
        continue;
      }
      try {
        const out = await this.callProvider(candidate, system, user, maxTokens, policy.temperature);
        this.recordSuccess(candidate.provider);
        answer = { candidate, ...out };
        break;
      } catch (err: any) {
        this.recordFailure(candidate.provider);
        this.logger.warn(`AI completion (${request.purpose}) via ${candidate.provider} failed: ${err?.message ?? err}`);
      }
    }
    if (!answer) {
      throw new AiUnavailableError('PROVIDER_UNAVAILABLE', `AI provider ${route.candidates.map((c) => c.provider).join(' / ')} failed.`);
    }

    const { candidate, model, text, inputTokens, outputTokens } = answer;
    const provider = candidate.provider;
    const latencyMs = Date.now() - started;
    const tokens = inputTokens + outputTokens;
    this.trackTokensWithMetadata(options.tenantId, tokens, {
      provider,
      model,
      purpose: request.purpose,
      inputTokens,
      outputTokens,
      latencyMs,
      route: candidate.role,
    });
    if (this.governance) await this.governance.recordCall(policy, provider, model, inputTokens, outputTokens);
    this.logger.log(
      `AI completion purpose=${request.purpose} provider=${provider} (${candidate.role}) model=${model} tokens=${tokens} latencyMs=${latencyMs}`
    );

    let json: unknown = null;
    try {
      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');
      json = startIdx >= 0 && endIdx > startIdx ? JSON.parse(text.slice(startIdx, endIdx + 1)) : null;
    } catch {
      json = null;
    }
    return { provider, model, json, tokens, latencyMs, purpose: request.purpose };
  }

  /** One provider call (Anthropic Messages API or any OpenAI-compatible chat completions endpoint). */
  private async callProvider(
    candidate: AiRouteCandidate,
    system: string,
    user: string,
    maxTokens: number,
    temperature: number | null
  ): Promise<{ model: string; text: string; inputTokens: number; outputTokens: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let model = candidate.model;
    try {
      if (candidate.provider === 'ANTHROPIC') {
        const apiKey = this.config?.get<string>('ANTHROPIC_API_KEY');
        if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
            ...(temperature !== null ? { temperature } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Anthropic error: HTTP ${res.status}`);
        const data: any = await res.json();
        if (data.stop_reason === 'refusal') throw new Error('Anthropic model declined the request');
        const text = (data.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
        model = data.model ?? model;
        return { model, text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
      }
      // OPENAI or OLLAMA_LOCAL (any OpenAI-compatible chat completions endpoint).
      const isLocal = candidate.provider === 'OLLAMA_LOCAL';
      const apiKey = this.config?.get<string>(isLocal ? 'OLLAMA_LOCAL_API_KEY' : 'OPENAI_API_KEY');
      if (!isLocal && !apiKey) throw new Error('OPENAI_API_KEY is not configured');
      const base = isLocal ? (candidate.endpoint ?? 'http://localhost:11434') : 'https://api.openai.com';
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_object' },
          max_tokens: maxTokens,
          ...(temperature !== null ? { temperature } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${candidate.provider} error: HTTP ${res.status}`);
      const data: any = await res.json();
      model = data.model ?? model;
      return {
        model,
        text: data.choices?.[0]?.message?.content ?? '',
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private trackTokensWithMetadata(tenantId: string, tokens: number, metadata: Record<string, unknown>) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    let usage = this.tenantTokenUsage.get(tenantId);
    if (!usage || usage.month !== currentMonth) usage = { month: currentMonth, count: 0 };
    usage.count += tokens;
    this.tenantTokenUsage.set(tenantId, usage);
    void this.usage?.recordSafe(tenantId, 'AI_TOKENS', Math.max(tokens, 0), { resourceType: 'AI_REQUEST', metadata });
  }
}

export interface AiCompletion {
  provider: AiProviderType;
  model: string;
  json: unknown;
  tokens: number;
  latencyMs: number;
  purpose: string;
}

export class AiUnavailableError extends Error {
  constructor(
    public readonly code:
      | 'DISABLED_BY_POLICY'
      | 'PROVIDER_UNAVAILABLE'
      | 'BUDGET_EXCEEDED'
      | 'TASK_DISABLED'
      | 'KILL_SWITCH'
      | 'PRIVACY_MODE'
      | 'COST_CEILING',
    message: string
  ) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}
