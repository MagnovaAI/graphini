import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { settingsManager } from '$lib/server/state-manager';
import type { LanguageModel, ProviderMetadata } from 'ai';

let runtimeOpenRouterApiKey = '';
let runtimeOpenAiApiKey = '';
let runtimeAnthropicApiKey = '';
let runtimeAnthropicAuthToken = '';

export type ChatProvider = 'openrouter' | 'openai' | 'anthropic';
export type ProviderCredentialType = 'api_key' | 'auth_token';
const anthropicOAuthBetaHeader = 'oauth-2025-04-20';

export async function loadOpenRouterApiKey() {
  runtimeOpenRouterApiKey =
    process.env.OPENROUTER_API_KEY ||
    (await settingsManager.get<string | null>(null, 'ai_provider', 'openrouter_api_key', null)) ||
    '';
  return runtimeOpenRouterApiKey;
}

export async function loadOpenAiApiKey() {
  runtimeOpenAiApiKey =
    process.env.OPENAI_API_KEY ||
    (await settingsManager.get<string | null>(null, 'ai_provider', 'openai_api_key', null)) ||
    '';
  return runtimeOpenAiApiKey;
}

export async function loadAnthropicApiKey() {
  runtimeAnthropicApiKey =
    process.env.ANTHROPIC_API_KEY ||
    (await settingsManager.get<string | null>(null, 'ai_provider', 'anthropic_api_key', null)) ||
    '';
  return runtimeAnthropicApiKey;
}

export async function loadAnthropicAuthToken() {
  runtimeAnthropicAuthToken =
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_OAUTH_TOKEN ||
    (await settingsManager.get<string | null>(null, 'ai_provider', 'anthropic_auth_token', null)) ||
    '';
  return runtimeAnthropicAuthToken;
}

export async function loadProviderApiKeys() {
  await Promise.all([
    loadOpenRouterApiKey(),
    loadOpenAiApiKey(),
    loadAnthropicApiKey(),
    loadAnthropicAuthToken()
  ]);
}

export async function hasProviderCredential(provider: ChatProvider) {
  if (provider === 'openrouter') return Boolean(await loadOpenRouterApiKey());
  if (provider === 'openai') return Boolean(await loadOpenAiApiKey());
  return Boolean((await loadAnthropicApiKey()) || (await loadAnthropicAuthToken()));
}

export function missingProviderCredentialMessage(provider: ChatProvider) {
  const labelByProvider: Record<ChatProvider, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    openrouter: 'OpenRouter'
  };
  return `${labelByProvider[provider]} API key is not set. Add your key in Settings > Models & Keys.`;
}

export function setRuntimeOpenRouterApiKey(apiKey: string) {
  runtimeOpenRouterApiKey = apiKey.trim();
}

export function setRuntimeOpenAiApiKey(apiKey: string) {
  runtimeOpenAiApiKey = apiKey.trim();
}

export function setRuntimeAnthropicApiKey(apiKey: string) {
  runtimeAnthropicApiKey = apiKey.trim();
}

export function setRuntimeAnthropicAuthToken(authToken: string) {
  runtimeAnthropicAuthToken = authToken.trim();
}

function getOpenRouterApiKey() {
  const apiKey = process.env.OPENROUTER_API_KEY || runtimeOpenRouterApiKey;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it in Settings > Model Access.');
  }
  return apiKey;
}

function getOpenAiApiKey() {
  const apiKey = process.env.OPENAI_API_KEY || runtimeOpenAiApiKey;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Add it in Settings > Model Access.');
  }
  return apiKey;
}

function getAnthropicApiKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY || runtimeAnthropicApiKey;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it in Settings > Model Access.');
  }
  return apiKey;
}

function getAnthropicAuthToken() {
  return (
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_OAUTH_TOKEN ||
    runtimeAnthropicAuthToken
  );
}

function isAnthropicOAuthToken(token: string): boolean {
  return token.startsWith('sk-ant-oat') || token.startsWith('sk-ant-oauth');
}

