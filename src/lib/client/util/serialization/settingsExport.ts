import {
  aiSettings,
  modelSettings,
  personalizationSettings,
  toolsStore,
  uiSettings,
  type AISettings,
  type ModelSettings,
  type PersonalizationSettings,
  type ToolConfig,
  type UISettings
} from '$lib/client/stores';
import { setMode } from 'mode-watcher';

const SETTINGS_EXPORT_VERSION = 1;

export interface SettingsExport {
  exportedAt: string;
  kind: 'graphini-settings';
  version: number;
  settings: {
    ai: Pick<
      AISettings,
      | 'anthropicApiKey'
      | 'anthropicAuthToken'
      | 'braveSearchApiKey'
      | 'geminiApiKey'
      | 'openaiApiKey'
      | 'openrouterApiKey'
      | 'tavilyApiKey'
    >;
    models: ModelSettings;
    personalization: PersonalizationSettings;
    tools: ToolConfig[];
    ui: Pick<UISettings, 'autoScroll' | 'showReasoning' | 'theme'>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function typedRecord<T extends object>(value: unknown): Partial<T> {
  return isRecord(value) ? (value as Partial<T>) : {};
}

export function exportSettings(): SettingsExport {
  return {
    exportedAt: new Date().toISOString(),
    kind: 'graphini-settings',
    settings: {
      ai: {
        anthropicApiKey: aiSettings.value.anthropicApiKey,
        anthropicAuthToken: aiSettings.value.anthropicAuthToken,
        braveSearchApiKey: aiSettings.value.braveSearchApiKey,
        geminiApiKey: aiSettings.value.geminiApiKey,
        openaiApiKey: aiSettings.value.openaiApiKey,
        openrouterApiKey: aiSettings.value.openrouterApiKey,
        tavilyApiKey: aiSettings.value.tavilyApiKey
      },
      models: {
        models: modelSettings.value.models.map((model) => ({ ...model })),
        selectedModelId: modelSettings.value.selectedModelId
      },
      personalization: {
        personas: personalizationSettings.value.personas.map((persona) => ({ ...persona })),
        rules: personalizationSettings.value.rules.map((rule) => ({ ...rule })),
        skills: personalizationSettings.value.skills.map((skill) => ({ ...skill }))
      },
      tools: toolsStore.value.map((tool) => ({ ...tool })),
      ui: {
        autoScroll: uiSettings.value.autoScroll,
        showReasoning: uiSettings.value.showReasoning,
        theme: uiSettings.value.theme
      }
    },
    version: SETTINGS_EXPORT_VERSION
  };
}

export function downloadSettings(): void {
  const json = JSON.stringify(exportSettings(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `graphini-settings-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function importSettingsFile(file: File): Promise<void> {
  const raw = await file.text();
  const parsed = JSON.parse(raw) as unknown;

  if (!isRecord(parsed)) throw new Error('Settings file is not a JSON object.');
  const payload = parsed.kind === 'graphini-settings' ? parsed.settings : parsed;
  if (!isRecord(payload)) throw new Error('Settings file is missing the settings payload.');

  const ui = typedRecord<UISettings>(payload.ui);
  const ai = typedRecord<AISettings>(payload.ai);
  const personalization = typedRecord<PersonalizationSettings>(payload.personalization);
  const models = typedRecord<ModelSettings>(payload.models);
  const tools = Array.isArray(payload.tools) ? (payload.tools as ToolConfig[]) : null;

  uiSettings.set({ ...uiSettings.value, ...ui });
  aiSettings.set({ ...aiSettings.value, ...ai });
  modelSettings.set({
    ...modelSettings.value,
    ...models,
    models: Array.isArray(models.models) ? models.models : modelSettings.value.models
  });
  personalizationSettings.set({
    ...personalizationSettings.value,
    ...personalization,
    personas: Array.isArray(personalization.personas)
      ? personalization.personas
      : personalizationSettings.value.personas,
    rules: Array.isArray(personalization.rules)
      ? personalization.rules
      : personalizationSettings.value.rules,
    skills: Array.isArray(personalization.skills)
      ? personalization.skills
      : personalizationSettings.value.skills
  });

  if (tools) toolsStore.replace(tools);

  setMode(uiSettings.value.theme);
  window.dispatchEvent(
    new CustomEvent('theme-changed', { detail: { theme: uiSettings.value.theme } })
  );
}
