<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import { adminFetch, adminPost } from '$lib/components/settings/model-admin';
  import { aiSettings, personalizationSettings, TOOL_CATEGORIES, toolsStore } from '$lib/stores';
  import { uiSettings, type UISettings } from '$lib/stores/settings.svelte';
  import { kv } from '$lib/stores/kvStore.svelte';
  import { loadModelsFromAPI } from '$lib/stores/modelStore.svelte';
  import { downloadAppState } from '$lib/util/serialization/exportState';
  import {
    BookOpen,
    Brain,
    Check,
    Download,
    EyeOff,
    FileText,
    KeyRound,
    Library,
    Mic,
    Pencil,
    Palette,
    Plus,
    Power,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    ShieldCheck,
    Monitor,
    Moon,
    Sun,
    ToggleLeft,
    ToggleRight,
    Trash2,
    Wrench
  } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { setMode } from 'mode-watcher';

  // Memory state
  let memories = $state<{ key: string; value: string; savedAt: string }[]>([]);
  let memoryLoading = $state(false);
  let editingKey = $state<string | null>(null);
  let editingValue = $state('');
  let newMemoryKey = $state('');
  let newMemoryValue = $state('');

  async function loadMemories() {
    memoryLoading = true;
    try {
      const data = await kv.get('memories', 'all');
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        memories = Object.entries(data as Record<string, any>).map(([k, v]: [string, any]) => ({
          key: k,
          value: typeof v === 'object' ? v.value || JSON.stringify(v) : String(v),
          savedAt: typeof v === 'object' ? v.savedAt || '' : ''
        }));
      } else {
        memories = [];
      }
    } catch {
      memories = [];
    }
    memoryLoading = false;
  }

  async function saveMemory(key: string, value: string) {
    const current = (await kv.get('memories', 'all')) || {};
    const updated = {
      ...(current as Record<string, any>),
      [key]: { value, savedAt: new Date().toISOString() }
    };
    await kv.set('memories', 'all', updated);
    await loadMemories();
    editingKey = null;
    editingValue = '';
    newMemoryKey = '';
    newMemoryValue = '';
  }

  async function deleteMemory(key: string) {
    const current = (await kv.get('memories', 'all')) || {};
    const updated = { ...(current as Record<string, any>) };
    delete updated[key];
    await kv.set('memories', 'all', updated);
    await loadMemories();
  }

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }

  let { open = $bindable(false), onOpenChange }: Props = $props();

  // AI Settings — reactive via aiSettings.value from rune-based store

  // Tools config (reactive via rune-based store)
  let toolsConfig = $derived(toolsStore.value);
  let personalization = $derived(personalizationSettings.value);

  type SettingsTab = 'theme' | 'models' | 'voice' | 'tools' | 'rules' | 'memory';

  const settingsTabs: {
    id: SettingsTab;
    label: string;
    description: string;
    icon: typeof Monitor;
  }[] = [
    { description: 'Theme and interface density', icon: Palette, id: 'theme', label: 'Theme' },
    {
      description: 'Search, keys, and enabled models',
      icon: KeyRound,
      id: 'models',
      label: 'Models & Keys'
    },
    {
      description: 'Speech transcription model',
      icon: Mic,
      id: 'voice',
      label: 'Voice'
    },
    {
      description: 'Tool availability by category',
      icon: Wrench,
      id: 'tools',
      label: 'Tool Settings'
    },
    {
      description: 'Rules and reusable skills',
      icon: Library,
      id: 'rules',
      label: 'Rules & Skills'
    },
    { description: 'User memory preferences', icon: Brain, id: 'memory', label: 'Memory' }
  ];

  let activeTab = $state<SettingsTab>('theme');

  type ModelSearchProvider = 'openrouter' | 'openai' | 'anthropic';
  type ProviderCredential = 'api_key' | 'auth_token';

  const modelSearchProviders: { label: string; value: ModelSearchProvider }[] = [
    { label: 'OpenRouter', value: 'openrouter' },
    { label: 'OpenAI', value: 'openai' },
    { label: 'Anthropic', value: 'anthropic' }
  ];

  // Local state for provider credential input
  let anthropicApiKeyInput = $state('');
  let anthropicAuthTokenInput = $state('');
  let openAiApiKeyInput = $state('');
  let openRouterApiKeyInput = $state('');

  let enabledModels = $state<Record<string, any>[]>([]);
  let enabledModelsLoading = $state(false);
  let modelSearchProvider = $state<ModelSearchProvider>('openrouter');
  let providerModels = $state<Record<string, any>[]>([]);
  let providerModelsLoading = $state(false);
  let providerModelSearch = $state('');
  let modelAdminError = $state('');
  let modelAdminNotice = $state('');
  let apiKeySaving = $state(false);
  let chatCompactionModelInput = $state('');
  let chatCompactionSettingsLoading = $state(false);
  let chatCompactionSettingsSaving = $state(false);
  let voiceModelInput = $state('google/gemini-2.0-flash-001');
  let voiceSettingsLoading = $state(false);
  let voiceSettingsSaving = $state(false);

  let filteredProviderModels = $derived.by(() => {
    const q = providerModelSearch.toLowerCase().trim();
    if (!q) return providerModels.slice(0, 80);
    return providerModels
      .filter((model) =>
        [model.id, model.name, model.description, model.architecture?.modality]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      )
      .slice(0, 80);
  });

  async function loadProvidersAndModels() {
    await loadModelsFromAPI();
  }

  async function loadEnabledModels() {
    enabledModelsLoading = true;
    modelAdminError = '';
    try {
      enabledModels = (await adminFetch('models')) || [];
    } catch (error) {
      modelAdminError = error instanceof Error ? error.message : 'Failed to load enabled models';
    } finally {
      enabledModelsLoading = false;
    }
  }

  function providerModelId(provider: ModelSearchProvider, modelId: string) {
    return modelId.startsWith(`${provider}/`) ? modelId : `${provider}/${modelId}`;
  }

  function buildProviderImportPayload(provider: ModelSearchProvider, model: Record<string, any>) {
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

  async function loadProviderModels() {
    providerModelsLoading = true;
    modelAdminError = '';
    try {
      const search = new URLSearchParams({
        limit: '100',
        provider: modelSearchProvider,
        q: providerModelSearch.trim()
      });
      const res = await fetch(`/api/model-lab?${search}`, { credentials: 'include' });
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
      await adminPost({ action: 'toggleEnabledModel', isEnabled, modelId });
      await loadEnabledModels();
      await loadModelsFromAPI();
    } catch (error) {
      modelAdminError = error instanceof Error ? error.message : 'Failed to update model';
    }
  }

  async function deleteEnabledModel(modelId: string) {
    if (!confirm(`Delete model ${modelId}?`)) return;
    modelAdminError = '';
    modelAdminNotice = '';
    try {
      await adminPost({ action: 'deleteEnabledModel', modelId });
      await loadEnabledModels();
      await loadModelsFromAPI();
    } catch (error) {
      modelAdminError = error instanceof Error ? error.message : 'Failed to delete model';
    }
  }

  async function importProviderModel(model: Record<string, any>) {
    const modelData = buildProviderImportPayload(modelSearchProvider, model);
    modelAdminError = '';
    modelAdminNotice = '';
    try {
      await adminPost({
        action: 'importEnabledModel',
        modelData
      });
      modelAdminNotice = `Imported ${model.name || model.id}`;
      await loadEnabledModels();
      await loadModelsFromAPI();
    } catch (error) {
      modelAdminError = error instanceof Error ? error.message : 'Failed to import model';
    }
  }

  function isProviderModelImported(modelId: string) {
    const fullId = providerModelId(modelSearchProvider, modelId);
    return enabledModels.some((model) => model.model_id === fullId);
  }

  async function saveProviderCredential(
    provider: 'anthropic' | 'openai' | 'openrouter',
    credentialType: ProviderCredential = 'api_key'
  ) {
    const inputByProvider = {
      anthropic: credentialType === 'auth_token' ? anthropicAuthTokenInput : anthropicApiKeyInput,
      openai: openAiApiKeyInput,
      openrouter: openRouterApiKeyInput
    };
    const labelByProvider = {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      openrouter: 'OpenRouter'
    };
    const credential = inputByProvider[provider].trim();
    const credentialLabel = credentialType === 'auth_token' ? 'OAuth/OAT bearer token' : 'API key';
    if (!credential) {
      modelAdminError = `Enter a ${labelByProvider[provider]} ${credentialLabel} first`;
      return;
    }
    apiKeySaving = true;
    modelAdminError = '';
    modelAdminNotice = '';
    try {
      await adminPost({
        action: 'setProviderApiKey',
        apiKey: credential,
        credentialType,
        provider
      });
      updateProviderCredential(provider, credential, credentialType);
      modelAdminNotice = `${labelByProvider[provider]} ${credentialLabel} saved`;
      if (provider === 'anthropic' && credentialType === 'api_key') anthropicApiKeyInput = '';
      if (provider === 'anthropic' && credentialType === 'auth_token') anthropicAuthTokenInput = '';
      if (provider === 'openai') openAiApiKeyInput = '';
      if (provider === 'openrouter') openRouterApiKeyInput = '';
    } catch (error) {
      modelAdminError =
        error instanceof Error
          ? error.message
          : `Failed to save ${labelByProvider[provider]} ${credentialLabel}`;
    } finally {
      apiKeySaving = false;
    }
  }

  async function loadChatCompactionSettings() {
    chatCompactionSettingsLoading = true;
    modelAdminError = '';
    try {
      const settings = (await adminFetch('settings', { category: 'chat_compaction' })) || [];
      const modelSetting = settings.find(
        (setting: { key?: unknown; value?: unknown }) => setting.key === 'model'
      );
      if (typeof modelSetting?.value === 'string' && modelSetting.value.trim()) {
        chatCompactionModelInput = modelSetting.value;
      }
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
    } catch (error) {
      modelAdminError =
        error instanceof Error ? error.message : 'Failed to save chat summarizer model';
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
      if (typeof modelSetting?.value === 'string' && modelSetting.value.trim()) {
        voiceModelInput = modelSetting.value;
      }
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
    } catch (error) {
      modelAdminError = error instanceof Error ? error.message : 'Failed to save voice model';
    } finally {
      voiceSettingsSaving = false;
    }
  }

  onMount(() => {
    // Load providers and models
    loadProvidersAndModels();
    loadEnabledModels();
    loadChatCompactionSettings();
    loadVoiceSettings();
    // Load memories
    loadMemories();

    return () => {};
  });

  function updateProviderCredential(
    provider: string,
    value: string,
    credentialType: ProviderCredential
  ) {
    const keyField = credentialType === 'auth_token' ? `${provider}AuthToken` : `${provider}ApiKey`;
    aiSettings.update((s: any) => ({
      ...s,
      [keyField]: value
    }));
  }

  const themeOptions: { label: string; value: UISettings['theme']; icon: typeof Monitor }[] = [
    { icon: Monitor, label: 'System', value: 'system' },
    { icon: Sun, label: 'Light', value: 'light' },
    { icon: Moon, label: 'Dark', value: 'dark' }
  ];

  function setThemePreference(theme: UISettings['theme']) {
    uiSettings.update((settings) => ({ ...settings, theme }));
    setMode(theme);
    window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme } }));
  }

  function setMemoryPreference(patch: {
    memoryAutoSave?: boolean;
    memorySaveMode?: 'conservative' | 'balanced' | 'aggressive';
    memoryReviewBeforeSave?: boolean;
  }) {
    personalizationSettings.update((settings) => ({ ...settings, ...patch }));
  }

  function toggleRule(ruleId: string) {
    personalizationSettings.update((settings) => ({
      ...settings,
      rules: settings.rules.map((rule) =>
        rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule
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
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Content class="h-[88vh] overflow-hidden p-0 sm:max-w-[1120px]">
    <div class="grid h-full min-h-0 grid-cols-[236px_1fr]">
      <aside class="flex min-h-0 flex-col border-r border-border/60 bg-muted/20">
        <Dialog.Header class="border-b border-border/60 p-4">
          <div class="flex items-center gap-3">
            <img
              src="/brand/logo.png"
              alt="Graphini"
              class="size-8 rounded-md border border-border/60" />
            <div class="min-w-0">
              <Dialog.Title class="truncate text-[13px] font-semibold">Settings</Dialog.Title>
              <Dialog.Description class="text-[13px] text-muted-foreground">
                Graphini preferences
              </Dialog.Description>
            </div>
          </div>
        </Dialog.Header>

        <nav class="flex-1 space-y-1 overflow-y-auto p-2">
          {#each settingsTabs as tab (tab.id)}
            {@const Icon = tab.icon}
            <button
              type="button"
              class="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors {activeTab ===
              tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'}"
              aria-current={activeTab === tab.id ? 'page' : undefined}
              onclick={() => (activeTab = tab.id)}>
              <Icon class="mt-1 size-4 shrink-0" />
              <span class="min-w-0">
                <span class="block text-[13px] font-medium">{tab.label}</span>
                <span class="block truncate text-[13px] text-muted-foreground"
                  >{tab.description}</span>
              </span>
            </button>
          {/each}
        </nav>

        <div class="border-t border-border/60 p-3">
          <Button
            size="sm"
            variant="outline"
            class="h-8 w-full justify-start gap-2 text-[13px]"
            onclick={downloadAppState}
            title="Export all app state as JSON">
            <Download class="size-3.5" />
            Export settings
          </Button>
        </div>
      </aside>

      <section class="flex min-h-0 flex-col">
        <div class="flex h-14 items-center justify-between border-b border-border/60 px-5">
          <div>
            <h2 class="text-[13px] font-semibold">
              {settingsTabs.find((tab) => tab.id === activeTab)?.label}
            </h2>
            <p class="text-[13px] text-muted-foreground">
              {settingsTabs.find((tab) => tab.id === activeTab)?.description}
            </p>
          </div>
          <Button class="h-8 text-[13px]" onclick={() => onOpenChange(false)}>Done</Button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-5">
          {#if activeTab === 'theme'}
            <div class="max-w-2xl space-y-5">
              <div class="space-y-2">
                <div class="text-[13px] font-medium">Theme</div>
                <div class="grid grid-cols-3 gap-2">
                  {#each themeOptions as option (option.value)}
                    {@const Icon = option.icon}
                    <button
                      type="button"
                      class="flex h-20 flex-col items-center justify-center gap-2 rounded-md border text-[13px] transition-colors {uiSettings
                        .value.theme === option.value
                        ? 'border-foreground bg-foreground text-background'
                        : 'border-border bg-background hover:bg-muted/60'}"
                      aria-pressed={uiSettings.value.theme === option.value}
                      onclick={() => setThemePreference(option.value)}>
                      <Icon class="size-4" />
                      {option.label}
                    </button>
                  {/each}
                </div>
              </div>

              <div class="divide-y divide-border rounded-md border border-border">
                <label class="flex items-center justify-between gap-4 p-3">
                  <span>
                    <span class="block text-[13px] font-medium">Show reasoning</span>
                    <span class="text-[13px] text-muted-foreground"
                      >Display visible reasoning summaries in chat.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={uiSettings.value.showReasoning}
                    onchange={(event) =>
                      uiSettings.update((settings) => ({
                        ...settings,
                        showReasoning: event.currentTarget.checked
                      }))} />
                </label>
                <label class="flex items-center justify-between gap-4 p-3">
                  <span>
                    <span class="block text-[13px] font-medium">Auto-scroll chat</span>
                    <span class="text-[13px] text-muted-foreground"
                      >Keep the newest assistant response in view.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={uiSettings.value.autoScroll}
                    onchange={(event) =>
                      uiSettings.update((settings) => ({
                        ...settings,
                        autoScroll: event.currentTarget.checked
                      }))} />
                </label>
                <label class="flex items-center justify-between gap-4 p-3">
                  <span>
                    <span class="block text-[13px] font-medium">Compact mode</span>
                    <span class="text-[13px] text-muted-foreground"
                      >Use tighter spacing in dense work areas.</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={uiSettings.value.compactMode}
                    onchange={(event) =>
                      uiSettings.update((settings) => ({
                        ...settings,
                        compactMode: event.currentTarget.checked
                      }))} />
                </label>
              </div>
            </div>
          {:else if activeTab === 'models'}
            <div class="space-y-5">
              <div class="grid gap-3 lg:grid-cols-3">
                <div class="rounded-md border border-border p-3">
                  <div class="mb-3 flex items-center justify-between">
                    <span class="text-[13px] font-medium">OpenRouter</span>
                    <Badge variant="outline" class="text-[13px]"
                      >{aiSettings.value.openrouterApiKey ? 'Saved' : 'Not set'}</Badge>
                  </div>
                  <div class="flex gap-2">
                    <Input
                      class="h-8 font-mono text-[12px]"
                      type="password"
                      autocomplete="off"
                      placeholder="sk-or-v1-..."
                      bind:value={openRouterApiKeyInput}
                      onkeydown={(event) =>
                        event.key === 'Enter' && saveProviderCredential('openrouter')} />
                    <Button
                      size="sm"
                      class="h-8 px-2"
                      disabled={apiKeySaving || !openRouterApiKeyInput.trim()}
                      onclick={() => saveProviderCredential('openrouter')}
                      ><Save class="size-3.5" /></Button>
                  </div>
                </div>
                <div class="rounded-md border border-border p-3">
                  <div class="mb-3 flex items-center justify-between">
                    <span class="text-[13px] font-medium">OpenAI</span>
                    <Badge variant="outline" class="text-[13px]"
                      >{aiSettings.value.openaiApiKey ? 'Saved' : 'Not set'}</Badge>
                  </div>
                  <div class="flex gap-2">
                    <Input
                      class="h-8 font-mono text-[12px]"
                      type="password"
                      autocomplete="off"
                      placeholder="sk-proj-..."
                      bind:value={openAiApiKeyInput}
                      onkeydown={(event) =>
                        event.key === 'Enter' && saveProviderCredential('openai')} />
                    <Button
                      size="sm"
                      class="h-8 px-2"
                      disabled={apiKeySaving || !openAiApiKeyInput.trim()}
                      onclick={() => saveProviderCredential('openai')}
                      ><Save class="size-3.5" /></Button>
                  </div>
                </div>
                <div class="rounded-md border border-border p-3">
                  <div class="mb-3 flex items-center justify-between">
                    <span class="text-[13px] font-medium">Anthropic</span>
                    <Badge variant="outline" class="text-[13px]"
                      >{aiSettings.value.anthropicApiKey || aiSettings.value.anthropicAuthToken
                        ? 'Saved'
                        : 'Not set'}</Badge>
                  </div>
                  <div class="space-y-2">
                    <div class="flex gap-2">
                      <Input
                        class="h-8 font-mono text-[12px]"
                        type="password"
                        autocomplete="off"
                        placeholder="sk-ant-..."
                        bind:value={anthropicApiKeyInput}
                        onkeydown={(event) =>
                          event.key === 'Enter' && saveProviderCredential('anthropic')} />
                      <Button
                        size="sm"
                        class="h-8 px-2"
                        disabled={apiKeySaving || !anthropicApiKeyInput.trim()}
                        onclick={() => saveProviderCredential('anthropic')}
                        ><Save class="size-3.5" /></Button>
                    </div>
                    <div class="flex gap-2">
                      <Input
                        class="h-8 font-mono text-[12px]"
                        type="password"
                        autocomplete="off"
                        placeholder="OAuth/OAT token"
                        bind:value={anthropicAuthTokenInput}
                        onkeydown={(event) =>
                          event.key === 'Enter' &&
                          saveProviderCredential('anthropic', 'auth_token')} />
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-8 px-2"
                        disabled={apiKeySaving || !anthropicAuthTokenInput.trim()}
                        onclick={() => saveProviderCredential('anthropic', 'auth_token')}
                        ><Save class="size-3.5" /></Button>
                    </div>
                  </div>
                </div>
              </div>

              {#if modelAdminError}
                <div
                  class="rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-[13px] text-warning dark:text-warning">
                  {modelAdminError}
                </div>
              {/if}
              {#if modelAdminNotice}
                <div
                  class="rounded-md border border-success/20 bg-success/10 px-3 py-2 text-[13px] text-success dark:text-success">
                  {modelAdminNotice}
                </div>
              {/if}

              <div class="rounded-md border border-border p-3">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div class="text-[13px] font-medium">Chat Summarizer Model</div>
                    <div class="mt-1 text-[13px] text-muted-foreground">
                      Used to compact older chat history only after the active model context budget
                      is near full.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-7 gap-1 text-[13px]"
                    disabled={chatCompactionSettingsLoading}
                    onclick={loadChatCompactionSettings}>
                    <RefreshCw
                      class="size-3 {chatCompactionSettingsLoading ? 'animate-spin' : ''}" /> Refresh
                  </Button>
                </div>
                <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <div class="space-y-2">
                    <Input
                      class="h-8 font-mono text-[12px]"
                      list="chat-compaction-model-options"
                      placeholder="Leave unset to use the active chat model"
                      bind:value={chatCompactionModelInput}
                      onkeydown={(event) =>
                        event.key === 'Enter' && saveChatCompactionSettings()} />
                    <datalist id="chat-compaction-model-options">
                      {#each enabledModels as model (model.model_id)}
                        <option value={model.model_id}>{model.model_name}</option>
                      {/each}
                    </datalist>
                    <div class="text-[13px] text-muted-foreground">
                      Pick a cheap, high-context text model. If unset, Graphini falls back to the
                      current chat model.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    class="h-8 gap-1 text-[13px]"
                    disabled={chatCompactionSettingsSaving || !chatCompactionModelInput.trim()}
                    onclick={saveChatCompactionSettings}>
                    <Save class="size-3.5" /> Save
                  </Button>
                </div>
              </div>

              <div class="grid min-h-[420px] gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                <div class="overflow-hidden rounded-md border border-border">
                  <div class="flex h-10 items-center justify-between border-b border-border px-3">
                    <span class="text-[13px] font-medium">Enabled Models</span>
                    <div class="flex items-center gap-2">
                      <Badge variant="outline" class="text-[13px]">{enabledModels.length}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 gap-1 text-[13px]"
                        onclick={loadEnabledModels}>
                        <RefreshCw class="size-3 {enabledModelsLoading ? 'animate-spin' : ''}" /> Refresh
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-7 gap-1 text-[13px]"
                        onclick={async () => {
                          for (const model of enabledModels.filter((item) => item.is_enabled)) {
                            await toggleEnabledModel(model.model_id, false);
                          }
                        }}>
                        <EyeOff class="size-3" /> Disable all
                      </Button>
                    </div>
                  </div>
                  <div class="max-h-[520px] overflow-auto">
                    {#if enabledModelsLoading}
                      <div class="flex items-center justify-center py-12">
                        <RefreshCw class="size-5 animate-spin text-muted-foreground" />
                      </div>
                    {:else if enabledModels.length === 0}
                      <div class="p-8 text-center text-[13px] text-muted-foreground">
                        No enabled models yet.
                      </div>
                    {:else}
                      <div class="divide-y divide-border">
                        {#each enabledModels as model (model.model_id)}
                          <div class="flex items-center justify-between gap-3 px-3 py-3">
                            <div class="min-w-0 flex-1">
                              <div class="truncate text-[13px] font-medium">{model.model_name}</div>
                              <div class="truncate font-mono text-[12px] text-muted-foreground">
                                {model.model_id}
                              </div>
                              <div class="mt-1 flex flex-wrap gap-1">
                                <Badge variant="secondary" class="text-[13px]"
                                  >{model.provider || 'openrouter'}</Badge>
                                {#if model.tool_support}<Badge variant="outline" class="text-[13px]"
                                    >Tools</Badge
                                  >{/if}
                                {#if model.is_free}<Badge variant="default" class="text-[13px]"
                                    >Free</Badge
                                  >{/if}
                              </div>
                            </div>
                            <div class="flex shrink-0 items-center gap-1">
                              <span class="text-[13px] text-muted-foreground"
                                >{model.gems_per_message ?? 2} gems</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                class="size-7 p-0"
                                title={model.is_enabled ? 'Disable' : 'Enable'}
                                onclick={() =>
                                  toggleEnabledModel(model.model_id, !model.is_enabled)}>
                                <Power
                                  class="size-3.5 {model.is_enabled
                                    ? 'text-success'
                                    : 'text-muted-foreground'}" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                class="size-7 p-0 text-destructive"
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

                <div class="overflow-hidden rounded-md border border-border">
                  <div class="space-y-3 border-b border-border p-3">
                    <div class="flex items-center justify-between">
                      <span class="text-[13px] font-medium">Model Search</span>
                      <Button
                        size="sm"
                        variant="outline"
                        class="h-7 gap-1 text-[13px]"
                        disabled={providerModelsLoading}
                        onclick={loadProviderModels}>
                        <Search class="size-3" /> Search
                      </Button>
                    </div>
                    <div class="grid grid-cols-3 gap-1">
                      {#each modelSearchProviders as provider (provider.value)}
                        <button
                          type="button"
                          class="rounded-md border px-2 py-2 text-[13px] transition-colors {modelSearchProvider ===
                          provider.value
                            ? 'border-foreground bg-foreground text-background'
                            : 'border-border hover:bg-muted'}"
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
                      placeholder="Search by model name, ID, or capability..."
                      bind:value={providerModelSearch}
                      onkeydown={(event) => event.key === 'Enter' && loadProviderModels()} />
                  </div>
                  <div class="max-h-[520px] overflow-auto">
                    {#if providerModelsLoading}
                      <div class="flex items-center justify-center py-12">
                        <RefreshCw class="size-5 animate-spin text-muted-foreground" />
                      </div>
                    {:else if providerModels.length === 0}
                      <div class="p-8 text-center text-[13px] text-muted-foreground">
                        Search models from the selected provider.
                      </div>
                    {:else}
                      <div class="divide-y divide-border">
                        {#each filteredProviderModels as model (model.id)}
                          {@const imported = isProviderModelImported(model.id)}
                          <div class="flex items-center justify-between gap-3 px-3 py-3">
                            <div class="min-w-0 flex-1">
                              <div class="truncate text-[13px] font-medium">
                                {model.name || model.id}
                              </div>
                              <div class="truncate font-mono text-[12px] text-muted-foreground">
                                {model.id}
                              </div>
                              <div class="mt-1 text-[13px] text-muted-foreground">
                                {model.contextWindow || model.context_length
                                  ? `${((model.contextWindow || model.context_length) / 1000).toFixed(0)}k context`
                                  : 'Context unknown'}
                              </div>
                            </div>
                            {#if imported}
                              <Badge variant="secondary" class="shrink-0 text-[13px]"
                                ><Check class="mr-1 size-3" /> Imported</Badge>
                            {:else}
                              <Button
                                size="sm"
                                variant="outline"
                                class="h-7 shrink-0 gap-1 text-[13px]"
                                onclick={() => importProviderModel(model)}>
                                <Download class="size-3" /> Import
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
          {:else if activeTab === 'voice'}
            <div class="space-y-5">
              {#if modelAdminError}
                <div
                  class="rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-[13px] text-warning dark:text-warning">
                  {modelAdminError}
                </div>
              {/if}
              {#if modelAdminNotice}
                <div
                  class="rounded-md border border-success/20 bg-success/10 px-3 py-2 text-[13px] text-success dark:text-success">
                  {modelAdminNotice}
                </div>
              {/if}

              <div class="rounded-md border border-border p-4">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div class="text-[13px] font-medium">Voice Transcription Model</div>
                    <div class="mt-1 text-[13px] text-muted-foreground">
                      Used by the voice input API when converting microphone audio to text.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-7 gap-1 text-[13px]"
                    disabled={voiceSettingsLoading}
                    onclick={loadVoiceSettings}>
                    <RefreshCw class="size-3 {voiceSettingsLoading ? 'animate-spin' : ''}" /> Refresh
                  </Button>
                </div>

                <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <div class="space-y-2">
                    <Input
                      class="h-8 font-mono text-[12px]"
                      list="voice-model-options"
                      placeholder="google/gemini-2.0-flash-001"
                      bind:value={voiceModelInput}
                      onkeydown={(event) => event.key === 'Enter' && saveVoiceSettings()} />
                    <datalist id="voice-model-options">
                      <option value="google/gemini-2.0-flash-001"></option>
                      <option value="gemini-2.0-flash-lite"></option>
                      {#each enabledModels as model (model.model_id)}
                        <option value={model.model_id}>{model.model_name}</option>
                      {/each}
                    </datalist>
                    <div class="text-[13px] text-muted-foreground">
                      OpenRouter model IDs like google/gemini-2.0-flash-001 use the OpenRouter key.
                      Gemini IDs like gemini-2.0-flash-lite use GEMINI_API_KEY.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    class="h-8 gap-1 text-[13px]"
                    disabled={voiceSettingsSaving || !voiceModelInput.trim()}
                    onclick={saveVoiceSettings}>
                    <Save class="size-3.5" /> Save
                  </Button>
                </div>
              </div>
            </div>
          {:else if activeTab === 'tools'}
            <div class="space-y-4">
              <div class="flex items-center justify-between">
                <div class="text-[13px] text-muted-foreground">
                  {toolsConfig.filter((t) => t.enabled).length} of {toolsConfig.length} tools enabled
                </div>
                <div class="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-8 text-[13px]"
                    onclick={() => toolsStore.enableAll()}>Enable all</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    class="h-8 gap-1 text-[13px]"
                    onclick={() => toolsStore.reset()}><RotateCcw class="size-3" /> Reset</Button>
                </div>
              </div>

              {#each TOOL_CATEGORIES as cat}
                {@const catTools = toolsConfig.filter((t) => t.category === cat.id)}
                {#if catTools.length > 0}
                  <div class="overflow-hidden rounded-md border border-border">
                    <div class="border-b border-border bg-muted/20 px-3 py-2 text-[13px] font-medium">
                      {cat.label}
                    </div>
                    <div class="divide-y divide-border">
                      {#each catTools as t}
                        <button
                          type="button"
                          class="flex w-full items-center justify-between gap-4 px-3 py-3 text-left hover:bg-muted/40"
                          onclick={() => toolsStore.toggle(t.id)}>
                          <span class="min-w-0">
                            <span class="block text-[13px] font-medium">{t.label}</span>
                            <span class="block text-[13px] text-muted-foreground"
                              >{t.description}</span>
                          </span>
                          <span class={t.enabled ? 'text-success' : 'text-muted-foreground'}>
                            {#if t.enabled}<ToggleRight class="size-5" />{:else}<ToggleLeft
                                class="size-5" />{/if}
                          </span>
                        </button>
                      {/each}
                    </div>
                  </div>
                {/if}
              {/each}
            </div>
          {:else if activeTab === 'rules'}
            <div class="grid gap-4 lg:grid-cols-2">
              <div class="overflow-hidden rounded-md border border-border">
                <div class="flex h-10 items-center justify-between border-b border-border px-3">
                  <span class="flex items-center gap-2 text-[13px] font-medium"
                    ><ShieldCheck class="size-3.5" /> Rules</span>
                  <div class="flex gap-2">
                    <Button size="sm" variant="outline" class="h-7 gap-1 text-[13px]"
                      ><Download class="size-3" /> Import</Button>
                    <Button size="sm" class="h-7 gap-1 text-[13px]"
                      ><Plus class="size-3" /> Create</Button>
                  </div>
                </div>
                <div class="divide-y divide-border">
                  {#each personalization.rules as rule (rule.id)}
                    <button
                      type="button"
                      class="flex w-full items-start justify-between gap-4 px-3 py-3 text-left hover:bg-muted/40"
                      onclick={() => toggleRule(rule.id)}>
                      <span class="min-w-0">
                        <span class="block text-[13px] font-medium">{rule.name}</span>
                        <span class="mt-1 block text-[13px] leading-5 text-muted-foreground"
                          >{rule.body}</span>
                        <span class="mt-2 block text-[13px] text-muted-foreground"
                          >Source: {rule.source}</span>
                      </span>
                      <span class={rule.enabled ? 'text-success' : 'text-muted-foreground'}>
                        {#if rule.enabled}<ToggleRight class="size-5" />{:else}<ToggleLeft
                            class="size-5" />{/if}
                      </span>
                    </button>
                  {:else}
                    <div class="p-8 text-center text-[13px] text-muted-foreground">No rules yet.</div>
                  {/each}
                </div>
              </div>

              <div class="overflow-hidden rounded-md border border-border">
                <div class="flex h-10 items-center justify-between border-b border-border px-3">
                  <span class="flex items-center gap-2 text-[13px] font-medium"
                    ><FileText class="size-3.5" /> Skills</span>
                  <div class="flex gap-2">
                    <Button size="sm" variant="outline" class="h-7 gap-1 text-[13px]"
                      ><Download class="size-3" /> Import</Button>
                    <Button size="sm" class="h-7 gap-1 text-[13px]"
                      ><Plus class="size-3" /> Create</Button>
                  </div>
                </div>
                <div class="divide-y divide-border">
                  {#each personalization.skills as skill (skill.id)}
                    <button
                      type="button"
                      class="flex w-full items-start justify-between gap-4 px-3 py-3 text-left hover:bg-muted/40"
                      onclick={() => toggleSkill(skill.id)}>
                      <span class="min-w-0">
                        <span class="block text-[13px] font-medium">{skill.name}</span>
                        <span class="mt-1 block text-[13px] leading-5 text-muted-foreground"
                          >{skill.description}</span>
                        <span class="mt-2 block text-[13px] text-muted-foreground"
                          >Source: {skill.source}</span>
                      </span>
                      <span class={skill.enabled ? 'text-success' : 'text-muted-foreground'}>
                        {#if skill.enabled}<ToggleRight class="size-5" />{:else}<ToggleLeft
                            class="size-5" />{/if}
                      </span>
                    </button>
                  {:else}
                    <div class="p-8 text-center text-[13px] text-muted-foreground">
                      No skills imported yet.
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {:else if activeTab === 'memory'}
            <div class="grid gap-4 lg:grid-cols-[360px_1fr]">
              <div class="space-y-4">
                <div class="divide-y divide-border rounded-md border border-border">
                  <label class="flex items-center justify-between gap-4 p-3">
                    <span>
                      <span class="block text-[13px] font-medium">Auto-save memory</span>
                      <span class="text-[13px] text-muted-foreground"
                        >Allow the model to save useful user preferences.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={personalization.memoryAutoSave}
                      onchange={(event) =>
                        setMemoryPreference({ memoryAutoSave: event.currentTarget.checked })} />
                  </label>
                  <label class="flex items-center justify-between gap-4 p-3">
                    <span>
                      <span class="block text-[13px] font-medium">Review before save</span>
                      <span class="text-[13px] text-muted-foreground"
                        >Ask before writing new long-term memory.</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={personalization.memoryReviewBeforeSave}
                      onchange={(event) =>
                        setMemoryPreference({
                          memoryReviewBeforeSave: event.currentTarget.checked
                        })} />
                  </label>
                </div>

                <div class="rounded-md border border-border p-3">
                  <div class="mb-2 text-[13px] font-medium">Save behavior</div>
                  <div class="grid gap-2">
                    {#each ['conservative', 'balanced', 'aggressive'] as mode}
                      <button
                        type="button"
                        class="rounded-md border px-3 py-2 text-left text-[13px] capitalize transition-colors {personalization.memorySaveMode ===
                        mode
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border hover:bg-muted'}"
                        onclick={() =>
                          setMemoryPreference({
                            memorySaveMode: mode as 'conservative' | 'balanced' | 'aggressive'
                          })}>
                        {mode}
                      </button>
                    {/each}
                  </div>
                </div>
              </div>

              <div class="overflow-hidden rounded-md border border-border">
                <div class="flex h-10 items-center justify-between border-b border-border px-3">
                  <span class="flex items-center gap-2 text-[13px] font-medium"
                    ><BookOpen class="size-3.5" /> Saved Memories</span>
                  <button
                    type="button"
                    class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Refresh memories"
                    onclick={loadMemories}>
                    <RotateCcw class="size-3.5 {memoryLoading ? 'animate-spin' : ''}" />
                  </button>
                </div>

                {#if memoryLoading}
                  <div class="p-8 text-center text-[13px] text-muted-foreground">
                    Loading memories...
                  </div>
                {:else if memories.length === 0}
                  <div class="p-8 text-center text-[13px] text-muted-foreground">
                    No memories saved yet.
                  </div>
                {:else}
                  <div class="max-h-[420px] divide-y divide-border overflow-y-auto">
                    {#each memories as mem (mem.key)}
                      <div class="group flex items-start gap-3 px-3 py-3">
                        {#if editingKey === mem.key}
                          <div class="flex-1 space-y-2">
                            <div class="text-[13px] font-medium">{mem.key}</div>
                            <textarea
                              class="min-h-20 w-full resize-none rounded-md border border-border bg-background px-2 py-2 text-[13px] outline-none focus:border-foreground"
                              bind:value={editingValue}></textarea>
                            <div class="flex gap-2">
                              <Button
                                size="sm"
                                class="h-7 gap-1 text-[13px]"
                                onclick={() => saveMemory(mem.key, editingValue)}
                                ><Save class="size-3" /> Save</Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                class="h-7 text-[13px]"
                                onclick={() => {
                                  editingKey = null;
                                  editingValue = '';
                                }}>Cancel</Button>
                            </div>
                          </div>
                        {:else}
                          <div class="min-w-0 flex-1">
                            <div class="text-[13px] font-medium">{mem.key}</div>
                            <div class="mt-1 text-[13px] leading-5 text-muted-foreground">
                              {mem.value}
                            </div>
                            {#if mem.savedAt}<div class="mt-2 text-[13px] text-muted-foreground">
                                {new Date(mem.savedAt).toLocaleDateString()}
                              </div>{/if}
                          </div>
                          <div
                            class="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              size="sm"
                              variant="ghost"
                              class="size-7 p-0"
                              title="Edit"
                              onclick={() => {
                                editingKey = mem.key;
                                editingValue = mem.value;
                              }}><Pencil class="size-3.5" /></Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              class="size-7 p-0 text-destructive"
                              title="Delete"
                              onclick={() => deleteMemory(mem.key)}
                              ><Trash2 class="size-3.5" /></Button>
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}

                <div class="border-t border-border p-3">
                  <div class="mb-2 text-[13px] font-medium">Add memory</div>
                  <div class="flex gap-2">
                    <Input class="h-8 text-[13px]" placeholder="Key" bind:value={newMemoryKey} />
                    <Input
                      class="h-8 flex-[2] text-[13px]"
                      placeholder="Value"
                      bind:value={newMemoryValue} />
                    <Button
                      class="h-8 gap-1 text-[13px]"
                      disabled={!newMemoryKey.trim() || !newMemoryValue.trim()}
                      onclick={() => saveMemory(newMemoryKey.trim(), newMemoryValue.trim())}>
                      <Save class="size-3.5" /> Add
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          {/if}
        </div>
      </section>
    </div>
  </Dialog.Content>
</Dialog.Root>
