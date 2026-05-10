<script lang="ts">
  import { Badge } from '$lib/client/ui/badge';
  import { Button } from '$lib/client/ui/button';
  import * as Dialog from '$lib/client/ui/dialog';
  import { Input } from '$lib/client/ui/input';
  import { adminFetch, adminPost } from '$lib/client/features/settings/model-admin';
  import MarkdownCodeEditor from '$lib/client/features/settings/MarkdownCodeEditor.svelte';
  import {
    TOOL_CATEGORIES,
    aiSettings,
    modelSettings,
    personalizationSettings,
    toolsStore
  } from '$lib/client/stores';
  import { authStore } from '$lib/client/stores/auth.svelte';
  import { loadModelsFromAPI } from '$lib/client/stores/modelStore.svelte';
  import { modelsStore, type AvailableModel } from '$lib/client/stores/models.svelte';
  import { uiSettings, type UISettings } from '$lib/client/stores/settings.svelte';
  import { providerKeyHeaders } from '$lib/client/util/provider-keys';
  import {
    downloadSettings,
    importSettingsFile
  } from '$lib/client/util/serialization/settingsExport';
  import {
    Check,
    Download,
    EyeOff,
    KeyRound,
    Mic,
    Monitor,
    Moon,
    Palette,
    Plus,
    Power,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    ShieldCheck,
    Sun,
    ToggleLeft,
    ToggleRight,
    Trash2,
    Upload,
    UserCircle,
    Wrench
  } from 'lucide-svelte';
  import { setMode } from 'mode-watcher';
  import { onMount } from 'svelte';
  import { toast } from 'svelte-sonner';

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }

  let { open = $bindable(false), onOpenChange }: Props = $props();

  type SettingsTab = 'account' | 'appearance' | 'keys' | 'tools' | 'rules' | 'admin';
  type ModelSearchProvider = 'openrouter' | 'openai' | 'anthropic';
  type KeySection = 'models' | 'media' | 'search';
  type KeyField =
    | 'anthropicApiKey'
    | 'anthropicAuthToken'
    | 'braveSearchApiKey'
    | 'geminiApiKey'
    | 'openaiApiKey'
    | 'openrouterApiKey'
    | 'tavilyApiKey';

  interface EnabledModelRow {
    model_id: string;
    model_name: string;
    provider?: string;
    category?: string;
    description?: string;
    is_enabled?: boolean;
    is_free?: boolean;
    gems_per_message?: number;
    max_tokens?: number;
    tool_support?: boolean;
    metadata?: Record<string, unknown>;
    sort_order?: number;
  }

  interface ProviderModelRow {
    id: string;
    name?: string;
    description?: string;
    created?: number;
    contextWindow?: number;
    context_length?: number;
    architecture?: { modality?: string };
    provider?: string;
    pricing?: { prompt?: string; completion?: string };
    supportedParameters?: string[];
    supported_parameters?: string[];
  }

  const isAdmin = $derived(
    authStore.user?.role === 'admin' || authStore.user?.role === 'superadmin'
  );

  const tabs = $derived([
    { icon: UserCircle, id: 'account' as const, label: 'Account' },
    { icon: Palette, id: 'appearance' as const, label: 'Appearance' },
    { icon: KeyRound, id: 'keys' as const, label: 'API Keys' },
    { icon: Wrench, id: 'tools' as const, label: 'Tools' },
    { icon: ShieldCheck, id: 'rules' as const, label: 'Rules & Skills' },
    { icon: ShieldCheck, id: 'admin' as const, label: 'Models' }
  ]);

  let activeTab = $state<SettingsTab>('account');
  let settingsFileInput = $state<HTMLInputElement | null>(null);
  let settingsTransferMessage = $state<{ kind: 'error' | 'notice'; text: string } | null>(null);
  let keyInputs = $state<Record<KeyField, string>>({
    anthropicApiKey: '',
    anthropicAuthToken: '',
    braveSearchApiKey: '',
    geminiApiKey: '',
    openaiApiKey: '',
    openrouterApiKey: '',
    tavilyApiKey: ''
  });
  let selectedKeyFieldBySection = $state<Record<KeySection, KeyField>>({
    media: 'geminiApiKey',
    models: 'openrouterApiKey',
    search: 'tavilyApiKey'
  });
  let keyMessage = $state<{ kind: 'error' | 'notice'; text: string } | null>(null);
  let keySaving = $state(false);

  let toolsConfig = $derived(toolsStore.value);
  let personalization = $derived(personalizationSettings.value);
  let primaryPersona = $derived(personalization.personas[0] ?? null);
  type PersonalizationKind = 'persona' | 'rule' | 'skill';
  type PersonalizationSelection = { kind: PersonalizationKind; id: string } | null;
  let personalizationSelection = $state<PersonalizationSelection>(null);
  let personalizationEditorOpen = $state(false);
  let editorKind = $state<PersonalizationKind>('rule');
  let editorBody = $state('');
  const personalizationTemplates: Record<PersonalizationKind, string> = {
    persona: `---
name: Graphini
description: The default Graphini working persona for focused diagramming and engineering collaboration.
---

Be direct, practical, and grounded in the current workspace. Help the user think clearly, make diagrams and implementation choices easier, and avoid unsupported claims.
`,
    rule: `---
name: new-rule
description: New rule description. Explain when this rule should apply.
---

Write the rule instructions here.
`,
    skill: `---
name: my-skill
description: Short trigger description for when this skill should be used.
---

Write the full skill instructions here.
`
  };

  let enabledModels = $state<EnabledModelRow[]>([]);
  let enabledModelsLoading = $state(false);
  let modelSearchProvider = $state<ModelSearchProvider>('openrouter');
  let providerModels = $state<ProviderModelRow[]>([]);
  let providerModelsLoading = $state(false);
  let providerModelSearch = $state('');
  let modelAdminError = $state('');
  let modelAdminNotice = $state('');
  let chatCompactionModelInput = $state('');
  let chatCompactionSettingsLoading = $state(false);
  let chatCompactionSettingsSaving = $state(false);
  let voiceModelInput = $state('google/gemini-2.0-flash-001');
  let voiceSettingsLoading = $state(false);
  let voiceSettingsSaving = $state(false);

  const themeOptions: { icon: typeof Monitor; label: string; value: UISettings['theme'] }[] = [
    { icon: Monitor, label: 'System', value: 'system' },
    { icon: Sun, label: 'Light', value: 'light' },
    { icon: Moon, label: 'Dark', value: 'dark' }
  ];

  const keyRows: {
    field: KeyField;
    label: string;
    placeholder: string;
    section: KeySection;
    usage: string;
  }[] = [
    {
      field: 'openrouterApiKey',
      label: 'OpenRouter',
      placeholder: 'sk-or-v1-...',
      section: 'models',
      usage: 'Chat models routed through OpenRouter'
    },
    {
      field: 'openaiApiKey',
      label: 'OpenAI',
      placeholder: 'sk-proj-...',
      section: 'models',
      usage: 'Native OpenAI chat and model lookup'
    },
    {
      field: 'anthropicApiKey',
      label: 'Anthropic API',
      placeholder: 'sk-ant-...',
      section: 'models',
      usage: 'Native Anthropic chat'
    },
    {
      field: 'anthropicAuthToken',
      label: 'Anthropic OAuth/OAT',
      placeholder: 'Bearer token',
      section: 'models',
      usage: 'Anthropic OAuth token fallback'
    },
    {
      field: 'geminiApiKey',
      label: 'Gemini',
      placeholder: 'AIza...',
      section: 'media',
      usage: 'Gemini transcription and upload vision'
    },
    {
      field: 'tavilyApiKey',
      label: 'Tavily',
      placeholder: 'tvly-...',
      section: 'search',
      usage: 'Preferred web search provider'
    },
    {
      field: 'braveSearchApiKey',
      label: 'Brave Search',
      placeholder: 'BSA...',
      section: 'search',
      usage: 'Fallback web search provider'
    }
  ];

  const keySections: {
    description: string;
    id: KeySection;
    title: string;
  }[] = [
    {
      description: 'Used for chat responses and model discovery.',
      id: 'models',
      title: 'Model providers'
    },
    {
      description: 'Used when uploads or voice input need a vision or transcription model.',
      id: 'media',
      title: 'Voice & files'
    },
    {
      description: 'Used by tools that need current web results.',
      id: 'search',
      title: 'Web search'
    }
  ];

  const modelSearchProviders: { label: string; value: ModelSearchProvider }[] = [
    { label: 'OpenRouter', value: 'openrouter' },
    { label: 'OpenAI', value: 'openai' },
    { label: 'Anthropic', value: 'anthropic' }
  ];

  let filteredProviderModels = $derived.by(() => {
    const q = providerModelSearch.toLowerCase().trim();
    const source = q
      ? providerModels.filter((model) =>
          [model.id, model.name, model.description, model.architecture?.modality]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(q))
        )
      : providerModels;
    return source.slice(0, 60);
  });

  function setThemePreference(theme: UISettings['theme']) {
    uiSettings.update((settings) => ({ ...settings, theme }));
    setMode(theme);
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
  }

  function saveBooleanSetting(key: 'autoScroll' | 'showReasoning', value: boolean) {
    uiSettings.update((settings) => ({ ...settings, [key]: value }));
  }

  function parseTemplateMarkdown(
    markdown: string
  ): { content: string; description: string; name: string } | null {
    const match = markdown.trim().match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return null;
    const meta = match[1];
    const name = meta.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = meta.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (!name || !description) return null;
    const content = markdown.trim().slice(match[0].length).trim();
    return { content, description, name };
  }

  function editorTemplate(kind: PersonalizationKind) {
    return personalizationTemplates[kind];
  }

  function normalizedEditorMarkdown(kind: PersonalizationKind, value: string) {
    return value.trim() ? `${editorTemplate(kind)}\n${value.trim()}` : editorTemplate(kind);
  }

  function displayPersonalization(kind: PersonalizationKind, fallbackName: string, body: string) {
    const parsed = parseTemplateMarkdown(body);
    if (parsed) {
      return {
        name: parsed.name,
        summary: parsed.description || parsed.content
      };
    }
    return { name: fallbackName, summary: body };
  }

  function selectPersonalization(kind: PersonalizationKind, id: string) {
    personalizationSelection = { id, kind };
    editorKind = kind;
    if (kind === 'rule') {
      const rule = personalizationSettings.value.rules.find((item) => item.id === id);
      editorBody = rule?.body ?? editorTemplate('rule');
    } else if (kind === 'persona') {
      const persona = personalizationSettings.value.personas.find((item) => item.id === id);
      editorBody = persona?.body ?? editorTemplate('persona');
    } else {
      const skill = personalizationSettings.value.skills.find((item) => item.id === id);
      editorBody = skill?.description ?? editorTemplate('skill');
    }
    personalizationEditorOpen = true;
  }

  function newPersonalization(kind: PersonalizationKind) {
    personalizationSelection = null;
    editorKind = kind;
    editorBody = editorTemplate(kind);
    personalizationEditorOpen = true;
  }

  function editPersona() {
    const persona = personalizationSettings.value.personas[0];
    if (persona) selectPersonalization('persona', persona.id);
    else newPersonalization('persona');
  }

  function savePersonalization() {
    const parsed = parseTemplateMarkdown(editorBody);
    if (!parsed || (editorKind !== 'skill' && !parsed.content)) {
      editorBody = normalizedEditorMarkdown(editorKind, editorBody);
      toast.error(
        editorKind === 'skill'
          ? 'Template must include frontmatter with name and description.'
          : 'Template must include frontmatter with name and description, plus instructions below it.'
      );
      return;
    }

    if (editorKind === 'skill') {
      const id =
        personalizationSelection?.kind === 'skill'
          ? personalizationSelection.id
          : crypto.randomUUID();
      personalizationSettings.update((settings) => ({
        ...settings,
        skills:
          personalizationSelection?.kind === 'skill'
            ? settings.skills.map((skill) =>
                skill.id === id ? { ...skill, description: editorBody, name: parsed.name } : skill
              )
            : [
                ...settings.skills,
                { description: editorBody, enabled: true, id, name: parsed.name }
              ]
      }));
      personalizationSelection = { id, kind: 'skill' };
      toast.success('Skill saved');
      personalizationEditorOpen = false;
      return;
    }

    const name = parsed.name;
    const body = editorBody.trim();
    const id =
      personalizationSelection?.kind === editorKind
        ? personalizationSelection.id
        : crypto.randomUUID();
    if (editorKind === 'rule') {
      personalizationSettings.update((settings) => ({
        ...settings,
        rules:
          personalizationSelection?.kind === 'rule'
            ? settings.rules.map((rule) => (rule.id === id ? { ...rule, body, name } : rule))
            : [...settings.rules, { body, enabled: true, id, name }]
      }));
    } else {
      const existingPersona = personalizationSettings.value.personas.find(
        (persona) => persona.id === id
      );
      personalizationSettings.update((settings) => ({
        ...settings,
        personas: [{ body, enabled: existingPersona?.enabled ?? true, id, name }]
      }));
    }
    personalizationSelection = { id, kind: editorKind };
    toast.success(`${editorKind === 'rule' ? 'Rule' : 'Persona'} saved`);
    personalizationEditorOpen = false;
  }

  function toggleRule(ruleId: string) {
    personalizationSettings.update((settings) => ({
      ...settings,
      rules: settings.rules.map((rule) =>
        rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule
      )
    }));
  }

  function togglePersona(personaId: string) {
    personalizationSettings.update((settings) => ({
      ...settings,
      personas: settings.personas.map((persona) =>
        persona.id === personaId ? { ...persona, enabled: !persona.enabled } : persona
      )
    }));
  }

  function toggleSkill(skillId: string) {
    personalizationSettings.update((settings) => ({
      ...settings,
      skills: settings.skills.map((skill) =>
        skill.id === skillId ? { ...skill, enabled: !skill.enabled } : skill
      )
    }));
  }

  function deleteRule(ruleId: string) {
    const rule = personalizationSettings.value.rules.find((item) => item.id === ruleId);
    if (rule && !window.confirm(`Delete rule "${rule.name}"?`)) return;
    personalizationSettings.update((settings) => ({
      ...settings,
      rules: settings.rules.filter((rule) => rule.id !== ruleId)
    }));
    if (personalizationSelection?.kind === 'rule' && personalizationSelection.id === ruleId) {
      personalizationSelection = null;
      personalizationEditorOpen = false;
      editorBody = '';
    }
  }

  function deletePersona(personaId: string) {
    const persona = personalizationSettings.value.personas.find((item) => item.id === personaId);
    if (persona && !window.confirm(`Delete persona "${persona.name}"?`)) return;
    personalizationSettings.update((settings) => ({
      ...settings,
      personas: settings.personas.filter((persona) => persona.id !== personaId)
    }));
    if (personalizationSelection?.kind === 'persona' && personalizationSelection.id === personaId) {
      personalizationSelection = null;
      personalizationEditorOpen = false;
      editorBody = '';
    }
  }

  function deleteSkill(skillId: string) {
    const skill = personalizationSettings.value.skills.find((item) => item.id === skillId);
    if (skill && !window.confirm(`Delete skill "${skill.name}"?`)) return;
    personalizationSettings.update((settings) => ({
      ...settings,
      skills: settings.skills.filter((skill) => skill.id !== skillId)
    }));
    if (personalizationSelection?.kind === 'skill' && personalizationSelection.id === skillId) {
      personalizationSelection = null;
      personalizationEditorOpen = false;
      editorBody = '';
    }
  }

  function isKeySaved(field: KeyField): boolean {
    return Boolean(aiSettings.value[field]?.trim());
  }

  function saveKey(field: KeyField) {
    const value = keyInputs[field].trim();
    if (value.length < 8) {
      keyMessage = { kind: 'error', text: 'Key must be at least 8 characters.' };
      return;
    }
    keySaving = true;
    keyMessage = null;
    try {
      aiSettings.update((settings) => ({ ...settings, [field]: value }));
      keyInputs[field] = '';
      const label = keyRows.find((row) => row.field === field)?.label ?? 'Key';
      keyMessage = { kind: 'notice', text: `${label} saved.` };
      toast.success(`${label} saved`);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Failed to save key';
      keyMessage = { kind: 'error', text };
      toast.error(text);
    } finally {
      keySaving = false;
    }
  }

  function clearKey(field: KeyField) {
    aiSettings.update((settings) => ({ ...settings, [field]: '' }));
    const label = keyRows.find((row) => row.field === field)?.label ?? 'Key';
    keyMessage = { kind: 'notice', text: `${label} cleared.` };
    toast.success(`${label} cleared`);
  }

  function selectedKeyRow(sectionId: KeySection) {
    return keyRows.find((row) => row.field === selectedKeyFieldBySection[sectionId]) ?? null;
  }

  function triggerSettingsUpload() {
    settingsFileInput?.click();
  }

  async function uploadSettings(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    settingsTransferMessage = null;
    try {
      await importSettingsFile(file);
      toolsStore.syncFromKv();
      settingsTransferMessage = { kind: 'notice', text: 'Settings imported.' };
      toast.success('Settings imported');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Failed to import settings';
      settingsTransferMessage = { kind: 'error', text };
      toast.error(text);
    }
  }

  function providerModelId(provider: ModelSearchProvider, modelId: string) {
    return modelId.startsWith(`${provider}/`) ? modelId : `${provider}/${modelId}`;
  }

  function buildProviderImportPayload(provider: ModelSearchProvider, model: ProviderModelRow) {
    const fullId = providerModelId(provider, model.id);
    const isFree = model.pricing?.prompt === '0' && model.pricing?.completion === '0';
    return {
      category: model.architecture?.modality || model.provider || 'General',
      description: (model.description || '').slice(0, 160),
      gems_per_message: isFree ? 1 : provider === 'anthropic' ? 4 : 2,
      is_free: isFree,
      max_tokens: model.contextWindow || model.context_length || 4000,
      metadata: {
        created: model.created,
        pricing: model.pricing,
        provider_search_id: model.id,
        supported_parameters: model.supportedParameters || model.supported_parameters
      },
      model_id: fullId,
      model_name: model.name || model.id,
      provider,
      tool_support:
        provider === 'openrouter'
          ? (model.supportedParameters || model.supported_parameters || []).includes('tools')
          : true
    };
  }

  function rowFromAvailableModel(model: AvailableModel): EnabledModelRow {
    return {
      category: model.category,
      description: model.description,
      gems_per_message: model.gemsPerMessage,
      is_enabled: model.isEnabled,
      is_free: model.isFree,
      max_tokens: model.contextWindow || model.maxTokens,
      metadata: {
        contextWindow: model.contextWindow,
        imageSupport: model.imageSupport
      },
      model_id: model.id,
      model_name: model.name,
      provider: model.provider,
      tool_support: model.toolSupport
    };
  }

  function availableModelFromRow(row: EnabledModelRow): AvailableModel {
    const contextWindow =
      typeof row.metadata?.contextWindow === 'number' && row.metadata.contextWindow > 0
        ? row.metadata.contextWindow
        : row.max_tokens && row.max_tokens > 8000
          ? row.max_tokens
          : 128000;
    return {
      category: row.category || 'General',
      contextWindow,
      description: row.description || '',
      gemsPerMessage: row.gems_per_message ?? 2,
      id: row.model_id,
      imageSupport: row.metadata?.imageSupport === true,
      isEnabled: row.is_enabled !== false,
      isFree: row.is_free === true,
      maxTokens: row.max_tokens || 4000,
      name: row.model_name || row.model_id,
      provider: row.provider || 'openrouter',
      toolSupport: row.tool_support !== false
    };
  }

  function saveLocalModels(rows: EnabledModelRow[]) {
    const models = rows.map(availableModelFromRow);
    const selectedStillEnabled = models.some(
      (model) => model.id === modelSettings.value.selectedModelId && model.isEnabled !== false
    );
    modelSettings.set({
      models,
      selectedModelId: selectedStillEnabled
        ? modelSettings.value.selectedModelId
        : models.find((model) => model.isEnabled !== false)?.id || ''
    });
  }

  async function loadProvidersAndModels() {
    await loadModelsFromAPI();
  }

  async function loadEnabledModels() {
    enabledModelsLoading = true;
    modelAdminError = '';
    try {
      if (modelSettings.value.models.length > 0) {
        enabledModels = modelSettings.value.models.map(rowFromAvailableModel);
        return;
      }
      const res = await fetch('/api/models');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false || !Array.isArray(data.data)) {
        throw new Error(data.error || 'Failed to load models');
      }
      enabledModels = data.data.map((model: AvailableModel) => rowFromAvailableModel(model));
      saveLocalModels(enabledModels);
    } catch (error) {
      modelAdminError = error instanceof Error ? error.message : 'Failed to load models';
    } finally {
      enabledModelsLoading = false;
    }
  }

  async function loadProviderModels() {
    providerModelsLoading = true;
    modelAdminError = '';
    try {
      const search = new URLSearchParams({
        limit: '100',
        provider: modelSearchProvider,
        q: providerModelSearch.trim()
      });
      const res = await fetch(`/api/model-lab?${search}`, {
        credentials: 'include',
        headers: providerKeyHeaders(aiSettings.value)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `Failed to load ${modelSearchProvider} models`);
      }
      providerModels = data.data?.models || [];
    } catch (error) {
      modelAdminError =
        error instanceof Error ? error.message : `Failed to load ${modelSearchProvider} models`;
    } finally {
      providerModelsLoading = false;
    }
  }

  async function toggleEnabledModel(modelId: string, isEnabled: boolean) {
    modelAdminError = '';
    modelAdminNotice = '';
    try {
      enabledModels = enabledModels.map((model) =>
        model.model_id === modelId ? { ...model, is_enabled: isEnabled } : model
      );
      saveLocalModels(enabledModels);
      modelsStore.select(modelSettings.value.selectedModelId);
    } catch (error) {
      modelAdminError = error instanceof Error ? error.message : 'Failed to update model';
    }
  }

  async function deleteEnabledModel(modelId: string) {
    const snapshot = enabledModels.find((m) => m.model_id === modelId) ?? null;
    modelAdminError = '';
    modelAdminNotice = '';
    try {
      enabledModels = enabledModels.filter((model) => model.model_id !== modelId);
      saveLocalModels(enabledModels);
      modelAdminNotice = `Deleted ${modelId}`;
      toast(`Deleted ${modelId}`, {
        action: {
          label: 'Undo',
          onClick: () => {
            enabledModels = [
              ...(snapshot
                ? [snapshot]
                : [{ is_enabled: true, model_id: modelId, model_name: modelId }]),
              ...enabledModels
            ];
            saveLocalModels(enabledModels);
            modelAdminNotice = `Restored ${modelId}`;
            toast.success(`Restored ${modelId}`);
          }
        }
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Failed to delete model';
      modelAdminError = text;
      toast.error(text);
    }
  }

  async function importProviderModel(model: ProviderModelRow) {
    const modelData = buildProviderImportPayload(modelSearchProvider, model);
    modelAdminError = '';
    modelAdminNotice = '';
    try {
      enabledModels = [
        modelData,
        ...enabledModels.filter((row) => row.model_id !== modelData.model_id)
      ];
      saveLocalModels(enabledModels);
      modelAdminNotice = `Imported ${model.name || model.id}`;
      toast.success(modelAdminNotice);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Failed to import model';
      modelAdminError = text;
      toast.error(text);
    }
  }

  function isProviderModelImported(modelId: string) {
    const fullId = providerModelId(modelSearchProvider, modelId);
    return enabledModels.some((model) => model.model_id === fullId);
  }

  async function loadChatCompactionSettings() {
    chatCompactionSettingsLoading = true;
    modelAdminError = '';
    try {
      const settings = (await adminFetch('settings', { category: 'chat_compaction' })) || [];
      const modelSetting = settings.find(
        (setting: { key?: unknown; value?: unknown }) => setting.key === 'model'
      );
      if (typeof modelSetting?.value === 'string') chatCompactionModelInput = modelSetting.value;
    } catch (error) {
      modelAdminError =
        error instanceof Error ? error.message : 'Failed to load chat compaction settings';
    } finally {
      chatCompactionSettingsLoading = false;
    }
  }

  async function saveChatCompactionSettings() {
    const model = chatCompactionModelInput.trim();
    if (!model) {
      modelAdminError = 'Enter a chat summarizer model';
      return;
    }
    chatCompactionSettingsSaving = true;
    modelAdminError = '';
    modelAdminNotice = '';
    try {
      await adminPost({
        action: 'setSetting',
        category: 'chat_compaction',
        description: 'Model used to summarize older chat turns when context is near full',
        isSensitive: false,
        key: 'model',
        value: model
      });
      modelAdminNotice = 'Chat summarizer model saved';
      toast.success(modelAdminNotice);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Failed to save chat summarizer model';
      modelAdminError = text;
      toast.error(text);
    } finally {
      chatCompactionSettingsSaving = false;
    }
  }

  async function loadVoiceSettings() {
    voiceSettingsLoading = true;
    modelAdminError = '';
    try {
      const settings = (await adminFetch('settings', { category: 'voice' })) || [];
      const modelSetting = settings.find(
        (setting: { key?: unknown; value?: unknown }) => setting.key === 'model'
      );
      if (typeof modelSetting?.value === 'string') voiceModelInput = modelSetting.value;
    } catch (error) {
      modelAdminError = error instanceof Error ? error.message : 'Failed to load voice settings';
    } finally {
      voiceSettingsLoading = false;
    }
  }

  async function saveVoiceSettings() {
    const model = voiceModelInput.trim();
    if (!model) {
      modelAdminError = 'Enter a voice transcription model';
      return;
    }
    voiceSettingsSaving = true;
    modelAdminError = '';
    modelAdminNotice = '';
    try {
      await adminPost({
        action: 'setSetting',
        category: 'voice',
        description: 'Model used by /api/audio for voice transcription',
        isSensitive: false,
        key: 'model',
        value: model
      });
      modelAdminNotice = 'Voice model saved';
      toast.success(modelAdminNotice);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Failed to save voice model';
      modelAdminError = text;
      toast.error(text);
    } finally {
      voiceSettingsSaving = false;
    }
  }

  onMount(() => {
    void loadEnabledModels();
    if (isAdmin) {
      void loadProvidersAndModels();
      void loadChatCompactionSettings();
      void loadVoiceSettings();
    }
  });
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Content
    noAnimation
    class="settings-dialog h-[90vh] w-[calc(100vw-24px)] overflow-hidden p-0 pr-0 sm:max-w-[1180px]">
    <div class="flex h-full min-h-0 flex-col bg-background">
      <Dialog.Header class="settings-header shrink-0 border-b border-border px-4 py-3 sm:px-5">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-center gap-3">
            <img
              src="/brand/logo.png"
              alt="Graphini"
              width="32"
              height="32"
              class="size-8 rounded-md border border-border bg-secondary p-0.5" />
            <div class="min-w-0">
              <Dialog.Title class="truncate text-[13px] font-semibold">Settings</Dialog.Title>
              <Dialog.Description class="text-[13px] text-muted-foreground">
                Local preferences, keys, tools, and rules
              </Dialog.Description>
            </div>
          </div>

          <div class="mr-10 flex shrink-0 flex-wrap items-center gap-2">
            <input
              bind:this={settingsFileInput}
              class="hidden"
              type="file"
              accept="application/json,.json"
              onchange={uploadSettings} />
            <Button size="sm" variant="outline" class="gap-1" onclick={triggerSettingsUpload}>
              <Upload class="size-3.5" /> Import
            </Button>
            <Button size="sm" variant="outline" class="gap-1" onclick={downloadSettings}>
              <Download class="size-3.5" /> Export
            </Button>
            <Button size="sm" class="settings-send-button" onclick={() => onOpenChange(false)}
              >Done</Button>
          </div>
        </div>
        {#if settingsTransferMessage}
          <div
            aria-live="polite"
            class={'mt-3 rounded-md border px-3 py-2 text-[13px] ' +
              (settingsTransferMessage.kind === 'error'
                ? 'border-warning/20 bg-warning/10 text-warning dark:text-warning'
                : 'border-success/20 bg-success/10 text-success dark:text-success')}>
            {settingsTransferMessage.text}
          </div>
        {/if}
      </Dialog.Header>

      <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
        <aside
          class="settings-sidebar shrink-0 border-b border-border bg-[var(--chat-background)] p-2 sm:w-[208px] sm:border-r sm:border-b-0">
          <nav class="flex gap-1 overflow-x-auto sm:block sm:space-y-1 sm:overflow-visible">
            {#each tabs as tab (tab.id)}
              {@const Icon = tab.icon}
              <button
                type="button"
                class="settings-tab flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-left text-[13px] transition-colors sm:w-full {activeTab ===
                tab.id
                  ? 'border border-border bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground'}"
                aria-current={activeTab === tab.id ? 'page' : undefined}
                onclick={() => (activeTab = tab.id)}>
                <Icon class="size-4" />
                <span>{tab.label}</span>
              </button>
            {/each}
          </nav>
        </aside>

        <section class="settings-content min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {#if activeTab === 'account'}
            <div class="max-w-3xl space-y-4">
              <div class="settings-panel rounded-md border border-border">
                <div class="flex items-start gap-3 p-4">
                  {#if authStore.user?.avatar_url}
                    <img
                      src={authStore.user.avatar_url}
                      alt=""
                      width="40"
                      height="40"
                      class="size-10 rounded-full border border-border" />
                  {:else}
                    <div
                      class="flex size-10 items-center justify-center rounded-full border border-border bg-muted text-[13px] font-medium text-muted-foreground">
                      {(authStore.user?.display_name || authStore.user?.email || 'G')
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-[13px] font-medium">
                      {authStore.user?.display_name || authStore.user?.email || 'Guest'}
                    </div>
                    <div class="mt-1 truncate text-[13px] text-muted-foreground">
                      {authStore.user?.email || 'Guest workspace'}
                    </div>
                    <div class="mt-2">
                      <Badge variant="outline" class="text-[13px]">
                        {authStore.isLoggedIn ? 'Signed in' : 'Guest'}
                      </Badge>
                    </div>
                  </div>
                  {#if authStore.isLoggedIn || authStore.isGuest}
                    <Button size="sm" variant="outline" onclick={() => authStore.logout()}>
                      Sign out
                    </Button>
                  {:else}
                    <Button
                      size="sm"
                      class="settings-send-button"
                      onclick={() => authStore.login(window.location.href)}>
                      Sign in
                    </Button>
                  {/if}
                </div>
              </div>

              <div class="settings-panel rounded-md border border-border p-4">
                <div class="text-[13px] font-medium">Guest sign-in merge</div>
                <div class="mt-2 space-y-2 text-[13px] leading-5 text-muted-foreground">
                  <p>
                    When a guest signs in, Graphini keeps their chats, workspace files, rules,
                    skills, and local preferences with the account.
                  </p>
                  <p>
                    Google remains the source of truth for the account name, email, and avatar.
                    Existing file path conflicts are kept under an imported guest folder.
                  </p>
                </div>
                {#if authStore.isGuest}
                  <div class="mt-3">
                    <Button
                      size="sm"
                      class="settings-send-button"
                      onclick={() => authStore.login(window.location.href)}>
                      Sign in and keep guest data
                    </Button>
                  </div>
                {/if}
              </div>
            </div>
          {:else if activeTab === 'appearance'}
            <div class="max-w-3xl space-y-4">
              <div>
                <div class="mb-2 text-[13px] font-medium">Theme</div>
                <div class="grid grid-cols-3 gap-2">
                  {#each themeOptions as option (option.value)}
                    {@const Icon = option.icon}
                    <button
                      type="button"
                      class="settings-choice flex h-14 items-center justify-center gap-2 rounded-md border text-[13px] transition-colors {uiSettings
                        .value.theme === option.value
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-secondary'}"
                      aria-pressed={uiSettings.value.theme === option.value}
                      onclick={() => setThemePreference(option.value)}>
                      <Icon class="size-4" />
                      {option.label}
                    </button>
                  {/each}
                </div>
              </div>

              <div class="settings-panel divide-y divide-border rounded-md border border-border">
                <label class="flex items-center justify-between gap-4 p-3">
                  <span>
                    <span class="block text-[13px] font-medium">Show reasoning</span>
                    <span class="text-[13px] text-muted-foreground"
                      >Display reasoning panels in chat responses.</span>
                  </span>
                  <input
                    class="settings-checkbox"
                    name="show-reasoning"
                    type="checkbox"
                    checked={uiSettings.value.showReasoning}
                    onchange={(event) =>
                      saveBooleanSetting('showReasoning', event.currentTarget.checked)} />
                </label>
                <label class="flex items-center justify-between gap-4 p-3">
                  <span>
                    <span class="block text-[13px] font-medium">Auto-scroll chat</span>
                    <span class="text-[13px] text-muted-foreground"
                      >Keep the newest response in view while streaming.</span>
                  </span>
                  <input
                    class="settings-checkbox"
                    name="auto-scroll"
                    type="checkbox"
                    checked={uiSettings.value.autoScroll}
                    onchange={(event) =>
                      saveBooleanSetting('autoScroll', event.currentTarget.checked)} />
                </label>
              </div>
            </div>
          {:else if activeTab === 'keys'}
            <div class="max-w-5xl space-y-4">
              {#each keySections as section (section.id)}
                {@const sectionRows = keyRows.filter((row) => row.section === section.id)}
                {@const selectedRow = selectedKeyRow(section.id)}
                {@const activeRows = sectionRows.filter((row) => isKeySaved(row.field))}
                <div class="settings-panel overflow-hidden rounded-md border border-border">
                  <div
                    class="flex flex-col gap-1 border-b border-border bg-secondary px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div class="min-w-0">
                      <div class="text-[13px] font-medium">{section.title}</div>
                      <div class="mt-1 text-[13px] text-muted-foreground">
                        {section.description}
                      </div>
                    </div>
                    <Badge variant="outline" class="w-fit text-[13px]">
                      {activeRows.length} of {sectionRows.length} active
                    </Badge>
                  </div>

                  <div class="space-y-3 p-3">
                    <div class="rounded-md border border-border bg-background p-3">
                      <div class="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_auto]">
                        <label class="min-w-0">
                          <span class="mb-1 block text-[13px] font-medium">Provider</span>
                          <select
                            class="settings-select h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground"
                            name={`${section.id}-provider`}
                            aria-label={`${section.title} provider`}
                            value={selectedKeyFieldBySection[section.id]}
                            onchange={(event) =>
                              (selectedKeyFieldBySection[section.id] = event.currentTarget
                                .value as KeyField)}>
                            {#each sectionRows as row (row.field)}
                              <option value={row.field}>{row.label}</option>
                            {/each}
                          </select>
                        </label>

                        <label class="min-w-0">
                          <span class="mb-1 block text-[13px] font-medium">API key</span>
                          <Input
                            class="h-8 min-w-0 flex-1 text-[13px]"
                            type="password"
                            name={selectedRow?.field ?? `${section.id}-key`}
                            aria-label={`${selectedRow?.label ?? section.title} API key`}
                            autocomplete="off"
                            spellcheck={false}
                            placeholder={selectedRow && isKeySaved(selectedRow.field)
                              ? 'Paste replacement key…'
                              : (selectedRow?.placeholder ?? 'Paste API key…')}
                            value={selectedRow ? keyInputs[selectedRow.field] : ''}
                            oninput={(event) => {
                              if (!selectedRow) return;
                              keyInputs[selectedRow.field] = event.currentTarget.value;
                            }}
                            onkeydown={(event) =>
                              event.key === 'Enter' && selectedRow && saveKey(selectedRow.field)} />
                        </label>

                        <div class="flex items-end">
                          <Button
                            size="sm"
                            class="settings-send-button h-8 gap-1"
                            disabled={keySaving ||
                              !selectedRow ||
                              !keyInputs[selectedRow.field].trim()}
                            onclick={() => selectedRow && saveKey(selectedRow.field)}>
                            <Save class="size-3.5" /> Save
                          </Button>
                        </div>
                      </div>
                      {#if selectedRow}
                        <div class="mt-2 text-[13px] text-muted-foreground">
                          {selectedRow.usage}
                        </div>
                      {/if}
                    </div>

                    <div class="rounded-md border border-border bg-background">
                      <div class="border-b border-border px-3 py-2 text-[13px] font-medium">
                        Active keys
                      </div>
                      {#if activeRows.length > 0}
                        <div class="divide-y divide-border">
                          {#each activeRows as row (row.field)}
                            <div
                              class="grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                              <div class="min-w-0">
                                <div class="flex min-w-0 items-center gap-2">
                                  <div class="truncate text-[13px] font-medium">{row.label}</div>
                                  <Badge variant="secondary" class="shrink-0 text-[13px]">
                                    Active
                                  </Badge>
                                </div>
                                <div class="mt-1 text-[13px] text-muted-foreground">
                                  {row.usage}
                                </div>
                              </div>
                              <div class="flex items-center gap-2 sm:justify-end">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onclick={() =>
                                    (selectedKeyFieldBySection[section.id] = row.field)}>
                                  Replace
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  class="text-destructive"
                                  onclick={() => clearKey(row.field)}>
                                  Remove
                                </Button>
                              </div>
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <div class="px-3 py-6 text-center text-[13px] text-muted-foreground">
                          No active keys for this section.
                        </div>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
              {#if keyMessage}
                <div
                  aria-live="polite"
                  class={'rounded-md border px-3 py-2 text-[13px] ' +
                    (keyMessage.kind === 'error'
                      ? 'border-warning/20 bg-warning/10 text-warning dark:text-warning'
                      : 'border-success/20 bg-success/10 text-success dark:text-success')}>
                  {keyMessage.text}
                </div>
              {/if}
            </div>
          {:else if activeTab === 'tools'}
            <div class="max-w-5xl space-y-4">
              <div class="flex items-center justify-between gap-3">
                <div class="text-[13px] text-muted-foreground">
                  {toolsConfig.filter((tool) => tool.enabled).length} of {toolsConfig.length} enabled
                </div>
                <div class="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    class="settings-secondary-button"
                    onclick={() => toolsStore.enableAll()}>
                    Enable all
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="gap-1"
                    onclick={() => toolsStore.reset()}>
                    <RotateCcw class="size-3.5" /> Reset
                  </Button>
                </div>
              </div>

              {#each TOOL_CATEGORIES as category (category.id)}
                {@const categoryTools = toolsConfig.filter((tool) => tool.category === category.id)}
                {#if categoryTools.length > 0}
                  <div class="settings-panel overflow-hidden rounded-md border border-border">
                    <div
                      class="border-b border-border bg-secondary px-3 py-2 text-[13px] font-medium">
                      {category.label}
                    </div>
                    <div class="divide-y divide-border">
                      {#each categoryTools as tool (tool.id)}
                        <button
                          type="button"
                          class="settings-row-button grid w-full gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary/70 sm:grid-cols-[1fr_80px]"
                          aria-pressed={tool.enabled}
                          onclick={() => toolsStore.toggle(tool.id)}>
                          <span class="min-w-0">
                            <span class="block text-[13px] font-medium">{tool.label}</span>
                            <span class="block text-[13px] leading-5 text-muted-foreground"
                              >{tool.description}</span>
                          </span>
                          <span
                            class="flex items-center justify-start text-[13px] sm:justify-end {tool.enabled
                              ? 'text-success'
                              : 'text-muted-foreground'}">
                            {#if tool.enabled}
                              <ToggleRight class="mr-1 size-5" /> On
                            {:else}
                              <ToggleLeft class="mr-1 size-5" /> Off
                            {/if}
                          </span>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              {/each}
            </div>
          {:else if activeTab === 'rules'}
            <div class="max-w-5xl space-y-4">
              <div class="settings-panel rounded-md border border-border p-3">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Badge variant="outline" class="w-fit text-[13px]">
                    {personalization.personas.filter((persona) => persona.enabled).length +
                      personalization.rules.filter((rule) => rule.enabled).length +
                      personalization.skills.filter((skill) => skill.enabled).length}
                    active
                  </Badge>
                </div>
              </div>

              <div class="grid gap-4 lg:grid-cols-2">
                <div class="settings-panel overflow-hidden rounded-md border border-border">
                  <div
                    class="flex items-center justify-between gap-3 border-b border-border bg-secondary px-3 py-2">
                    <div class="text-[13px] font-medium">Behavior</div>
                    <div class="flex items-center gap-2">
                      <Button size="sm" variant="outline" onclick={editPersona}>Persona</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onclick={() => newPersonalization('rule')}>
                        <Plus class="size-3.5" /> Rule
                      </Button>
                    </div>
                  </div>
                  <div class="divide-y divide-border">
                    {#if primaryPersona}
                      {@const display = displayPersonalization(
                        'persona',
                        primaryPersona.name,
                        primaryPersona.body
                      )}
                      <button
                        type="button"
                        class="settings-row-button grid w-full gap-2 px-3 py-3 text-left transition-colors hover:bg-secondary/70 {personalizationSelection?.kind ===
                          'persona' && personalizationSelection.id === primaryPersona.id
                          ? 'bg-secondary'
                          : ''}"
                        onclick={() => selectPersonalization('persona', primaryPersona.id)}>
                        <span class="flex min-w-0 items-center justify-between gap-2">
                          <span class="truncate text-[13px] font-medium">{display.name}</span>
                          <Badge variant="outline" class="text-[13px]">Persona</Badge>
                        </span>
                        <span class="line-clamp-2 text-[13px] text-muted-foreground">
                          {display.summary}
                        </span>
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="settings-row-button grid w-full gap-1 px-3 py-4 text-left transition-colors hover:bg-secondary/70"
                        onclick={editPersona}>
                        <span class="text-[13px] font-medium">Graphini</span>
                        <span class="text-[13px] text-muted-foreground">
                          Add the default working persona.
                        </span>
                      </button>
                    {/if}
                    {#each personalization.rules as rule (rule.id)}
                      {@const display = displayPersonalization('rule', rule.name, rule.body)}
                      <button
                        type="button"
                        class="settings-row-button grid w-full gap-2 px-3 py-3 text-left transition-colors hover:bg-secondary/70 {personalizationSelection?.kind ===
                          'rule' && personalizationSelection.id === rule.id
                          ? 'bg-secondary'
                          : ''}"
                        onclick={() => selectPersonalization('rule', rule.id)}>
                        <span class="flex min-w-0 items-center justify-between gap-2">
                          <span class="truncate text-[13px] font-medium">{display.name}</span>
                          <Badge variant="outline" class="text-[13px]">Rule</Badge>
                        </span>
                        <span class="line-clamp-2 text-[13px] text-muted-foreground">
                          {display.summary}
                        </span>
                      </button>
                    {/each}
                    {#if personalization.rules.length === 0}
                      <div class="px-3 py-4 text-[13px] text-muted-foreground">No rules yet.</div>
                    {/if}
                  </div>
                </div>

                <div class="settings-panel overflow-hidden rounded-md border border-border">
                  <div
                    class="flex items-center justify-between gap-3 border-b border-border bg-secondary px-3 py-2">
                    <div class="text-[13px] font-medium">Skills</div>
                    <Button size="sm" variant="outline" onclick={() => newPersonalization('skill')}>
                      <Plus class="size-3.5" /> Skill
                    </Button>
                  </div>
                  <div class="divide-y divide-border">
                    {#each personalization.skills as skill (skill.id)}
                      <button
                        type="button"
                        class="settings-row-button grid w-full gap-2 px-3 py-3 text-left transition-colors hover:bg-secondary/70 {personalizationSelection?.kind ===
                          'skill' && personalizationSelection.id === skill.id
                          ? 'bg-secondary'
                          : ''}"
                        onclick={() => selectPersonalization('skill', skill.id)}>
                        <span class="flex min-w-0 items-center justify-between gap-2">
                          <span class="truncate text-[13px] font-medium">{skill.name}</span>
                          <Badge variant="outline" class="text-[13px]">Skill</Badge>
                        </span>
                        <span class="line-clamp-2 text-[13px] text-muted-foreground">
                          {parseTemplateMarkdown(skill.description)?.description ??
                            skill.description}
                        </span>
                      </button>
                    {/each}
                    {#if personalization.skills.length === 0}
                      <div class="px-3 py-4 text-[13px] text-muted-foreground">No skills yet.</div>
                    {/if}
                  </div>
                </div>
              </div>
            </div>
          {:else if activeTab === 'admin'}
            <div class="max-w-6xl space-y-4">
              {#if modelAdminError}
                <div
                  aria-live="polite"
                  class="rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-[13px] text-warning dark:text-warning">
                  {modelAdminError}
                </div>
              {/if}
              {#if modelAdminNotice}
                <div
                  aria-live="polite"
                  class="rounded-md border border-success/20 bg-success/10 px-3 py-2 text-[13px] text-success dark:text-success">
                  {modelAdminNotice}
                </div>
              {/if}

              {#if isAdmin}
                <div class="grid gap-4 lg:grid-cols-2">
                  <div class="settings-panel rounded-md border border-border p-3">
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <div class="flex items-center gap-2 text-[13px] font-medium">
                        <Mic class="size-3.5" /> Voice model
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="gap-1"
                        disabled={voiceSettingsLoading}
                        onclick={loadVoiceSettings}>
                        <RefreshCw class="size-3.5 {voiceSettingsLoading ? 'animate-spin' : ''}" />
                        Refresh
                      </Button>
                    </div>
                    <div class="flex gap-2">
                      <Input
                        class="h-8 text-[13px]"
                        name="voice-model"
                        aria-label="Voice model"
                        list="voice-model-options"
                        bind:value={voiceModelInput}
                        onkeydown={(event) => event.key === 'Enter' && saveVoiceSettings()} />
                      <Button
                        size="sm"
                        class="settings-send-button gap-1"
                        disabled={voiceSettingsSaving || !voiceModelInput.trim()}
                        onclick={saveVoiceSettings}>
                        <Save class="size-3.5" /> Save
                      </Button>
                    </div>
                  </div>

                  <div class="settings-panel rounded-md border border-border p-3">
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <div class="text-[13px] font-medium">Chat summarizer model</div>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="gap-1"
                        disabled={chatCompactionSettingsLoading}
                        onclick={loadChatCompactionSettings}>
                        <RefreshCw
                          class="size-3.5 {chatCompactionSettingsLoading ? 'animate-spin' : ''}" />
                        Refresh
                      </Button>
                    </div>
                    <div class="flex gap-2">
                      <Input
                        class="h-8 text-[13px]"
                        name="chat-compaction-model"
                        aria-label="Chat summarizer model"
                        list="enabled-model-options"
                        bind:value={chatCompactionModelInput}
                        onkeydown={(event) =>
                          event.key === 'Enter' && saveChatCompactionSettings()} />
                      <Button
                        size="sm"
                        class="settings-send-button gap-1"
                        disabled={chatCompactionSettingsSaving || !chatCompactionModelInput.trim()}
                        onclick={saveChatCompactionSettings}>
                        <Save class="size-3.5" /> Save
                      </Button>
                    </div>
                  </div>
                </div>
              {/if}

              <datalist id="voice-model-options">
                <option value="google/gemini-2.0-flash-001"></option>
                <option value="gemini-2.0-flash-lite"></option>
                {#each enabledModels as model (model.model_id)}
                  <option value={model.model_id}>{model.model_name}</option>
                {/each}
              </datalist>
              <datalist id="enabled-model-options">
                {#each enabledModels as model (model.model_id)}
                  <option value={model.model_id}>{model.model_name}</option>
                {/each}
              </datalist>

              <div class="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div class="settings-panel overflow-hidden rounded-md border border-border">
                  <div class="flex h-10 items-center justify-between border-b border-border px-3">
                    <span class="text-[13px] font-medium">Enabled models</span>
                    <div class="flex items-center gap-2">
                      <Badge variant="outline" class="text-[13px]">{enabledModels.length}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="gap-1"
                        disabled={enabledModelsLoading}
                        onclick={loadEnabledModels}>
                        <RefreshCw class="size-3.5 {enabledModelsLoading ? 'animate-spin' : ''}" />
                        Refresh
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="gap-1"
                        onclick={async () => {
                          for (const model of enabledModels.filter((item) => item.is_enabled)) {
                            await toggleEnabledModel(model.model_id, false);
                          }
                        }}>
                        <EyeOff class="size-3.5" /> Disable all
                      </Button>
                    </div>
                  </div>
                  <div class="max-h-[440px] overflow-auto">
                    {#if enabledModelsLoading}
                      <div class="flex items-center justify-center py-12">
                        <RefreshCw class="size-5 animate-spin text-muted-foreground" />
                      </div>
                    {:else if enabledModels.length === 0}
                      <div class="p-8 text-center text-[13px] text-muted-foreground">
                        No enabled models.
                      </div>
                    {:else}
                      <div class="divide-y divide-border">
                        {#each enabledModels as model (model.model_id)}
                          <div class="grid gap-3 px-3 py-3 sm:grid-cols-[1fr_auto]">
                            <div class="min-w-0">
                              <div class="truncate text-[13px] font-medium">{model.model_name}</div>
                              <div class="truncate text-[12px] text-muted-foreground">
                                {model.model_id}
                              </div>
                              <div class="mt-1 flex flex-wrap gap-1">
                                <Badge variant="secondary" class="text-[13px]"
                                  >{model.provider || 'openrouter'}</Badge>
                                {#if model.tool_support}
                                  <Badge variant="outline" class="text-[13px]">Tools</Badge>
                                {/if}
                                {#if model.is_free}
                                  <Badge variant="default" class="text-[13px]">Free</Badge>
                                {/if}
                              </div>
                            </div>
                            <div class="flex items-center gap-1">
                              <span class="mr-1 text-[13px] text-muted-foreground">
                                {model.gems_per_message ?? 2} gems
                              </span>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={model.is_enabled
                                  ? `Disable ${model.model_name}`
                                  : `Enable ${model.model_name}`}
                                title={model.is_enabled ? 'Disable' : 'Enable'}
                                onclick={() =>
                                  toggleEnabledModel(model.model_id, !model.is_enabled)}>
                                <Power
                                  class="size-3.5 {model.is_enabled
                                    ? 'text-success'
                                    : 'text-muted-foreground'}" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                class="text-destructive"
                                aria-label={`Delete ${model.model_name}`}
                                title="Delete"
                                onclick={() => deleteEnabledModel(model.model_id)}>
                                <Trash2 class="size-3.5" />
                              </Button>
                            </div>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>

                <div class="settings-panel overflow-hidden rounded-md border border-border">
                  <div class="space-y-3 border-b border-border p-3">
                    <div class="flex items-center justify-between">
                      <span class="text-[13px] font-medium">Import model</span>
                      <Button
                        size="sm"
                        variant="outline"
                        class="gap-1"
                        disabled={providerModelsLoading}
                        onclick={loadProviderModels}>
                        <Search class="size-3.5" /> Search
                      </Button>
                    </div>
                    <div class="grid grid-cols-3 gap-1">
                      {#each modelSearchProviders as provider (provider.value)}
                        <button
                          type="button"
                          class="settings-choice rounded-md border px-2 py-2 text-[13px] transition-colors {modelSearchProvider ===
                          provider.value
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border hover:bg-secondary'}"
                          aria-pressed={modelSearchProvider === provider.value}
                          onclick={() => {
                            modelSearchProvider = provider.value;
                            providerModels = [];
                          }}>
                          {provider.label}
                        </button>
                      {/each}
                    </div>
                    <Input
                      class="h-8 text-[13px]"
                      name="model-search"
                      aria-label="Search model name or ID"
                      placeholder="Search model name or ID"
                      bind:value={providerModelSearch}
                      onkeydown={(event) => event.key === 'Enter' && loadProviderModels()} />
                  </div>
                  <div class="max-h-[440px] overflow-auto">
                    {#if providerModelsLoading}
                      <div class="flex items-center justify-center py-12">
                        <RefreshCw class="size-5 animate-spin text-muted-foreground" />
                      </div>
                    {:else if providerModels.length === 0}
                      <div class="p-8 text-center text-[13px] text-muted-foreground">
                        Search the selected provider.
                      </div>
                    {:else}
                      <div class="divide-y divide-border">
                        {#each filteredProviderModels as model (model.id)}
                          {@const imported = isProviderModelImported(model.id)}
                          {@const ctx = model.contextWindow || model.context_length || 0}
                          <div class="grid gap-3 px-3 py-3 sm:grid-cols-[1fr_auto]">
                            <div class="min-w-0">
                              <div class="truncate text-[13px] font-medium">
                                {model.name || model.id}
                              </div>
                              <div class="truncate text-[12px] text-muted-foreground">
                                {model.id}
                              </div>
                              <div class="mt-1 text-[13px] text-muted-foreground">
                                {ctx ? `${(ctx / 1000).toFixed(0)}k context` : 'Context unknown'}
                              </div>
                            </div>
                            {#if imported}
                              <Badge variant="secondary" class="h-7 shrink-0 text-[13px]">
                                <Check class="mr-1 size-3" /> Imported
                              </Badge>
                            {:else}
                              <Button
                                size="sm"
                                variant="outline"
                                class="shrink-0 gap-1"
                                onclick={() => importProviderModel(model)}>
                                <Download class="size-3.5" /> Import
                              </Button>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </section>
      </div>
    </div>
  </Dialog.Content>

  <Dialog.Root bind:open={personalizationEditorOpen}>
    <Dialog.Content
      noAnimation
      class="settings-dialog h-[min(760px,calc(100vh-24px))] w-[calc(100vw-24px)] overflow-hidden p-0 pr-0 sm:max-w-[860px]">
      <div class="flex h-full min-h-0 flex-col bg-background">
        <Dialog.Header class="settings-header shrink-0 border-b border-border px-4 py-3 sm:px-5">
          <div class="flex min-w-0 items-center justify-between gap-4 pr-10">
            <div class="min-w-0">
              <Dialog.Title class="truncate text-[13px] font-semibold">
                {personalizationSelection ? 'Edit' : 'New'}
                {editorKind === 'persona' ? ' Persona' : editorKind === 'rule' ? ' Rule' : ' Skill'}
              </Dialog.Title>
              <Dialog.Description class="text-[13px] text-muted-foreground">
                Template requires name and description frontmatter
              </Dialog.Description>
            </div>
            <div class="flex items-center gap-1">
              {#if personalizationSelection?.kind === 'persona'}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => togglePersona(personalizationSelection.id)}>
                  {personalization.personas.find((item) => item.id === personalizationSelection?.id)
                    ?.enabled
                    ? 'On'
                    : 'Off'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-destructive"
                  onclick={() => deletePersona(personalizationSelection.id)}>
                  Remove
                </Button>
              {:else if personalizationSelection?.kind === 'rule'}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => toggleRule(personalizationSelection.id)}>
                  {personalization.rules.find((item) => item.id === personalizationSelection?.id)
                    ?.enabled
                    ? 'On'
                    : 'Off'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-destructive"
                  onclick={() => deleteRule(personalizationSelection.id)}>
                  Remove
                </Button>
              {:else if personalizationSelection?.kind === 'skill'}
                <Button
                  size="sm"
                  variant="ghost"
                  onclick={() => toggleSkill(personalizationSelection.id)}>
                  {personalization.skills.find((item) => item.id === personalizationSelection?.id)
                    ?.enabled
                    ? 'On'
                    : 'Off'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  class="text-destructive"
                  onclick={() => deleteSkill(personalizationSelection.id)}>
                  Remove
                </Button>
              {/if}
            </div>
          </div>
        </Dialog.Header>

        <div class="min-h-0 flex-1 p-4 sm:p-5">
          <MarkdownCodeEditor
            minHeight="calc(min(760px, 100vh - 24px) - 170px)"
            placeholder={editorTemplate(editorKind)}
            bind:value={editorBody} />
        </div>

        <div class="flex shrink-0 justify-end border-t border-border px-4 py-3 sm:px-5">
          <Button
            size="sm"
            class="settings-send-button gap-1"
            disabled={!editorBody.trim()}
            onclick={savePersonalization}>
            <Save class="size-3.5" /> Save
          </Button>
        </div>
      </div>
    </Dialog.Content>
  </Dialog.Root>
</Dialog.Root>

<style>
  :global(.settings-dialog) {
    border-color: var(--border);
    background: var(--background);
    box-shadow: none;
  }

  :global(.settings-header) {
    background: var(--background);
  }

  .settings-sidebar,
  .settings-content {
    overscroll-behavior: contain;
  }

  .settings-panel {
    background: color-mix(in srgb, var(--background) 88%, var(--secondary));
  }

  .settings-tab,
  .settings-choice,
  .settings-row-button {
    outline-offset: 2px;
  }

  .settings-tab:focus-visible,
  .settings-choice:focus-visible,
  .settings-row-button:focus-visible,
  .settings-select:focus-visible,
  :global(.settings-send-button:focus-visible),
  :global(.settings-icon-send:focus-visible) {
    outline: 2px solid color-mix(in srgb, var(--ring) 70%, transparent);
    outline-offset: 2px;
  }

  :global(.settings-send-button),
  :global(.settings-icon-send) {
    border: 1px solid color-mix(in srgb, var(--primary) 70%, var(--border));
    background: var(--primary);
    color: var(--primary-foreground);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.18);
    transition:
      background-color 150ms ease,
      border-color 150ms ease,
      box-shadow 150ms ease,
      transform 150ms ease;
  }

  :global(.settings-send-button:hover:not(:disabled)),
  :global(.settings-icon-send:hover:not(:disabled)) {
    background: color-mix(in srgb, var(--primary) 86%, white);
    border-color: color-mix(in srgb, var(--primary) 86%, white);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.24);
  }

  :global(.settings-send-button:active:not(:disabled)),
  :global(.settings-icon-send:active:not(:disabled)) {
    transform: translateY(1px);
  }

  :global(.settings-secondary-button) {
    background: var(--background);
  }

  .settings-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--primary);
  }
</style>
