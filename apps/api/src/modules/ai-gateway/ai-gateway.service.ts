import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { UsageService } from '../usage/usage.service';
import { EntitlementsService } from '../billing/entitlements.service';
import { PlanLimitExceededException } from '../billing/plan-limit.exception';
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
    @Optional() private readonly entitlements?: EntitlementsService
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

  private trackTokens(tenantId: string, tokens: number) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    let usage = this.tenantTokenUsage.get(tenantId);
    if (!usage || usage.month !== currentMonth) {
      usage = { month: currentMonth, count: 0 };
    }
    usage.count += tokens;
    this.tenantTokenUsage.set(tenantId, usage);
    // Persistent per-tenant metering (spec 10.5); best-effort, never blocks the response.
    void this.usage?.recordSafe(tenantId, 'AI_TOKENS', tokens, { resourceType: 'AI_REQUEST' });
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

  async explainFinding(
    request: FindingExplanationRequest,
    options: AiRequestOptions
  ): Promise<any> {
    const policy = await this.resolveTenantPolicy(options.tenantId, options.dataPolicy);

    if (policy.deterministicOnly || policy.allowAiAssistance === false) {
      return this.generateDeterministicFindingExplanation(request);
    }

    const budgetCheck = await this.enforceTokenBudget(options.tenantId, 100);
    if (budgetCheck) return budgetCheck;

    const preferredProvider = options.preferredProvider || this.getDefaultProvider();

    if (this.isCircuitOpen(preferredProvider)) {
      return this.generateDeterministicFindingExplanation(request);
    }

    try {
      const response = await this.callProviderExplanation(preferredProvider, request, options);
      this.recordSuccess(preferredProvider);
      return response;
    } catch (err: any) {
      this.recordFailure(preferredProvider);
      this.logger.error(`AI provider ${preferredProvider} failed: ${err.message}.`);
      return this.generateDeterministicFindingExplanation(request);
    }
  }

  async classifyIntent(
    request: IntentClassificationRequest,
    options: AiRequestOptions
  ): Promise<any> {
    const policy = await this.resolveTenantPolicy(options.tenantId, options.dataPolicy);

    if (policy.deterministicOnly || policy.allowAiAssistance === false) {
      return this.generateDeterministicIntentClassification(request);
    }

    const budgetCheck = await this.enforceTokenBudget(options.tenantId, 100);
    if (budgetCheck) return budgetCheck;

    const preferredProvider = options.preferredProvider || this.getDefaultProvider();

    if (this.isCircuitOpen(preferredProvider)) {
      return this.generateDeterministicIntentClassification(request);
    }

    try {
      const result = await this.callProviderIntent(preferredProvider, request, options);
      this.recordSuccess(preferredProvider);
      return result;
    } catch (err: any) {
      this.recordFailure(preferredProvider);
      return this.generateDeterministicIntentClassification(request);
    }
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

  private getDefaultProvider(): AiProviderType {
    const configured = this.config?.get<string>('AI_DEFAULT_PROVIDER')?.toUpperCase();
    if (configured === 'ANTHROPIC') return 'ANTHROPIC';
    if (configured === 'OPENAI') return 'OPENAI';
    if (configured === 'OLLAMA_LOCAL') return 'OLLAMA_LOCAL';
    return 'DETERMINISTIC_FALLBACK';
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

  private async callProviderExplanation(
    provider: AiProviderType,
    request: FindingExplanationRequest,
    options: AiRequestOptions
  ): Promise<FindingExplanationResponse> {
    if (provider === 'DETERMINISTIC_FALLBACK') {
      return this.generateDeterministicFindingExplanation(request);
    }

    const apiKey = this.config?.get<string>(`${provider}_API_KEY`);
    if (!apiKey && provider !== 'OLLAMA_LOCAL') {
      throw new Error(`API key for provider ${provider} is not configured.`);
    }

    const promptText = `Title: ${request.title}\nDescription: ${request.description}\nCategory: ${request.category}\nRule: ${request.ruleId}\nAffected: ${request.affectedObjects.join(', ')}`;
    const scrubbedPrompt = this.scrubPii(promptText);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let explanation = `[${provider} Assessed]: ${request.title}. Detailed impact evaluation on ${request.affectedObjects.join(', ')}.`;
    let remediationSteps = ['Review technical rule parameters in SAP S/4HANA release notes.', 'Execute target verification test in non-production sandbox environment.'];

    try {
      if (provider === 'OPENAI') {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Explain SAP findings and provide remediation steps. Output strictly as JSON with keys "explanation" (string) and "remediationSteps" (array of strings).' },
              { role: 'user', content: scrubbedPrompt }
            ],
            response_format: { type: 'json_object' },
            max_tokens: options.maxTokens || 2000
          }),
          signal: controller.signal
        });
        
        if (!response.ok) {
          throw new Error(`OpenAI error: ${response.status} ${response.statusText}`);
        }
        
        const data: any = await response.json();
        const usage = data.usage;
        if (usage) {
          this.logger.log(`Tokens used - prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}, total: ${usage.total_tokens}`);
          this.trackTokens(options.tenantId, usage.total_tokens);
        }
        
        const content = data.choices[0]?.message?.content;
        if (content) {
          try {
            const parsed = JSON.parse(content);
            if (parsed.explanation) explanation = parsed.explanation;
            if (parsed.remediationSteps && Array.isArray(parsed.remediationSteps)) {
              remediationSteps = parsed.remediationSteps;
            }
          } catch (e) {}
        }
      } else if (provider === 'ANTHROPIC') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey!,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            system: 'Explain SAP findings and provide remediation steps. Output strictly as JSON with keys "explanation" and "remediationSteps".',
            messages: [
              { role: 'user', content: scrubbedPrompt }
            ],
            max_tokens: options.maxTokens || 2000
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Anthropic error: ${response.status} ${response.statusText}`);
        }

        const data: any = await response.json();
        const usage = data.usage;
        if (usage) {
          const total = (usage.input_tokens || 0) + (usage.output_tokens || 0);
          this.logger.log(`Tokens used - prompt: ${usage.input_tokens}, completion: ${usage.output_tokens}, total: ${total}`);
          this.trackTokens(options.tenantId, total);
        }

        const content = data.content?.[0]?.text;
        if (content) {
          try {
            const jsonStart = content.indexOf('{');
            const jsonEnd = content.lastIndexOf('}') + 1;
            const parsed = JSON.parse(content.substring(jsonStart, jsonEnd));
            if (parsed.explanation) explanation = parsed.explanation;
            if (parsed.remediationSteps && Array.isArray(parsed.remediationSteps)) {
              remediationSteps = parsed.remediationSteps;
            }
          } catch (e) {}
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    return {
      explanation,
      remediationSteps,
      caveats: ['Assisted analysis result capped at epistemic confidence <= 0.60 (INFERRED).'],
      confidenceScore: 0.60,
      confidenceClass: 'INFERRED',
      providerUsed: provider,
      deterministicBypass: false,
    };
  }

  private async callProviderIntent(
    provider: AiProviderType,
    request: IntentClassificationRequest,
    options: AiRequestOptions
  ): Promise<IntentClassificationResponse> {
    if (provider === 'DETERMINISTIC_FALLBACK') {
      return this.generateDeterministicIntentClassification(request);
    }
    const completion = await this.completeJson(
      {
        purpose: 'intent_classification',
        system:
          'You route SAP problem descriptions to preflight engines. Reply with JSON only: ' +
          '{"engines":[{"engine":"<ENGINE_ID>","reason":"<short reason>"}]}. Never invent findings.',
        user: `Problem: ${request.problemDescription}\nFiles: ${(request.artifactFilenames ?? []).join(', ')}`,
        maxTokens: options.maxTokens ?? 512,
      },
      { ...options, preferredProvider: provider }
    );
    const engines: Array<{ engine: string; reason: string }> = Array.isArray((completion.json as any)?.engines)
      ? (completion.json as any).engines
          .filter((e: any) => typeof e?.engine === 'string')
          .slice(0, 5)
          .map((e: any) => ({ engine: String(e.engine), reason: String(e.reason ?? '').slice(0, 300) }))
      : [];
    if (engines.length === 0) return this.generateDeterministicIntentClassification(request);
    return {
      recommendedEngines: engines.map((e) => ({ engine: e.engine, confidence: 0.6, reason: e.reason })),
      suggestedWorkflow: engines.length > 1 ? 'MULTI_ENGINE_CHAIN' : 'SINGLE_ENGINE',
      confidenceScore: 0.6,
      providerUsed: provider,
      deterministicBypass: false,
    };
  }

  /** Whether an external model may be used for this tenant (data policy + configured provider). */
  async aiAllowed(tenantId: string): Promise<{ allowed: boolean; reason: 'POLICY' | 'NO_PROVIDER' | null; provider: AiProviderType }> {
    const policy = await this.resolveTenantPolicy(tenantId);
    const provider = this.getDefaultProvider();
    if (policy.deterministicOnly || policy.allowAiAssistance === false) {
      return { allowed: false, reason: 'POLICY', provider };
    }
    if (provider === 'DETERMINISTIC_FALLBACK') return { allowed: false, reason: 'NO_PROVIDER', provider };
    return { allowed: true, reason: null, provider };
  }

  /**
   * Structured JSON completion through the configured provider (Part 03 §3.9,
   * section C §37). Enforces the tenant data policy and token budget, scrubs
   * PII/secrets from the prompt, and records provider, model, tokens, latency and
   * purpose (usage_events AI_TOKENS metadata + log). Throws AiUnavailableError when
   * the policy forbids AI, no provider is configured, the circuit is open, the
   * budget is exhausted or the provider fails. Callers validate `json` with a strict
   * schema before using it (Part 17.17).
   */
  async completeJson(
    request: { purpose: string; system: string; user: string; maxTokens?: number },
    options: AiRequestOptions
  ): Promise<AiCompletion> {
    const policy = await this.resolveTenantPolicy(options.tenantId, options.dataPolicy);
    if (policy.deterministicOnly || policy.allowAiAssistance === false) {
      throw new AiUnavailableError('DISABLED_BY_POLICY', 'Organization data policy does not allow AI assistance.');
    }
    const provider = options.preferredProvider || this.getDefaultProvider();
    if (provider === 'DETERMINISTIC_FALLBACK') {
      throw new AiUnavailableError('PROVIDER_UNAVAILABLE', 'No AI provider is configured (AI_DEFAULT_PROVIDER).');
    }
    const budget = await this.enforceTokenBudget(options.tenantId, request.maxTokens ?? 512);
    if (budget) throw new AiUnavailableError('BUDGET_EXCEEDED', 'Monthly AI token budget exceeded.');
    if (this.isCircuitOpen(provider)) {
      throw new AiUnavailableError('PROVIDER_UNAVAILABLE', `AI provider ${provider} circuit is open.`);
    }

    const system = request.system;
    const user = this.scrubPii(request.user);
    const maxTokens = Math.min(Math.max(request.maxTokens ?? 512, 64), 4096);
    const started = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let model = '';
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      if (provider === 'ANTHROPIC') {
        const apiKey = this.config?.get<string>('ANTHROPIC_API_KEY');
        if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
        model = this.config?.get<string>('AI_ANTHROPIC_MODEL') || 'claude-opus-5';
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Anthropic error: HTTP ${res.status}`);
        const data: any = await res.json();
        if (data.stop_reason === 'refusal') throw new Error('Anthropic model declined the request');
        text = (data.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
        inputTokens = data.usage?.input_tokens ?? 0;
        outputTokens = data.usage?.output_tokens ?? 0;
        model = data.model ?? model;
      } else {
        // OPENAI or OLLAMA_LOCAL (any OpenAI-compatible chat completions endpoint).
        const isLocal = provider === 'OLLAMA_LOCAL';
        const apiKey = this.config?.get<string>(isLocal ? 'OLLAMA_LOCAL_API_KEY' : 'OPENAI_API_KEY');
        if (!isLocal && !apiKey) throw new Error('OPENAI_API_KEY is not configured');
        const base = isLocal
          ? (this.config?.get<string>('OLLAMA_BASE_URL') || 'http://localhost:11434').replace(/\/+$/, '')
          : 'https://api.openai.com';
        model = isLocal
          ? this.config?.get<string>('AI_OLLAMA_MODEL') || 'llama3.1'
          : this.config?.get<string>('AI_OPENAI_MODEL') || 'gpt-4o-mini';
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
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`${provider} error: HTTP ${res.status}`);
        const data: any = await res.json();
        text = data.choices?.[0]?.message?.content ?? '';
        inputTokens = data.usage?.prompt_tokens ?? 0;
        outputTokens = data.usage?.completion_tokens ?? 0;
        model = data.model ?? model;
      }
      this.recordSuccess(provider);
    } catch (err: any) {
      this.recordFailure(provider);
      this.logger.warn(`AI completion (${request.purpose}) via ${provider} failed: ${err?.message ?? err}`);
      throw new AiUnavailableError('PROVIDER_UNAVAILABLE', `AI provider ${provider} failed.`);
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - started;
    const tokens = inputTokens + outputTokens;
    this.trackTokensWithMetadata(options.tenantId, tokens, {
      provider,
      model,
      purpose: request.purpose,
      inputTokens,
      outputTokens,
      latencyMs,
    });
    this.logger.log(`AI completion purpose=${request.purpose} provider=${provider} model=${model} tokens=${tokens} latencyMs=${latencyMs}`);

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
    public readonly code: 'DISABLED_BY_POLICY' | 'PROVIDER_UNAVAILABLE' | 'BUDGET_EXCEEDED',
    message: string
  ) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}
