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
 *   preferences. When a guest signs in, `mergeLocalSettingsNamespaces` copies
 *   browser-only settings into the real account namespace before the active
 *   namespace swaps, so rules, skills, keys, and UI preferences are not lost.
 *
 *   The `mermaid_` prefix is kept for grep-ability with older builds.
 */

import { browser } from '$app/environment';
import { kv } from './kvStore.svelte';

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string'
    ? value.trim().length > 0
    : value !== undefined && value !== null;
}

function mergeUniqueItems(
  targetItems: unknown,
  sourceItems: unknown,
  fallbackPrefix: string
): unknown[] {
  const target = Array.isArray(targetItems) ? targetItems : [];
  const source = Array.isArray(sourceItems) ? sourceItems : [];
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const seen = new Set<string>();
  const result: unknown[] = [];

  function keyFor(item: unknown): string {
    if (isPlainRecord(item)) {
      const id = typeof item.id === 'string' ? item.id.trim().toLowerCase() : '';
      const name = typeof item.name === 'string' ? item.name.trim().toLowerCase() : '';
      if (id || name) return `${id}|${name}`;
    }
    return `${fallbackPrefix}:${JSON.stringify(item)}`;
  }

  for (const item of [...target, ...source]) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function mergeSettingValue(key: string, target: unknown, source: unknown): unknown {
  if (!isPlainRecord(target)) return source;
  if (!isPlainRecord(source)) return target;

  if (key === 'personalization_settings') {
    return withDefaultPersonalizationSkills({
      ...source,
      ...target,
      personas: mergeUniqueItems(
        target.personas,
        source.personas,
        'persona'
      ) as PersonalizationPersona[],
      rules: mergeUniqueItems(target.rules, source.rules, 'rule') as PersonalizationRule[],
      skills: mergeUniqueItems(target.skills, source.skills, 'skill') as PersonalizationSkill[]
    } as PersonalizationSettings);
  }

  if (key === 'ai_settings') {
    const merged = { ...target };
    for (const [field, sourceValue] of Object.entries(source)) {
      if (!nonEmpty(merged[field]) && nonEmpty(sourceValue)) merged[field] = sourceValue;
    }
    return merged;
  }

  if (key === 'model_settings') {
    return {
      ...source,
      ...target,
      models: mergeUniqueItems(target.models, source.models, 'model') as UserSavedModel[]
    } as ModelSettings;
  }

  return { ...source, ...target };
}

export function mergeLocalSettingsNamespaces(
  fromNamespace: string | null | undefined,
  toNamespace: string | null | undefined
): void {
  if (!browser || !fromNamespace || !toNamespace || fromNamespace === toNamespace) return;

  const fromPrefix = `mermaid_${fromNamespace}_`;
  const toPrefix = `mermaid_${toNamespace}_`;
  const allSettings = kv.getCategory<unknown>('settings');

  for (const [storedKey, sourceValue] of Object.entries(allSettings)) {
    if (!storedKey.startsWith(fromPrefix)) continue;
    const settingKey = storedKey.slice(fromPrefix.length);
    const targetStorageKey = `${toPrefix}${settingKey}`;
    const targetValue = kv.get<unknown>('settings', targetStorageKey);
    kv.set(
      'settings',
      targetStorageKey,
      targetValue === null ? sourceValue : mergeSettingValue(settingKey, targetValue, sourceValue)
    );
  }
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
  private readonly normalize: (value: T) => T;
  private boundNamespace: string;

  constructor(key: string, defaultValue: T, normalize: (value: T) => T = (value) => value) {
    this.key = key;
    this.defaultValue = defaultValue;
    this.normalize = normalize;
    this.boundNamespace = activeNamespace;
    this.value = this.loadFromStorage();
    registeredSettings.add(this);
  }

  private storageKey(): string {
    return `mermaid_${this.boundNamespace}_${this.key}`;
  }

  private loadFromStorage(): T {
    if (!browser) return this.normalize({ ...this.defaultValue });
    const stored = kv.get<Partial<T>>('settings', this.storageKey());
    return this.normalize(stored ? { ...this.defaultValue, ...stored } : { ...this.defaultValue });
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
    this.value = this.normalize(newValue);
    if (browser) kv.set('settings', this.storageKey(), this.value);
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
  showReasoning: boolean;
  autoScroll: boolean;
}

export const uiSettings = new PersistentSetting<UISettings>('ui_settings', {
  autoScroll: true,
  showReasoning: true,
  theme: 'system'
});

// ---------------------------------------------------------------------------
// AISettings
// ---------------------------------------------------------------------------

export interface AISettings {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  anthropicAuthToken?: string;
  openrouterApiKey?: string;
  geminiApiKey?: string;
  /** Search-provider keys for the webSearch / iconSearch tools. */
  braveSearchApiKey?: string;
  tavilyApiKey?: string;
}

export const aiSettings = new PersistentSetting<AISettings>('ai_settings', {
  anthropicApiKey: '',
  anthropicAuthToken: '',
  braveSearchApiKey: '',
  geminiApiKey: '',
  openaiApiKey: '',
  openrouterApiKey: '',
  tavilyApiKey: ''
});

// ---------------------------------------------------------------------------
// ModelSettings
// ---------------------------------------------------------------------------

export interface UserSavedModel {
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

export interface ModelSettings {
  models: UserSavedModel[];
  selectedModelId: string;
}

function normalizeModelSettings(settings: ModelSettings): ModelSettings {
  return {
    models: Array.isArray(settings.models) ? settings.models.filter((model) => model.id) : [],
    selectedModelId: typeof settings.selectedModelId === 'string' ? settings.selectedModelId : ''
  };
}

export const modelSettings = new PersistentSetting<ModelSettings>(
  'model_settings',
  {
    models: [],
    selectedModelId: ''
  },
  normalizeModelSettings
);

// ---------------------------------------------------------------------------
// PersonalizationSettings
// ---------------------------------------------------------------------------

export interface PersonalizationRule {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
}

export interface PersonalizationSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface PersonalizationPersona {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
}

export interface PersonalizationSettings {
  personas: PersonalizationPersona[];
  rules: PersonalizationRule[];
  skills: PersonalizationSkill[];
}

const DEFAULT_PERSONALIZATION_SKILLS: PersonalizationSkill[] = [];

function withDefaultPersonalizationSkills(
  settings: PersonalizationSettings
): PersonalizationSettings {
  const normalized = {
    ...settings,
    personas: Array.isArray(settings.personas) ? settings.personas : [],
    rules: Array.isArray(settings.rules) ? settings.rules : [],
    skills: Array.isArray(settings.skills)
      ? settings.skills.filter((skill) => skill.id !== 'default-mermaid-expert')
      : []
  };
  const existing = new Set(
    normalized.skills.map(
      (skill) => `${skill.id.trim().toLowerCase()}|${skill.name.trim().toLowerCase()}`
    )
  );
  const missingDefaults = DEFAULT_PERSONALIZATION_SKILLS.filter((skill) => {
    const id = skill.id.trim().toLowerCase();
    const name = skill.name.trim().toLowerCase();
    return (
      !existing.has(`${id}|${name}`) &&
      !normalized.skills.some((item) => item.name.trim().toLowerCase() === name)
    );
  });
  return missingDefaults.length > 0
    ? { ...normalized, skills: [...missingDefaults, ...normalized.skills] }
    : normalized;
}

export const personalizationSettings = new PersistentSetting<PersonalizationSettings>(
  'personalization_settings',
  withDefaultPersonalizationSkills({
    personas: [],
    rules: [
      {
        body: 'Keep answers direct, practical, and grounded in the current workspace.',
        enabled: true,
        id: 'default-directness',
        name: 'Direct workspace help'
      }
    ],
    skills: []
  }),
  withDefaultPersonalizationSkills
);

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
