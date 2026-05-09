import { generateText } from 'ai';
import {
  buildAnthropicChat,
  buildOpenAiChat,
  buildOpenRouterChat,
  type ChatProvider
} from './chat/model';
import { missingProviderKeyError, type ProviderKeys } from './auth/provider-keys';

export type ModelLabProvider = Extract<ChatProvider, 'openai' | 'anthropic' | 'openrouter'>;

export interface ModelSearchResult {
  contextWindow?: number;
  created?: number;
  description?: string;
  id: string;
  name: string;
  provider: ModelLabProvider;
  supportedParameters?: string[];
}

export interface ModelSmokeResult {
  elapsedMs: number;
  finishReason: string;
  modelId: string;
  prompt: string;
  provider: ModelLabProvider;
  text: string;
  usage: unknown;
}

export const modelLabPromptPresets = [
  'Create YouTube system design as a Mermaid flowchart.',
  'Create Netflix video streaming system design as a Mermaid flowchart.',
  'Create Uber ride matching system design as a Mermaid flowchart.',
  'Create WhatsApp real-time messaging system design as a Mermaid flowchart.',
  'Create Twitter/X timeline feed system design as a Mermaid flowchart.',
  'Create Instagram photo upload and feed system design as a Mermaid flowchart.',
  'Create Google Docs collaborative editing system design as a Mermaid flowchart.',
  'Create Dropbox file sync system design as a Mermaid flowchart.',
  'Create Stripe checkout payment system design as a Mermaid flowchart.',
  'Create Slack notification delivery system design as a Mermaid flowchart.',
  'Create Zoom video call system design as a Mermaid flowchart.',
  'Create TikTok recommendation system design as a Mermaid flowchart.',
  'Create URL shortener system design as a Mermaid flowchart.',
  'Create search autocomplete system design as a Mermaid flowchart.',
  'Create CDN image resizing system design as a Mermaid flowchart.',
  'Create API rate limiter system design as a Mermaid flowchart.'
];

export const defaultOpenRouterDiagramModel = 'nvidia/nemotron-3-super-120b-a12b:free';

function isModelLabProvider(provider: string): provider is ModelLabProvider {
  return provider === 'openai' || provider === 'anthropic' || provider === 'openrouter';
}

export function parseModelLabProvider(provider: string | null): ModelLabProvider {
  const normalized = provider?.toLowerCase() ?? '';
  if (!isModelLabProvider(normalized)) {
    throw new Error('Provider must be one of: openai, anthropic, openrouter.');
  }
  return normalized;
}

function matchesQuery(model: ModelSearchResult, query: string): boolean {
  if (!query) return true;
  const haystack = `${model.id} ${model.name} ${model.description ?? ''}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function limitResults(models: ModelSearchResult[], limit: number): ModelSearchResult[] {
  return models.slice(0, Math.max(1, Math.min(limit, 100)));
}

/**
 * Build the Anthropic auth headers for the admin model-listing call. Mirrors
 * the precedence in buildAnthropicChat: explicit OAuth token wins, an
 * api_key shaped like `sk-ant-oauth*` is also treated as OAuth, otherwise
 * a regular x-api-key header.
 */
function anthropicListHeaders(keys: ProviderKeys): Record<string, string> {
  const oauthShaped = (k: string) => k.startsWith('sk-ant-oat') || k.startsWith('sk-ant-oauth');
  const explicitToken =
    keys.anthropicAuthToken ||
    (keys.anthropic && oauthShaped(keys.anthropic) ? keys.anthropic : '');
  if (explicitToken) {
    return {
      'anthropic-beta': 'oauth-2025-04-20',
      Authorization: `Bearer ${explicitToken}`
    };
  }
  return { 'x-api-key': keys.anthropic };
}

export async function searchProviderModels({
  keys,
  limit = 25,
  provider,
  query = ''
}: {
  keys: ProviderKeys;
  limit?: number;
  provider: ModelLabProvider;
  query?: string;
}): Promise<ModelSearchResult[]> {
  const models =
    provider === 'openai'
      ? await listOpenAiModels(keys)
      : provider === 'anthropic'
        ? await listAnthropicModels(keys)
        : await listOpenRouterModels(keys);

  return limitResults(
    models.filter((model) => matchesQuery(model, query)),
    limit
  );
}

async function listOpenAiModels(keys: ProviderKeys): Promise<ModelSearchResult[]> {
  if (!keys.openai) missingProviderKeyError('openai');

  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${keys.openai}` }
  });
  if (!response.ok) throw new Error(`OpenAI models API error: ${response.status}`);

  const data = (await response.json()) as {
    data?: { created?: number; id: string; owned_by?: string }[];
  };
  return (data.data ?? []).map((model) => ({
    created: model.created,
    description: model.owned_by ? `Owned by ${model.owned_by}` : undefined,
    id: model.id,
    name: model.id,
    provider: 'openai'
  }));
}

