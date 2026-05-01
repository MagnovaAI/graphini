import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { settingsManager } from '$lib/server/state-manager';

let runtimeOpenRouterApiKey = '';

export async function loadOpenRouterApiKey() {
  runtimeOpenRouterApiKey =
    process.env.OPENROUTER_API_KEY ||
    (await settingsManager.get<string | null>(null, 'ai_provider', 'openrouter_api_key', null)) ||
    '';
  return runtimeOpenRouterApiKey;
}

export function setRuntimeOpenRouterApiKey(apiKey: string) {
  runtimeOpenRouterApiKey = apiKey.trim();
}

function getOpenRouterApiKey() {
  const apiKey = process.env.OPENROUTER_API_KEY || runtimeOpenRouterApiKey;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Add it in Settings > Model Access.');
  }
  return apiKey;
}

export function openrouterFastChat(modelId: string) {
  const openrouter = createOpenRouter({
    apiKey: getOpenRouterApiKey()
  });

  return openrouter.chat(modelId, {
    includeReasoning: true,
    reasoning: {
      enabled: true,
      exclude: false,
      max_tokens: 96
    }
  });
}
