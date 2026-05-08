/**
 * Models Store - Fetches available models from API and manages selection
 */
import { hmrRestore, hmrPreserve } from '$lib/util/hmr';

interface AvailableModel {
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
  selectedModelId: string;
  lastFetched: number;
}>('modelsState');
let models = $state<AvailableModel[]>(_hmrModels?.models ?? []);
let selectedModelId = $state<string>(_hmrModels?.selectedModelId ?? '');
let isLoading = $state(false);
let lastFetched = $state(_hmrModels?.lastFetched ?? 0);
hmrPreserve('modelsState', () => ({ models, selectedModelId, lastFetched }));

async function fetchModels(): Promise<void> {
  // Don't refetch if we fetched within the last 60 seconds
  if (
    Date.now() - lastFetched < 60000 &&
    models.length > 0 &&
    models.every((model) => typeof model.contextWindow === 'number')
  ) {
    return;
  }

  isLoading = true;
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      models = data.data;
      lastFetched = Date.now();

      const isKnown = (id: string) => models.some((m) => m.id === id);
      if (selectedModelId && !isKnown(selectedModelId)) {
        // Saved selection points at a model that's no longer enabled — drop it
        // so we don't ship an unknown id to the provider.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const kvMod = (globalThis as any).__kvStoreModule;
          if (kvMod) kvMod.set('models', 'graphini_selected_model', '');
        } catch {
          /* silent */
        }
        selectedModelId = '';
      }
      if (!selectedModelId && models.length > 0) {
        selectedModelId = models[0].id;
      }
    }
  } catch (error) {
    console.error('Failed to fetch models:', error);
  }
  isLoading = false;
}

function selectModel(id: string): void {
  selectedModelId = id;
  // Persist selection
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kvMod = (globalThis as any).__kvStoreModule;
    if (kvMod) kvMod.set('models', 'graphini_selected_model', id);
  } catch {
    /* silent */
  }
}

function loadSavedSelection(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kvMod = (globalThis as any).__kvStoreModule;
    if (kvMod) {
      const saved = kvMod.get('models', 'graphini_selected_model');
      if (saved) selectedModelId = saved;
    }
  } catch {
    /* silent */
  }
}

function getSelectedModel(): AvailableModel | undefined {
  return models.find((m) => m.id === selectedModelId);
}

export const modelsStore = {
  fetch: fetchModels,
  get freeModels() {
    return models.filter((m) => m.isFree);
  },
  get isLoading() {
    return isLoading;
  },
  loadSaved: loadSavedSelection,
  get models() {
    return models;
  },
  get paidModels() {
    return models.filter((m) => !m.isFree);
  },
  select: selectModel,
  get selectedModel() {
    return getSelectedModel();
  },
  get selectedModelId() {
    return selectedModelId;
  }
};
