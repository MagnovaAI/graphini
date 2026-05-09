/**
 * Chat model resolver.
 *
 * Pure: every function takes the credentials it needs as a parameter. No DB
 * lookups, no environment-variable fallbacks, no module-level state. This is
 * the contract for the local-settings revamp — provider keys travel from the
 * user's localStorage to the server in `x-provider-*` request headers, get
 * pulled out via `extractProviderKeys`, and are passed in by the caller.
 *
 * If a key is missing, `resolveChatModelFor` throws via
 * `missingProviderKeyError`, which surfaces a 400 with a Settings-routable
 * message.
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { missingProviderKeyError, type ProviderKeys } from '$lib/server/auth/provider-keys';
import type { LanguageModel, ProviderMetadata } from 'ai';

export type ChatProvider = 'openrouter' | 'openai' | 'anthropic';

const ANTHROPIC_OAUTH_BETA_HEADER = 'oauth-2025-04-20';

function isAnthropicOAuthToken(token: string): boolean {
  return token.startsWith('sk-ant-oat') || token.startsWith('sk-ant-oauth');
}

export function normalizeChatModelId(
  modelId: string,
  providerHint?: string
): { modelId: string; provider: ChatProvider } {
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

/**
 * Build an OpenRouter language model with an explicit API key.
 *
 * Exported because subagent tools (diagramPatch, markdownWrite, ...) need to
 * construct lightweight chat clients with the same key the originating
 * request supplied. They get the key via `ToolContext.keys`.
 */
export function buildOpenRouterChat(modelId: string, apiKey: string): LanguageModel {
  const openrouter = createOpenRouter({
    apiKey,
    appName: 'Graphini',
    compatibility: 'strict'
  });
  return openrouter.chat(modelId, {
    includeReasoning: true,
    reasoning: {
      effort: 'medium',
      enabled: true,
      exclude: false
    }
  });
}

export function buildOpenAiChat(modelId: string, apiKey: string): LanguageModel {
  const openai = createOpenAI({ apiKey });
  return openai(modelId);
}

/**
 * Build an Anthropic language model.
 *
 * Auth precedence:
 *   1. authToken (the dedicated OAuth slot) wins, since OAuth tokens can be
 *      issued per-user with narrower scope than a raw api_key.
 *   2. apiKey, treated as OAuth if it has the `sk-ant-oauth` / `sk-ant-oat`
 *      prefix (some flows only have one slot, the token lands there).
 *   3. apiKey, treated as a regular API key otherwise.
 */
export function buildAnthropicChat(
  modelId: string,
  apiKey: string,
  authToken: string
): LanguageModel {
  const explicitToken = authToken || (apiKey && isAnthropicOAuthToken(apiKey) ? apiKey : '');
  const anthropic = createAnthropic({
    ...(explicitToken ? { authToken: explicitToken } : { apiKey }),
    headers: explicitToken ? { 'anthropic-beta': ANTHROPIC_OAUTH_BETA_HEADER } : undefined
  });
  return anthropic(modelId);
}

/**
 * Whether `keys` carries enough credential to use `provider`. Used by the
 * harness to fail fast with a Settings-routable 400 before model construction.
 */
export function hasProviderKey(provider: ChatProvider, keys: ProviderKeys): boolean {
  if (provider === 'openrouter') return Boolean(keys.openrouter);
  if (provider === 'openai') return Boolean(keys.openai);
  // Anthropic accepts either a regular API key or an OAuth token.
  return Boolean(keys.anthropic) || Boolean(keys.anthropicAuthToken);
}

/**
 * Resolve a `LanguageModel` for the given (modelId, providerHint) pair using
 * the request's provider keys. Throws `missingProviderKeyError` if the
 * required key is empty.
 */
export function resolveChatModelFor(
  modelId: string,
  providerHint: string | undefined,
  keys: ProviderKeys
): LanguageModel {
  const normalized = normalizeChatModelId(modelId, providerHint);
  if (normalized.provider === 'openai') {
    if (!keys.openai) missingProviderKeyError('openai');
    return buildOpenAiChat(normalized.modelId, keys.openai);
  }
  if (normalized.provider === 'anthropic') {
    if (!keys.anthropic && !keys.anthropicAuthToken) {
      missingProviderKeyError('anthropic');
    }
    return buildAnthropicChat(normalized.modelId, keys.anthropic, keys.anthropicAuthToken);
  }
  if (!keys.openrouter) missingProviderKeyError('openrouter');
  return buildOpenRouterChat(normalized.modelId, keys.openrouter);
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