async function listAnthropicModels(keys: ProviderKeys): Promise<ModelSearchResult[]> {
  if (!keys.anthropic && !keys.anthropicAuthToken) missingProviderKeyError('anthropic');

  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'anthropic-version': '2023-06-01',
      ...anthropicListHeaders(keys)
    }
  });
  if (!response.ok) throw new Error(`Anthropic models API error: ${response.status}`);

  const data = (await response.json()) as {
    data?: { created_at?: string; display_name?: string; id: string }[];
  };
  return (data.data ?? []).map((model) => ({
    created: model.created_at ? Date.parse(model.created_at) : undefined,
    id: model.id,
    name: model.display_name ?? model.id,
    provider: 'anthropic'
  }));
}

async function listOpenRouterModels(keys: ProviderKeys): Promise<ModelSearchResult[]> {
  // OpenRouter's /v1/models endpoint works without auth (returns the full
  // catalog), but a key gives access to the user's enabled-only filter.
  // Don't require it — admins can browse anonymously.
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: keys.openrouter ? { Authorization: `Bearer ${keys.openrouter}` } : undefined
  });
  if (!response.ok) throw new Error(`OpenRouter models API error: ${response.status}`);

  const data = (await response.json()) as {
    data?: {
      context_length?: number;
      created?: number;
      description?: string;
      id: string;
      name?: string;
      supported_parameters?: string[];
    }[];
  };
  return (data.data ?? []).map((model) => ({
    contextWindow: model.context_length,
    created: model.created,
    description: model.description,
    id: model.id,
    name: model.name ?? model.id,
    provider: 'openrouter',
    supportedParameters: model.supported_parameters
  }));
}

export async function smokeTestProviderModel({
  keys,
  maxOutputTokens = 80,
  modelId,
  prompt = modelLabPromptPresets[0],
  provider
}: {
  keys: ProviderKeys;
  maxOutputTokens?: number;
  modelId: string;
  prompt?: string;
  provider: ModelLabProvider;
}): Promise<ModelSmokeResult> {
  // Construct the right model client directly. resolveChatModelFor would
  // also work, but we already know the exact provider here so we skip
  // normalization and the providerHint dance.
  const model =
    provider === 'openai'
      ? (() => {
          if (!keys.openai) missingProviderKeyError('openai');
          return buildOpenAiChat(modelId, keys.openai);
        })()
      : provider === 'anthropic'
        ? (() => {
            if (!keys.anthropic && !keys.anthropicAuthToken) missingProviderKeyError('anthropic');
            return buildAnthropicChat(modelId, keys.anthropic, keys.anthropicAuthToken);
          })()
        : (() => {
            if (!keys.openrouter) missingProviderKeyError('openrouter');
            return buildOpenRouterChat(modelId, keys.openrouter);
          })();

  const startedAt = performance.now();
  const result = await generateText({
    maxOutputTokens,
    model,
    prompt,
    temperature: 0
  });

  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    finishReason: result.finishReason,
    modelId,
    prompt,
    provider,
    text: result.text.trim(),
    usage: result.totalUsage
  };
}
