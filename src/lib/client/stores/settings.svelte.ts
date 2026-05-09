/**
 * Persistent Settings Store — Svelte 5 runes, localStorage-backed via kvStore.
 *
 * Namespace contract:
 *   Each `PersistentSetting<T>` writes under `mermaid_<userNs>_<key>` in the
 *   `settings` kv category, where `<userNs>` is the active user's id (or
 *   `guest` when nothing is signed in). On user change — login, logout,
 *   guest cookie rotating — `setActiveUserId` swaps every registered
 *   setting's namespace and reloads its value from the new slot.
 *
 *   Two users on the same browser therefore can't see each other's keys or
 *   preferences. A guest who later signs up keeps their guest-namespaced
 *   data in localStorage but the post-sign-up store starts from the new
 *   user.id slot — guest data isn't migrated. Per the revamp's hard-reset
 *   policy, that's intentional.
 *
 *   The `mermaid_` prefix is kept for grep-ability with older builds.
 */

import { browser } from '$app/environment';
import { kv } from './kvStore.svelte';
import { hmrRestore, hmrPreserve } from '$lib/client/util/hmr';

// ---------------------------------------------------------------------------
// Active user namespace
// ---------------------------------------------------------------------------

const GUEST_NAMESPACE = 'guest';

let activeNamespace: string = GUEST_NAMESPACE;

/**
 * Plain Sets are intentional — these collections are mutated in
 * setActiveUserId and iterated synchronously, never observed by reactive
 * computations. SvelteSet would just add overhead.
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const registeredSettings = new Set<PersistentSettingBase>();

// eslint-disable-next-line svelte/prefer-svelte-reactivity
const namespaceSubscribers = new Set<(userNamespace: string) => void>();

interface PersistentSettingBase {
  rebindNamespace(): void;
}

/**
 * Switch the active user namespace and reload every registered setting and
 * subscriber from its new slot. Call this on login, logout, and guest-cookie
 * identity swaps. Pass `null` (or omit) to revert to the guest namespace.
 */
export function setActiveUserId(userId: string | null | undefined): void {
  const next = userId && userId.length > 0 ? userId : GUEST_NAMESPACE;
  if (next === activeNamespace) return;
  activeNamespace = next;
  for (const setting of registeredSettings) setting.rebindNamespace();
  for (const subscriber of namespaceSubscribers) {
    try {
      subscriber(activeNamespace);
    } catch (err) {
      console.error('[settings] namespace subscriber threw:', err);
    }
  }
}

export function getActiveUserNamespace(): string {
  return activeNamespace;
}

/**
 * Subscribe to user-namespace changes. The callback fires after the new
 * namespace is in effect; use it to reload your own localStorage-backed
 * state from the new slot.
 *
 * Returns an unsubscribe function.
 */
export function subscribeNamespaceChange(fn: (userNamespace: string) => void): () => void {
  namespaceSubscribers.add(fn);
  return () => namespaceSubscribers.delete(fn);
}

// ---------------------------------------------------------------------------
// PersistentSetting<T>
// ---------------------------------------------------------------------------

export class PersistentSetting<T extends object> implements PersistentSettingBase {
  value = $state<T>({} as T);

  private readonly key: string;
  private readonly defaultValue: T;
  private boundNamespace: string;

  constructor(key: string, defaultValue: T) {
    this.key = key;
    this.defaultValue = defaultValue;
    this.boundNamespace = activeNamespace;
    this.value = this.loadFromStorage();
    registeredSettings.add(this);
  }

  private storageKey(): string {
    return `mermaid_${this.boundNamespace}_${this.key}`;
  }

  private loadFromStorage(): T {
    if (!browser) return { ...this.defaultValue };
    const stored = kv.get<Partial<T>>('settings', this.storageKey());
    return stored ? { ...this.defaultValue, ...stored } : { ...this.defaultValue };
  }

  /**
   * Called by `setActiveUserId` when the active user changes. Rebinds the
   * storage key to the new namespace and reloads the value from there.
   * Components observing `value` see the swap reactively.
   */
  rebindNamespace(): void {
    if (this.boundNamespace === activeNamespace) return;
    this.boundNamespace = activeNamespace;
    this.value = this.loadFromStorage();
  }

  set(newValue: T): void {
    this.value = newValue;
    if (browser) kv.set('settings', this.storageKey(), newValue);
  }

  update(fn: (v: T) => T): void {
    this.set(fn(this.value));
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
  /** Search-provider keys for the webSearch / iconSearch tools. */
  braveSearchApiKey?: string;
  tavilyApiKey?: string;
}

export const aiSettings =
  (hmrRestore('aiSettings') as PersistentSetting<AISettings> | undefined) ??
  new PersistentSetting<AISettings>('ai_settings', {
    anthropicApiKey: '',
    anthropicAuthToken: '',
    braveSearchApiKey: '',
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
    tavilyApiKey: '',
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

/**
 * Local-cached client user id. The authoritative identity comes from
 * authStore (`/api/auth/me`); this helper exists for callers that need a
 * synchronous read before auth has finished loading.
 */
export function getUserId(): string | null {
  return kv.get<string>('settings', 'mermaid_user_id');
}

export function setUserId(userId: string): void {
  kv.set('settings', 'mermaid_user_id', userId);
}
