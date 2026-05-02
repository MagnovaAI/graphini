import { generateText } from 'ai';
import {
  getAnthropicAuthHeaders,
  loadAnthropicAuthToken,
  loadAnthropicApiKey,
  loadOpenAiApiKey,
  loadOpenRouterApiKey,
  loadProviderApiKeys,
  resolveChatModel,
  type ChatProvider
} from './chat/model';

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

export async function searchProviderModels({
  limit = 25,
  provider,
  query = ''
}: {
  limit?: number;
  provider: ModelLabProvider;
  query?: string;
}): Promise<ModelSearchResult[]> {
  const models =
    provider === 'openai'
      ? await listOpenAiModels()
      : provider === 'anthropic'
        ? await listAnthropicModels()
        : await listOpenRouterModels();

  return limitResults(
    models.filter((model) => matchesQuery(model, query)),
    limit
  );
}

async function listOpenAiModels(): Promise<ModelSearchResult[]> {
  const apiKey = await loadOpenAiApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set. Add it in Settings > Model Access.');

  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` }
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

async function listAnthropicModels(): Promise<ModelSearchResult[]> {
  await Promise.all([loadAnthropicApiKey(), loadAnthropicAuthToken()]);

  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'anthropic-version': '2023-06-01',
      ...getAnthropicAuthHeaders()
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

async function listOpenRouterModels(): Promise<ModelSearchResult[]> {
  const apiKey = await loadOpenRouterApiKey();
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
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
  maxOutputTokens = 80,
  modelId,
  prompt = modelLabPromptPresets[0],
  provider
}: {
  maxOutputTokens?: number;
  modelId: string;
  prompt?: string;
  provider: ModelLabProvider;
}): Promise<ModelSmokeResult> {
  await loadProviderApiKeys();
  const startedAt = performance.now();
  const result = await generateText({
    maxOutputTokens,
    model: resolveChatModel(modelId, provider),
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
