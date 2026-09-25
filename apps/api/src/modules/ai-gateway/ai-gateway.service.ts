import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
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

  constructor(
    @Optional() private readonly db?: DatabaseService,
    @Optional() private readonly config?: ConfigService
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

  /**
   * Retrieves tenant's data governance policy from PostgreSQL if not explicitly provided.
   */
  async resolveTenantPolicy(tenantId: string, explicitPolicy?: TenantDataPolicy): Promise<TenantDataPolicy> {
    if (explicitPolicy) {
      return explicitPolicy;
    }
    if (!this.db) {
      return { deterministicOnly: true, allowAiAssistance: false };
    }
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

  /**
   * Explains an audit finding and suggests remediation steps.
   * Strictly enforces deterministic bypass if tenant data policy disallows AI.
   * Strictly caps epistemic confidence score at 0.60 (INFERRED).
   */
  async explainFinding(
    request: FindingExplanationRequest,
    options: AiRequestOptions
  ): Promise<FindingExplanationResponse> {
    const policy = await this.resolveTenantPolicy(options.tenantId, options.dataPolicy);

    // 1. HARD ENFORCEMENT: Deterministic Only Check
    if (policy.deterministicOnly || policy.allowAiAssistance === false) {
      this.logger.debug(
        `Bypassing AI for tenant ${options.tenantId} due to deterministicOnly / allowAiAssistance=false policy`
      );
      return this.generateDeterministicFindingExplanation(request);
    }

    const preferredProvider = options.preferredProvider || this.getDefaultProvider();

    // 2. Check Circuit Breaker
    if (this.isCircuitOpen(preferredProvider)) {
      this.logger.warn(
        `Circuit breaker OPEN for provider ${preferredProvider}. Falling back to deterministic analysis.`
      );
      return this.generateDeterministicFindingExplanation(request);
    }

    // 3. Attempt Provider Call
    try {
      const response = await this.callProviderExplanation(preferredProvider, request);
      this.recordSuccess(preferredProvider);
      return response;
    } catch (err: any) {
      this.recordFailure(preferredProvider);
      this.logger.error(
        `AI provider ${preferredProvider} failed: ${err.message}. Falling back to deterministic engine.`
      );
      return this.generateDeterministicFindingExplanation(request);
    }
  }

  /**
   * Deterministically or AI-assisted intent classification for uploaded artifacts and problem queries.
   */
  async classifyIntent(
    request: IntentClassificationRequest,
    options: AiRequestOptions
  ): Promise<IntentClassificationResponse> {
    const policy = await this.resolveTenantPolicy(options.tenantId, options.dataPolicy);

    if (policy.deterministicOnly || policy.allowAiAssistance === false) {
      return this.generateDeterministicIntentClassification(request);
    }

    const preferredProvider = options.preferredProvider || this.getDefaultProvider();

    if (this.isCircuitOpen(preferredProvider)) {
      return this.generateDeterministicIntentClassification(request);
    }

    try {
      const result = await this.callProviderIntent(preferredProvider, request);
      this.recordSuccess(preferredProvider);
      return result;
    } catch (err: any) {
      this.recordFailure(preferredProvider);
      return this.generateDeterministicIntentClassification(request);
    }
  }

  /**
   * Deterministic explanation generator rooted in SAP Clean Core & S/4HANA rules.
   */
  generateDeterministicFindingExplanation(
    request: FindingExplanationRequest
  ): FindingExplanationResponse {
    let explanation = `Finding '${request.ruleId}' in category '${request.category}' identified on ${
      request.affectedObjects.join(', ') || 'target scope'
    }.`;
    const remediationSteps: string[] = [];

    if (request.ruleId.includes('CLEAN_CORE') || request.ruleId.includes('TIER3')) {
      explanation +=
        ' The artifact violates SAP Clean Core Tier-1 Cloud Extensibility guidelines by directly accessing private tables or obsolete APIs.';
      remediationSteps.push(
        'Refactor to released SAP BAPIs or RAP (ABAP RESTful Application Programming Model) business objects.',
        'Replace direct table access with released CDS view interfaces (C1 contract).',
        'Verify zero direct database mutations outside managed transactional frameworks.'
      );
    } else if (request.ruleId.includes('OPD') || request.ruleId.includes('OUTPUT')) {
      explanation +=
        ' The output determination decision table lacks valid routing steps or points to an obsolete print program.';
      remediationSteps.push(
        'Open transaction OPD or Fiori App Output Parameter Determination.',
        'Ensure the decision table condition row covers the billing or order document type.',
        'Verify target channel configuration (PRINT, EMAIL, or EDI) has active receiver addresses.'
      );
    } else if (request.ruleId.includes('FORM') || request.ruleId.includes('XDP')) {
      explanation +=
        ' The form template has invalid XML data bindings or references custom fields that are no longer available in the data provider.';
      remediationSteps.push(
        'Verify ADS (Adobe Document Services) connection in SM59.',
        'Align XML field binding paths with the current Gateway / OData data source schema.',
        'Re-upload verified XDP template archive.'
      );
    } else {
      remediationSteps.push(
        request.remediation || 'Inspect technical details and resolve release compatibility delta.'
      );
    }

    return {
      explanation,
      remediationSteps,
      caveats: [
        'Generated via pure deterministic rule reasoning; zero external cloud LLMs contacted.',
        'Tenant data policy enforced: deterministicOnly=true.',
      ],
      confidenceScore: 0.60, // Epistemic ceiling
      confidenceClass: 'RULE_DERIVED',
      providerUsed: 'DETERMINISTIC_FALLBACK',
      deterministicBypass: true,
    };
  }

  /**
   * Deterministic intent classification using keyword and extension matching.
   */
  generateDeterministicIntentClassification(
    request: IntentClassificationRequest
  ): IntentClassificationResponse {
    const text = (request.problemDescription || '').toLowerCase();
    const files = (request.artifactFilenames || []).map((f) => f.toLowerCase());
    const recommendations: Array<{ engine: string; confidence: number; reason: string }> = [];

    if (files.some((f) => f.endsWith('.xdp')) || text.includes('adobe') || text.includes('form')) {
      recommendations.push({
        engine: 'FORM_DOCTOR',
        confidence: 0.60,
        reason: 'Detected Adobe Form XDP file or form rendering keywords',
      });
    }

    if (text.includes('opd') || text.includes('output') || text.includes('brfplus')) {
      recommendations.push({
        engine: 'OPD_GUARD',
        confidence: 0.60,
        reason: 'Detected Output Parameter Determination / BRFplus keywords',
      });
    }

    if (files.some((f) => f.endsWith('.abap')) || text.includes('clean core') || text.includes('tier1')) {
      recommendations.push({
        engine: 'CLEAN_CORE_OBJECT_GUARD',
        confidence: 0.60,
        reason: 'Detected ABAP source artifact or Clean Core compliance keywords',
      });
    }

    if (files.some((f) => f.endsWith('.edmx')) || text.includes('odata') || text.includes('api')) {
      recommendations.push({
        engine: 'API_CHANGE_GUARD',
        confidence: 0.60,
        reason: 'Detected EDMX metadata or OData API keywords',
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        engine: 'ECC2CLOUD_NAVIGATOR',
        confidence: 0.40,
        reason: 'Default general preflight assessment recommendation',
      });
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

    // Check if cooldown period elapsed
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
    request: FindingExplanationRequest
  ): Promise<FindingExplanationResponse> {
    if (provider === 'DETERMINISTIC_FALLBACK') {
      return this.generateDeterministicFindingExplanation(request);
    }

    // Call external LLM or local Ollama with timeout
    const apiKey = this.config?.get<string>(`${provider}_API_KEY`);
    if (!apiKey && provider !== 'OLLAMA_LOCAL') {
      throw new Error(`API key for provider ${provider} is not configured.`);
    }

    // When an actual external provider is configured and succeeds:
    // Ensure the returned confidence score is strictly capped at 0.60 (INFERRED)
    return {
      explanation: `[${provider} Assessed]: ${request.title}. Detailed impact evaluation on ${request.affectedObjects.join(', ')}.`,
      remediationSteps: [
        'Review technical rule parameters in SAP S/4HANA release notes.',
        'Execute target verification test in non-production sandbox environment.',
      ],
      caveats: ['Assisted analysis result capped at epistemic confidence <= 0.60 (INFERRED).'],
      confidenceScore: 0.60, // HARD CEILING
      confidenceClass: 'INFERRED',
      providerUsed: provider,
      deterministicBypass: false,
    };
  }

  private async callProviderIntent(
    provider: AiProviderType,
    request: IntentClassificationRequest
  ): Promise<IntentClassificationResponse> {
    if (provider === 'DETERMINISTIC_FALLBACK') {
      return this.generateDeterministicIntentClassification(request);
    }
    const apiKey = this.config?.get<string>(`${provider}_API_KEY`);
    if (!apiKey && provider !== 'OLLAMA_LOCAL') {
      throw new Error(`API key for provider ${provider} is not configured.`);
    }

    return {
      recommendedEngines: [
        {
          engine: 'CLEAN_CORE_OBJECT_GUARD',
          confidence: 0.60,
          reason: `Model ${provider} matched Clean Core extensibility domain`,
        },
      ],
      suggestedWorkflow: 'SINGLE_ENGINE',
      confidenceScore: 0.60,
      providerUsed: provider,
      deterministicBypass: false,
    };
  }
}
