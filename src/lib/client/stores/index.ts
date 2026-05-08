/**
 * Stores Index
 * Central export for all application stores
 */

// Settings (Svelte 5 runes)
export {
  aiSettings,
  editorSettings,
  getSessionId,
  getUserId,
  personalizationSettings,
  setUserId,
  uiSettings,
  type AISettings,
  type EditorSettings,
  type PersonalizationRule,
  type PersonalizationSettings,
  type PersonalizationSkill,
  type UISettings
} from './settings.svelte';

// Model stores for AI model management
export {
  addToChatSelection,
  allModelsStore,
  favoriteModelsStore,
  getFavoriteModelsForProvider,
  getModelsForProvider,
  isFavoriteModel,
  loadModelsFromAPI,
  modelsLoadingStore,
  removeFromChatSelection,
  selectedChatModelsStore,
  toggleFavoriteModel,
  updateChatSelection,
  type ModelOption
} from './modelStore.svelte';

// Tools configuration store
export { TOOL_CATEGORIES, toolsStore, type ToolConfig } from './toolsStore.svelte';

// Workspace store (diagram workspace management)
export { workspaceStore } from './workspace.svelte';
