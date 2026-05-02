/**
 * Public Models API - Returns enabled models for users
 * Reads from enabled_models table (admin-managed via DB)
 */

import { getDb } from '$lib/server/db';
import { json, type RequestHandler } from '@sveltejs/kit';

function numberFromMetadata(metadata: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
}

function inferContextWindow(model: {
  max_tokens?: number;
  metadata?: Record<string, unknown> | null;
  model_id: string;
  provider?: string | null;
}): number {
  const metadata = model.metadata ?? {};
  const metadataContext = numberFromMetadata(metadata, [
    'contextWindow',
    'context_window',
    'contextLength',
    'context_length',
    'maxContextTokens',
    'max_context_tokens'
  ]);
  if (metadataContext) return metadataContext;

  const id = model.model_id.toLowerCase();
  const provider = model.provider?.toLowerCase();

  if (provider === 'anthropic' || id.includes('claude')) {
    return 200000;
  }
  if (id.includes('gpt-4.1') || id.includes('gpt-4o') || id.includes('o3') || id.includes('o4')) {
    return 128000;
  }
  if (id.includes('gpt-5')) {
    return 400000;
  }

  return model.max_tokens && model.max_tokens > 8000 ? model.max_tokens : 128000;
}

function inferImageSupport(model: {
  category?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  model_id: string;
}): boolean {
  const metadata = model.metadata ?? {};
  for (const key of [
    'imageSupport',
    'image_support',
    'supportsImages',
    'supports_images',
    'vision'
  ]) {
    const value = metadata[key];
    if (typeof value === 'boolean') return value;
  }

  const supportedParameters = metadata.supported_parameters;
  if (
    Array.isArray(supportedParameters) &&
    supportedParameters.some((item) => String(item).toLowerCase().includes('image'))
  ) {
    return true;
  }

  const searchable = [model.model_id, model.category, model.description].join(' ').toLowerCase();
  return /\b(vision|image|multimodal|omni|gpt-4o|claude-3|claude-4|gemini|pixtral|llava|qwen.*vl)\b/.test(
    searchable
  );
}

export const GET: RequestHandler = async () => {
  try {
    const db = getDb();
    const enabledModels = await db.listEnabledModels(true);

    const models = enabledModels.map((m: any) => ({
      id: m.model_id,
      name: m.model_name,
      provider: m.provider || 'openrouter',
      category: m.category || 'General',
      toolSupport: m.tool_support || false,
      description: m.description || '',
      gemsPerMessage: m.gems_per_message ?? 2,
      isFree: m.is_free || false,
      isEnabled: m.is_enabled !== false,
      imageSupport: inferImageSupport(m),
      contextWindow: inferContextWindow(m),
      maxTokens: m.max_tokens || 4000
    }));

    return json({ success: true, data: models });
  } catch (error) {
    console.error('Models API error:', error);
    return json({ success: false, error: 'Failed to fetch models' }, { status: 500 });
  }
};
