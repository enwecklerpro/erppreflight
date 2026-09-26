import type { ConfigService } from '@nestjs/config';
import type { AiExternalProvider } from './ai-governance.types';

/** Platform default provider (AI_DEFAULT_PROVIDER); null when no external provider is configured. */
export function defaultProviderFrom(config?: ConfigService | null): AiExternalProvider | null {
  const configured = config?.get<string>('AI_DEFAULT_PROVIDER')?.toUpperCase();
  if (configured === 'ANTHROPIC' || configured === 'OPENAI' || configured === 'OLLAMA_LOCAL') return configured;
  return null;
}

/** Environment default model per provider (used when a task does not pin a model). */
export function defaultModelFor(provider: AiExternalProvider, config?: ConfigService | null): string {
  if (provider === 'ANTHROPIC') return config?.get<string>('AI_ANTHROPIC_MODEL') || 'claude-opus-5';
  if (provider === 'OPENAI') return config?.get<string>('AI_OPENAI_MODEL') || 'gpt-4o-mini';
  return config?.get<string>('AI_OLLAMA_MODEL') || 'llama3.1';
}

/** Environment endpoint of the self-hosted OpenAI-compatible provider. */
export function envOllamaBaseUrl(config?: ConfigService | null): string {
  return (config?.get<string>('OLLAMA_BASE_URL') || 'http://localhost:11434').replace(/\/+$/, '');
}

/** Whether the credentials a provider needs are present (never exposes the value). */
export function providerCredentialsConfigured(provider: AiExternalProvider, config?: ConfigService | null): boolean {
  if (provider === 'ANTHROPIC') return Boolean(config?.get<string>('ANTHROPIC_API_KEY'));
  if (provider === 'OPENAI') return Boolean(config?.get<string>('OPENAI_API_KEY'));
  return true; // self-hosted endpoints may run without a key (OLLAMA_LOCAL_API_KEY is optional)
}
