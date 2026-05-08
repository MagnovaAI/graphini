/**
 * Model Store (Svelte 5 runes)
 * Manages AI model providers, favorites, and chat selection.
 */

import { hmrPreserve, hmrRestore } from '$lib/client/util/hmr';

// Model interface for the chat component
export interface ModelOption {
  id: string;
  name: string;
  icon: string;
  category?: string;
  toolSupport?: boolean;
  maxTokens?: number;
  costPerToken?: number;
  description?: string;
  provider?: string;
}

// ── State ──

const _hmrModelStore = hmrRestore<{
  allModels: Record<string, ModelOption[]>;
  favoriteModels: string[];
  selectedChatModels: ModelOption[];
}>('modelStoreState');
let allModels = $state<Record<string, ModelOption[]>>(_hmrModelStore?.allModels ?? {});
let favoriteModels = $state<string[]>(_hmrModelStore?.favoriteModels ?? []);
let selectedChatModels = $state<ModelOption[]>(_hmrModelStore?.selectedChatModels ?? []);
let loading = $state(false);
hmrPreserve('modelStoreState', () => ({ allModels, favoriteModels, selectedChatModels }));

// ── Exported store objects ──

export const allModelsStore = {
  get value() {
    return allModels;
  },
  set(v: Record<string, ModelOption[]>) {
    allModels = v;
  }
};

export const favoriteModelsStore = {
  get value() {
    return favoriteModels;
  },
  set(v: string[]) {
    favoriteModels = v;
  },
  update(fn: (current: string[]) => string[]) {
    favoriteModels = fn(favoriteModels);
  }
};

export const selectedChatModelsStore = {
  get value() {
    return selectedChatModels;
  },
  set(v: ModelOption[]) {
    selectedChatModels = v;
  },
  update(fn: (current: ModelOption[]) => ModelOption[]) {
    selectedChatModels = fn(selectedChatModels);
  }
};

export const modelsLoadingStore = {
  get value() {
    return loading;
  },
  set(v: boolean) {
    loading = v;
  }
};

// ── Derived helpers ──

export function getModelsForProvider(provider: string): ModelOption[] {
  return allModels[provider] || [];
}

export function getFavoriteModelsForProvider(provider: string): ModelOption[] {
  const providerModels = allModels[provider] || [];
  return providerModels.filter((model) => favoriteModels.includes(`${provider}:${model.id}`));
}

// ── Actions ──

export async function loadModelsFromAPI() {
  loading = true;
  try {
    // Load providers
    const providersRes = await fetch('/api/admin?action=providers');
    if (!providersRes.ok) {
      console.warn(
        '[models] Skipping provider load because the server returned',
        providersRes.status,
        providersRes.statusText
      );
      return;
    }
    const providersData = await providersRes.json();

    // Load models
    const modelsRes = await fetch('/api/admin?action=models');
    if (!modelsRes.ok) {
      console.warn(
        '[models] Skipping model load because the server returned',
        modelsRes.status,
        modelsRes.statusText
      );
      return;
    }
    const modelsData = await modelsRes.json();

    const models: Record<string, ModelOption[]> = {};

    if (providersData.success && modelsData.success) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      modelsData.data.forEach((m: any) => {
        if (!m.key) return;
        const provider = m.key.split(':')[0];
        if (!models[provider]) {
          models[provider] = [];
        }

        models[provider].push({
          category: m.value?.category,
          costPerToken: m.value?.costPerToken,
          description: m.value?.description,
          icon: getModelIcon(provider),
          id: m.value?.id ?? m.key,
          maxTokens: m.value?.maxTokens,
          name: m.value?.label ?? m.key,
          provider: provider,
          toolSupport: m.value?.toolSupport
        });
      });
    }

    allModels = models;
  } catch (error) {
    console.error('Failed to load models from API:', error);
  } finally {
    loading = false;
  }
}

export function toggleFavoriteModel(fullModelId: string) {
  if (favoriteModels.includes(fullModelId)) {
    favoriteModels = favoriteModels.filter((id) => id !== fullModelId);
  } else {
    favoriteModels = [...favoriteModels, fullModelId];
  }
}

export function isFavoriteModel(fullModelId: string): boolean {
  return favoriteModels.includes(fullModelId);
}

export function addToChatSelection(model: ModelOption) {
  if (selectedChatModels.length >= 10) {
    throw new Error('Maximum 10 models allowed in chat selection');
  }
  if (!selectedChatModels.find((m) => m.id === model.id)) {
    selectedChatModels = [...selectedChatModels, model];
  }
}

export function removeFromChatSelection(modelId: string) {
  selectedChatModels = selectedChatModels.filter((m) => m.id !== modelId);
}

export function updateChatSelection(models: ModelOption[]) {
  if (models.length > 10) {
    throw new Error('Maximum 10 models allowed in chat selection');
  }
  selectedChatModels = models;
}

// Helper function to get icon for provider
function getModelIcon(provider: string): string {
  const icons: Record<string, string> = {
    anthropic: '🧬',
    gemini: '✨',
    kilo: '⚙️',
    openai: '🧠',
    openrouter: '🌐'
  };
  return icons[provider] || '🤖';
}

// Do not auto-load on import — this store calls admin-only endpoints.
// Call loadModelsFromAPI() explicitly from admin-only contexts.
