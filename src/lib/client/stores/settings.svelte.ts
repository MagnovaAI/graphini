/**
 * Persistent Settings Store — Svelte 5 runes replacement for persistentStore.ts
 * Uses PersistentSetting<T> class backed by kvStore for persistence.
 */

import { browser } from '$app/environment';
import { kv } from './kvStore.svelte';
import { hmrRestore, hmrPreserve } from '$lib/client/util/hmr';

// ---------------------------------------------------------------------------
// PersistentSetting<T>
// ---------------------------------------------------------------------------

export class PersistentSetting<T extends object> {
  value = $state<T>({} as T);

  private key: string;
  private defaultValue: T;

  constructor(key: string, defaultValue: T) {
    this.key = key;
    this.defaultValue = defaultValue;

    // Load from kv and merge with defaults
    const stored = browser ? kv.get<Partial<T>>('settings', 'mermaid_' + key) : null;
    this.value = stored ? { ...defaultValue, ...stored } : { ...defaultValue };
  }

  set(newValue: T): void {
    this.value = newValue;
    if (browser) {
      kv.set('settings', 'mermaid_' + this.key, newValue);
    }
  }

  update(fn: (v: T) => T): void {
    const updated = fn(this.value);
    this.set(updated);
  }

  reset(): void {
    this.set({ ...this.defaultValue });
  }
}

// ---------------------------------------------------------------------------
// UISettings
// ---------------------------------------------------------------------------

export interface UISettings {
  theme: 'light' | 'dark' | 'system';
  sidebarOpen: boolean;
  showReasoning: boolean;
  autoScroll: boolean;
  compactMode: boolean;
  fontSize: 'small' | 'medium' | 'large';
}

export const uiSettings =
  (hmrRestore('uiSettings') as PersistentSetting<UISettings> | undefined) ??
  new PersistentSetting<UISettings>('ui_settings', {
    autoScroll: true,
    compactMode: false,
    fontSize: 'medium',
    showReasoning: true,
    sidebarOpen: true,
    theme: 'system'
  });
hmrPreserve('uiSettings', () => uiSettings);

// ---------------------------------------------------------------------------
// AISettings
// ---------------------------------------------------------------------------

export interface AISettings {
  provider: 'openai' | 'anthropic' | 'openrouter' | 'kilo' | 'gemini';
  model: string;
  providerModel?: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
  promptMode: 'simple' | 'advanced' | 'visual';
  streamResponse: boolean;
  favoriteModels: string[];
  openaiApiKey?: string;
  anthropicApiKey?: string;
  anthropicAuthToken?: string;
  openrouterApiKey?: string;
  kiloApiKey?: string;
  geminiApiKey?: string;
}

export const aiSettings =
  (hmrRestore('aiSettings') as PersistentSetting<AISettings> | undefined) ??
  new PersistentSetting<AISettings>('ai_settings', {
    anthropicApiKey: '',
    anthropicAuthToken: '',
    favoriteModels: ['gpt-4o', 'anthropic/claude-3.5-sonnet', 'gemini-3-flash-preview'],
    geminiApiKey: '',
    kiloApiKey: '',
    maxTokens: 4000,
    model: 'gpt-4o',
    openaiApiKey: '',
    openrouterApiKey: '',
    promptMode: 'simple',
    provider: 'openai',
    providerModel: 'gpt-4o',
    streamResponse: true,
    temperature: 0.9
  });
hmrPreserve('aiSettings', () => aiSettings);

// ---------------------------------------------------------------------------
// PersonalizationSettings
// ---------------------------------------------------------------------------

export interface PersonalizationRule {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
  source: 'manual' | 'imported' | 'model';
}

export interface PersonalizationSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: 'manual' | 'imported' | 'model';
}

export interface PersonalizationSettings {
  memoryAutoSave: boolean;
  memorySaveMode: 'conservative' | 'balanced' | 'aggressive';
  memoryReviewBeforeSave: boolean;
  rules: PersonalizationRule[];
  skills: PersonalizationSkill[];
}

export const personalizationSettings =
  (hmrRestore('personalizationSettings') as
    | PersistentSetting<PersonalizationSettings>
    | undefined) ??
  new PersistentSetting<PersonalizationSettings>('personalization_settings', {
    memoryAutoSave: true,
    memoryReviewBeforeSave: true,
    memorySaveMode: 'balanced',
    rules: [
      {
        body: 'Keep answers direct, practical, and grounded in the current workspace.',
        enabled: true,
        id: 'default-directness',
        name: 'Direct workspace help',
        source: 'manual'
      }
    ],
    skills: []
  });
hmrPreserve('personalizationSettings', () => personalizationSettings);

// ---------------------------------------------------------------------------
// EditorSettings
// ---------------------------------------------------------------------------

export interface EditorSettings {
  autoFormat: boolean;
  lineNumbers: boolean;
  wordWrap: boolean;
  minimap: boolean;
  tabSize: number;
  autoSave: boolean;
  autoSaveDelay: number;
}

export const editorSettings =
  (hmrRestore('editorSettings') as PersistentSetting<EditorSettings> | undefined) ??
  new PersistentSetting<EditorSettings>('editor_settings', {
    autoFormat: true,
    autoSave: true,
    autoSaveDelay: 1000,
    lineNumbers: true,
    minimap: false,
    tabSize: 2,
    wordWrap: true
  });
hmrPreserve('editorSettings', () => editorSettings);

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export function getSessionId(): string {
  let sessionId = kv.get<string>('session', 'session_id');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    kv.set('session', 'session_id', sessionId);
  }
  return sessionId;
}

export function getUserId(): string | null {
  return kv.get<string>('settings', 'mermaid_user_id');
}

export function setUserId(userId: string): void {
  kv.set('settings', 'mermaid_user_id', userId);
}
