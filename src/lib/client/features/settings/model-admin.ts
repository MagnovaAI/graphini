export interface ProviderOption {
  id: string;
  label: string;
  baseUrl: string;
  requiresApiKey: boolean;
  description: string;
}

export function normalizeModelId(provider: string, model: string): string {
  if (model.includes('/')) return model;
  if (model.includes(':')) return model.replace(':', '/');
  return `${provider}/${model}`;
}

export async function adminFetch(action: string, params: Record<string, string> = {}) {
  const search = new URLSearchParams({ action, ...params });
  const res = await fetch(`/api/admin?${search}`, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Failed to load ${action}`);
  }
  return data.data;
}

export async function adminPost(body: Record<string, unknown>) {
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(data.error || 'Admin action failed');
  }
  return data.data;
}

export function mapProviderSettings(settings: Record<string, any>[]): ProviderOption[] {
  return settings.map((provider) => ({
    id: provider.key,
    label: provider.value.label,
    baseUrl: provider.value.baseUrl,
    requiresApiKey: provider.value.requiresApiKey,
    description: provider.value.description
  }));
}

export function ensureGeminiProvider(providers: ProviderOption[]): ProviderOption[] {
  if (providers.some((provider) => provider.id === 'gemini')) return providers;

  return [
    ...providers,
    {
      id: 'gemini',
      label: 'Google Gemini',
      baseUrl: '',
      requiresApiKey: true,
      description: "Google's Gemini AI models with function calling support"
    }
  ];
}

export function buildOpenRouterImportPayload(model: Record<string, any>) {
  return {
    category: model.architecture?.modality || 'General',
    description: (model.description || '').slice(0, 120),
    gems_per_message: model.pricing?.prompt === '0' && model.pricing?.completion === '0' ? 1 : 2,
    is_free: model.pricing?.prompt === '0' && model.pricing?.completion === '0',
    max_tokens: model.context_length || 4000,
    metadata: { openrouter_id: model.id, pricing: model.pricing },
    model_id: `openrouter/${model.id}`,
    model_name: model.name || model.id,
    provider: 'openrouter',
    tool_support: true
  };
}