export function getAnthropicAuthHeaders(): Record<string, string> {
  const authToken = getAnthropicAuthToken();
  if (authToken) {
    return {
      'anthropic-beta': anthropicOAuthBetaHeader,
      Authorization: `Bearer ${authToken}`
    };
  }

  const apiKey = getAnthropicApiKey();
  if (isAnthropicOAuthToken(apiKey)) {
    return {
      'anthropic-beta': anthropicOAuthBetaHeader,
      Authorization: `Bearer ${apiKey}`
    };
  }

  return { 'x-api-key': apiKey };
}

export function normalizeChatModelId(modelId: string, providerHint?: string) {
  const provider = providerHint?.toLowerCase();
  if (modelId.startsWith('openrouter/')) {
    return { modelId: modelId.slice('openrouter/'.length), provider: 'openrouter' };
  }
  if (modelId.startsWith('openrouter:')) {
    return { modelId: modelId.slice('openrouter:'.length), provider: 'openrouter' };
  }
  if (modelId.startsWith('openai/')) {
    return { modelId: modelId.slice('openai/'.length), provider: 'openai' };
  }
  if (modelId.startsWith('openai:')) {
    return { modelId: modelId.slice('openai:'.length), provider: 'openai' };
  }
  if (modelId.startsWith('anthropic/')) {
    return { modelId: modelId.slice('anthropic/'.length), provider: 'anthropic' };
  }
  if (modelId.startsWith('anthropic:')) {
    return { modelId: modelId.slice('anthropic:'.length), provider: 'anthropic' };
  }
  if (provider === 'openai' || provider === 'anthropic') {
    return { modelId, provider };
  }
  return { modelId, provider: 'openrouter' };
}

export function openrouterFastChat(modelId: string) {
  const openrouter = createOpenRouter({
    apiKey: getOpenRouterApiKey(),
    appName: 'Graphini',
    compatibility: 'strict'
  });

  return openrouter.chat(modelId, {
    includeReasoning: true,
    reasoning: {
      enabled: true,
      exclude: false,
      effort: 'medium'
    }
  });
}

export function openaiChat(modelId: string) {
  const openai = createOpenAI({
    apiKey: getOpenAiApiKey()
  });

  return openai(modelId);
}

export function anthropicChat(modelId: string) {
  const authHeaders = getAnthropicAuthHeaders();
  const anthropic = createAnthropic({
    ...(authHeaders.Authorization
      ? { authToken: authHeaders.Authorization.replace(/^Bearer\s+/i, '') }
      : { apiKey: authHeaders['x-api-key'] }),
    headers: authHeaders['anthropic-beta']
      ? { 'anthropic-beta': authHeaders['anthropic-beta'] }
      : undefined
  });

  return anthropic(modelId);
}

export function resolveChatModel(modelId: string, providerHint?: string): LanguageModel {
  const normalized = normalizeChatModelId(modelId, providerHint);
  if (normalized.provider === 'openai') return openaiChat(normalized.modelId);
  if (normalized.provider === 'anthropic') return anthropicChat(normalized.modelId);
  return openrouterFastChat(normalized.modelId);
}

function supportsAnthropicAdaptiveThinking(modelId: string): boolean {
  return !/\bhaiku\b/i.test(modelId);
}

export function getChatProviderOptions(
  modelId: string,
  providerHint?: string
): ProviderMetadata | undefined {
  const normalized = normalizeChatModelId(modelId, providerHint);
  if (normalized.provider === 'openai') {
    return {
      openai: {
        reasoningEffort: 'medium' as const,
        reasoningSummary: 'auto' as const,
        store: false
      }
    };
  }
  if (normalized.provider === 'anthropic') {
    if (!supportsAnthropicAdaptiveThinking(normalized.modelId)) {
      return {
        anthropic: {
          toolStreaming: true
        }
      };
    }

    return {
      anthropic: {
        contextManagement: {
          edits: [
            {
              keep: { type: 'thinking_turns' as const, value: 1 },
              type: 'clear_thinking_20251015' as const
            }
          ]
        },
        sendReasoning: true,
        thinking: { display: 'summarized' as const, type: 'adaptive' as const },
        toolStreaming: true
      }
    };
  }
  return undefined;
}
