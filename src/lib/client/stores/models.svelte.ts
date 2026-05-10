/**
 * Models Store - Fetches available models from API and manages selection
 */
import { hmrRestore, hmrPreserve } from '$lib/client/util/hmr';
import { modelSettings, type UserSavedModel } from './settings.svelte';

export interface AvailableModel {
  id: string;
  name: string;
  provider: string;
  category: string;
  contextWindow: number;
  toolSupport: boolean;
  description: string;
  gemsPerMessage: number;
  isFree: boolean;
  isEnabled: boolean;
  imageSupport: boolean;
  maxTokens: number;
}

const _hmrModels = hmrRestore<{
  models: AvailableModel[];
  lastFetched: number;
}>('modelsState');
let remoteModels = $state<AvailableModel[]>(_hmrModels?.models ?? []);
let isLoading = $state(false);
let lastFetched = $state(_hmrModels?.lastFetched ?? 0);
hmrPreserve('modelsState', () => ({ models: remoteModels, lastFetched }));

function normalizeApiModel(model: Partial<AvailableModel>): AvailableModel {
  const id = String(model.id ?? '');
  return {
    category: String(model.category ?? 'General'),
    contextWindow:
      typeof model.contextWindow === 'number' && model.contextWindow > 0
        ? model.contextWindow
        : 128000,
    description: String(model.description ?? ''),
    gemsPerMessage:
      typeof model.gemsPerMessage === 'number' && model.gemsPerMessage > 0
        ? model.gemsPerMessage
        : 2,
    id,
    imageSupport: model.imageSupport === true,
    isEnabled: model.isEnabled !== false,
    isFree: model.isFree === true,
    maxTokens: typeof model.maxTokens === 'number' && model.maxTokens > 0 ? model.maxTokens : 4000,
    name: String(model.name ?? id),
    provider: String(model.provider ?? inferProvider(id)),
    toolSupport: model.toolSupport !== false
  };
}

function inferProvider(modelId: string): string {
  if (modelId.startsWith('openai/')) return 'openai';
  if (modelId.startsWith('anthropic/')) return 'anthropic';
  if (modelId.startsWith('openrouter/')) return 'openrouter';
  return 'openrouter';
}

function savedModels(): AvailableModel[] {
  return modelSettings.value.models.filter((model) => model.isEnabled !== false);
}

function activeModels(): AvailableModel[] {
  const local = savedModels();
  return modelSettings.value.models.length > 0 ? local : remoteModels;
}

function persistModels(
  models: AvailableModel[],
  selectedModelId = modelSettings.value.selectedModelId
): void {
  const enabled = models.map((model) => normalizeApiModel(model));
  const nextSelected =
    selectedModelId && enabled.some((model) => model.id === selectedModelId)
      ? selectedModelId
      : enabled[0]?.id || '';
  modelSettings.set({
    models: enabled as UserSavedModel[],
    selectedModelId: nextSelected
  });
}

async function fetchModels(): Promise<void> {
  if (modelSettings.value.models.length > 0) {
    const isKnown = savedModels().some((model) => model.id === modelSettings.value.selectedModelId);
    if (!isKnown) {
      modelSettings.update((settings) => ({
        ...settings,
        selectedModelId: savedModels()[0]?.id || ''
      }));
    }
    return;
  }

  // Don't refetch if we fetched within the last 60 seconds
  if (
    Date.now() - lastFetched < 60000 &&
    remoteModels.length > 0 &&
    remoteModels.every((model) => typeof model.contextWindow === 'number')
  ) {
    persistModels(remoteModels);
    return;
  }

  isLoading = true;
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      remoteModels = data.data.map((model: Partial<AvailableModel>) => normalizeApiModel(model));
      lastFetched = Date.now();
      persistModels(remoteModels);
    }
  } catch (error) {
    console.error('Failed to fetch models:', error);
  }
  isLoading = false;
}

function selectModel(id: string): void {
  modelSettings.update((settings) => ({ ...settings, selectedModelId: id }));
}

function loadSavedSelection(): void {
  if (modelSettings.value.selectedModelId) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kvMod = (globalThis as any).__kvStoreModule;
    if (kvMod) {
      const saved = kvMod.get('models', 'graphini_selected_model');
      if (typeof saved === 'string' && saved) selectModel(saved);
    }
  } catch {
    /* silent */
  }
}

function getSelectedModel(): AvailableModel | undefined {
  return activeModels().find((m) => m.id === modelSettings.value.selectedModelId);
}

export const modelsStore = {
  fetch: fetchModels,
  get freeModels() {
    return activeModels().filter((m) => m.isFree);
  },
  get isLoading() {
    return isLoading;
  },
  loadSaved: loadSavedSelection,
  get models() {
    return activeModels();
  },
  get paidModels() {
    return activeModels().filter((m) => !m.isFree);
  },
  select: selectModel,
  get selectedModel() {
    return getSelectedModel();
  },
  get selectedModelId() {
    return modelSettings.value.selectedModelId;
  }
};
