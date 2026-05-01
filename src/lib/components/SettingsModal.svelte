<script lang="ts">
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import {
    adminFetch,
    adminPost,
    buildOpenRouterImportPayload,
    ensureGeminiProvider,
    mapProviderSettings,
    normalizeModelId,
    type ProviderOption
  } from '$lib/components/settings/model-admin';
  import { aiSettings, TOOL_CATEGORIES, toolsStore } from '$lib/stores';
  import { kv } from '$lib/stores/kvStore.svelte';
  import {
    allModelsStore,
    favoriteModelsStore,
    loadModelsFromAPI,
    modelsLoadingStore,
    selectedChatModelsStore
  } from '$lib/stores/modelStore.svelte';
  import { downloadAppState } from '$lib/util/serialization/exportState';
  import {
    BookOpen,
    Check,
    Download,
    EyeOff,
    Pencil,
    Power,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    ToggleLeft,
    ToggleRight,
    Trash2,
    Wrench
  } from 'lucide-svelte';
  import { onMount } from 'svelte';

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

  // Local state for API key input
  let apiKeyInput = $state('');

  // Use new three-tier model system
  // allModels, favoriteModels, selectedChatModels, loadingProviders are derived from stores below
  let providers = $state<ProviderOption[]>([]);
  let enabledModels = $state<Record<string, any>[]>([]);
  let enabledModelsLoading = $state(false);
  let openRouterModels = $state<Record<string, any>[]>([]);
  let openRouterLoading = $state(false);
  let openRouterSearch = $state('');
  let modelAdminError = $state('');
  let modelAdminNotice = $state('');

  // Critical fix: Sync API key input when provider changes
  $effect(() => {
    if (aiSettings.value?.provider) {
      const keyField = `${aiSettings.value.provider}ApiKey`;
      apiKeyInput = (aiSettings.value as any)[keyField] ?? '';
    }
  });

  // Critical fix: Missing toggle favorite function
  function toggleFavoriteModel(modelId: string) {
    favoriteModelsStore.update((favs) =>
      favs.includes(modelId) ? favs.filter((id) => id !== modelId) : [...favs, modelId]
    );
  }

  // Reactive bindings to model stores (Svelte 5 runes)
  let allModels = $derived(allModelsStore.value);
  let favoriteModels = $derived(favoriteModelsStore.value);
  let selectedChatModels = $derived(selectedChatModelsStore.value);
  let loadingProviders = $derived(modelsLoadingStore.value);
  let filteredOpenRouterModels = $derived.by(() => {
    const q = openRouterSearch.toLowerCase().trim();
    if (!q) return openRouterModels.slice(0, 80);
    return openRouterModels
      .filter((model) =>
        [model.id, model.name, model.description, model.architecture?.modality]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      )
      .slice(0, 80);
  });

  async function loadProvidersAndModels() {
    // Load all models from admin
    await loadModelsFromAPI();

    // Load providers separately since they're not in the shared store yet
    try {
      const providersRes = await fetch('/api/admin?action=providers');
      const providersData = await providersRes.json();
      if (providersData.success) {
        providers = mapProviderSettings(providersData.data);
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
    }

    providers = ensureGeminiProvider(providers);
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

  async function loadOpenRouterModels() {
    openRouterLoading = true;
    modelAdminError = '';
    try {
      openRouterModels = (await adminFetch('openrouter_models')) || [];
    } catch (error) {
      modelAdminError = error instanceof Error ? error.message : 'Failed to load OpenRouter models';
    } finally {
      openRouterLoading = false;
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

  async function importOpenRouterModel(model: Record<string, any>) {
    const fullId = `openrouter/${model.id}`;
    modelAdminError = '';
    modelAdminNotice = '';
    try {
      await adminPost({
        action: 'importOpenRouterModel',
        modelData: {
          ...buildOpenRouterImportPayload(model),
          model_id: fullId
        }
      });
      modelAdminNotice = `Imported ${model.name || model.id}`;
      await loadEnabledModels();
      await loadModelsFromAPI();
    } catch (error) {
      modelAdminError = error instanceof Error ? error.message : 'Failed to import model';
    }
  }

  function isOpenRouterImported(modelId: string) {
    return enabledModels.some((model) => model.model_id === `openrouter/${modelId}`);
  }

  onMount(() => {
    // Load providers and models
    loadProvidersAndModels();
    loadEnabledModels();
    // Load memories
    loadMemories();

    return () => {};
  });

  function setProvider(nextProvider: string) {
    const currentModel = aiSettings.value.providerModel || '';
    const normalizedModel = normalizeModelId(nextProvider, currentModel);

    const provider = providers.find((p) => p.id === nextProvider);

    aiSettings.update((s: any) => ({
      ...s,
      provider: nextProvider,
      providerModel: normalizedModel,
      model: normalizedModel,
      baseUrl: provider?.baseUrl || s.baseUrl || ''
    }));
  }

  function setProviderModel(nextModel: string) {
    const fullModelId = normalizeModelId(aiSettings.value.provider, nextModel);
    aiSettings.update((s: any) => ({
      ...s,
      providerModel: fullModelId,
      model: fullModelId
    }));
  }

  function updateApiKey(provider: string, value: string) {
    const keyField = `${provider}ApiKey` as const;
    aiSettings.update((s: any) => ({
      ...s,
      [keyField]: value
    }));
  }

  // Add missing function with proper limit checking
  function addToChatSelection(model: any) {
    selectedChatModelsStore.update((list: any[]) => {
      if (list.length >= 10) return list; // Enforce max-10 limit
      if (list.some((m: any) => m.id === model.id)) return list; // Avoid duplicates
      return [...list, model];
    });
  }

  // Debounced API key update to prevent excessive store updates
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  function debouncedUpdateApiKey(provider: string, value: string) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      updateApiKey(provider, value);
    }, 300);
  }

  function getApiKeyField(provider: string): string {
    return `${provider}ApiKey` as string;
  }
</script>

<Dialog.Root bind:open {onOpenChange}>
  <Dialog.Content class="max-h-[92vh] overflow-y-auto sm:max-w-[1120px]">
    <Dialog.Header>
      <div class="flex items-center gap-3">
        <div
          class="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 shadow-sm">
          <img src="/brand/logo.png" alt="Graphini" class="size-6 rounded-md" />
        </div>
        <div>
          <Dialog.Title class="text-base font-bold tracking-tight">Graphini Settings</Dialog.Title>
          <Dialog.Description class="text-[11px] text-muted-foreground/70">
            Configure AI tools and preferences
          </Dialog.Description>
        </div>
      </div>
    </Dialog.Header>

    <div class="space-y-4 py-3">
      <!-- Model Access Card -->
      <div
        class="space-y-3 rounded-xl border border-border/50 bg-muted/5 p-3.5 dark:border-border/30 dark:bg-white/[0.02]">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <div class="flex size-6 items-center justify-center rounded-lg bg-violet-500/10">
              <Power class="size-3 text-violet-500" />
            </div>
            <div>
              <span class="text-xs font-semibold text-foreground">Model Access</span>
              <p class="text-[10px] text-muted-foreground/60">
                Manage the models shown in chat. Admin-only controls live here now.
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1.5">
            <Badge variant="outline" class="text-[10px]">{enabledModels.length} models</Badge>
            <Button
              size="sm"
              variant="outline"
              class="h-7 gap-1 text-[10px]"
              disabled={enabledModelsLoading}
              onclick={loadEnabledModels}>
              <RefreshCw class="size-3 {enabledModelsLoading ? 'animate-spin' : ''}" />
              Refresh
            </Button>
          </div>
        </div>

        {#if modelAdminError}
          <div
            class="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-700 dark:text-amber-300">
            {modelAdminError}
          </div>
        {/if}
        {#if modelAdminNotice}
          <div
            class="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[10px] text-emerald-700 dark:text-emerald-300">
            {modelAdminNotice}
          </div>
        {/if}

        <div class="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
          <div class="overflow-hidden rounded-lg border border-border/40 bg-background/80">
            <div class="flex items-center justify-between border-b border-border/40 px-3 py-2">
              <span class="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
                >Enabled Models</span>
              <Button
                size="sm"
                variant="ghost"
                class="h-6 gap-1 text-[10px]"
                onclick={async () => {
                  for (const model of enabledModels.filter((item) => item.is_enabled)) {
                    await toggleEnabledModel(model.model_id, false);
                  }
                }}>
                <EyeOff class="size-3" /> Disable All
              </Button>
            </div>
            <div class="max-h-[360px] overflow-auto">
              {#if enabledModelsLoading}
                <div class="flex items-center justify-center py-10">
                  <RefreshCw class="size-5 animate-spin text-muted-foreground" />
                </div>
              {:else if enabledModels.length === 0}
                <div class="p-6 text-center text-[11px] text-muted-foreground">
                  No enabled models yet. Import one from OpenRouter.
                </div>
              {:else}
                <div class="divide-y divide-border/40">
                  {#each enabledModels as model (model.model_id)}
                    <div class="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-[11px] font-semibold text-foreground">
                          {model.model_name}
                        </div>
                        <div class="truncate font-mono text-[9px] text-muted-foreground/70">
                          {model.model_id}
                        </div>
                        <div class="mt-1 flex flex-wrap items-center gap-1">
                          <Badge variant="secondary" class="text-[8px]"
                            >{model.provider || 'openrouter'}</Badge>
                          <Badge variant="outline" class="text-[8px]"
                            >{model.category || 'General'}</Badge>
                          {#if model.is_free}
                            <Badge variant="default" class="text-[8px]">Free</Badge>
                          {/if}
                          {#if model.tool_support}
                            <Badge variant="outline" class="text-[8px]">Tools</Badge>
                          {/if}
                        </div>
                      </div>
                      <div class="flex shrink-0 items-center gap-1">
                        <span class="text-[10px] text-muted-foreground"
                          >{model.gems_per_message ?? 2} gems</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          class="size-7 p-0"
                          title={model.is_enabled ? 'Disable' : 'Enable'}
                          onclick={() => toggleEnabledModel(model.model_id, !model.is_enabled)}>
                          <Power
                            class="size-3.5 {model.is_enabled
                              ? 'text-emerald-500'
                              : 'text-muted-foreground/50'}" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          class="size-7 p-0 text-red-500"
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

          <div class="overflow-hidden rounded-lg border border-border/40 bg-background/80">
            <div class="space-y-2 border-b border-border/40 p-3">
              <div class="flex items-center justify-between gap-2">
                <span
                  class="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
                  >OpenRouter Import</span>
                <Button
                  size="sm"
                  variant="outline"
                  class="h-6 gap-1 text-[10px]"
                  disabled={openRouterLoading}
                  onclick={loadOpenRouterModels}>
                  <RefreshCw class="size-3 {openRouterLoading ? 'animate-spin' : ''}" />
                  Load
                </Button>
              </div>
              <div class="relative">
                <Search
                  class="absolute top-1/2 left-2.5 size-3 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  class="h-8 pl-7 text-[11px]"
                  placeholder="Search Claude, GPT, GLM, MiniMax..."
                  bind:value={openRouterSearch} />
              </div>
            </div>
            <div class="max-h-[360px] overflow-auto">
              {#if openRouterLoading}
                <div class="flex items-center justify-center py-10">
                  <RefreshCw class="size-5 animate-spin text-muted-foreground" />
                </div>
              {:else if openRouterModels.length === 0}
                <div class="p-6 text-center text-[11px] text-muted-foreground">
                  Load OpenRouter models to import tool-capable options.
                </div>
              {:else}
                <div class="divide-y divide-border/40">
                  {#each filteredOpenRouterModels as model (model.id)}
                    {@const imported = isOpenRouterImported(model.id)}
                    <div class="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-[11px] font-semibold text-foreground">
                          {model.name || model.id}
                        </div>
                        <div class="truncate font-mono text-[9px] text-muted-foreground/70">
                          {model.id}
                        </div>
                        <div class="mt-1 text-[9px] text-muted-foreground/60">
                          {model.context_length
                            ? `${(model.context_length / 1000).toFixed(0)}k context`
                            : 'Context unknown'}
                        </div>
                      </div>
                      {#if imported}
                        <Badge variant="secondary" class="shrink-0 text-[8px]">
                          <Check class="mr-1 size-3" /> Imported
                        </Badge>
                      {:else}
                        <Button
                          size="sm"
                          variant="outline"
                          class="h-7 shrink-0 gap-1 text-[10px]"
                          onclick={() => importOpenRouterModel(model)}>
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

      <!-- Tools Configuration Card -->
      <div
        class="space-y-2.5 rounded-xl border border-border/50 bg-muted/5 p-3.5 dark:border-border/30 dark:bg-white/[0.02]">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="flex size-6 items-center justify-center rounded-lg bg-indigo-500/10">
              <Wrench class="size-3 text-indigo-500" />
            </div>
            <span class="text-xs font-semibold text-foreground">AI Tools</span>
            <span
              class="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              {toolsConfig.filter((t) => t.enabled).length}/{toolsConfig.length}
            </span>
          </div>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-indigo-500/10 hover:text-indigo-500"
              title="Enable all tools"
              onclick={() => toolsStore.enableAll()}>
              All On
            </button>
            <button
              type="button"
              class="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
              title="Reset to defaults"
              onclick={() => toolsStore.reset()}>
              <RotateCcw class="size-3" />
            </button>
          </div>
        </div>

        {#each TOOL_CATEGORIES as cat}
          {@const catTools = toolsConfig.filter((t) => t.category === cat.id)}
          {#if catTools.length > 0}
            <div class="space-y-1.5">
              <div class="flex items-center gap-1.5 px-0.5">
                <div class="h-px flex-1 bg-border/40"></div>
                <span
                  class="text-[9px] font-semibold tracking-wider text-muted-foreground/50 uppercase">
                  {cat.label}
                </span>
                <div class="h-px flex-1 bg-border/40"></div>
              </div>
              {#each catTools as t}
                <button
                  type="button"
                  class="flex w-full items-center justify-between rounded-lg border border-border/30 bg-background/80 px-3 py-2 text-left transition-all duration-150 hover:border-border/50 hover:bg-muted/30 dark:border-border/20 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]"
                  onclick={() => toolsStore.toggle(t.id)}>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <span class="text-[11px] font-semibold text-foreground/90">{t.label}</span>
                      {#if !t.enabled}
                        <span
                          class="rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[8px] font-semibold text-orange-500 dark:text-orange-400"
                          >OFF</span>
                      {/if}
                    </div>
                    <div class="mt-0.5 text-[10px] leading-tight text-muted-foreground/60">
                      {t.description}
                    </div>
                  </div>
                  <div
                    class="ml-3 flex-shrink-0 transition-colors {t.enabled
                      ? 'text-indigo-500'
                      : 'text-muted-foreground/30'}">
                    {#if t.enabled}
                      <ToggleRight class="size-5" />
                    {:else}
                      <ToggleLeft class="size-5" />
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        {/each}

        <p class="px-0.5 text-[10px] leading-relaxed text-muted-foreground/50">
          Disabled tools won't be available to the AI during chat sessions.
        </p>
      </div>

      <!-- Memory Section -->
      <div
        class="space-y-2.5 rounded-xl border border-border/50 bg-muted/5 p-3.5 dark:border-border/30 dark:bg-white/[0.02]">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="flex size-6 items-center justify-center rounded-lg bg-emerald-500/10">
              <BookOpen class="size-3 text-emerald-500" />
            </div>
            <span class="text-xs font-semibold text-foreground">AI Memories</span>
            <span
              class="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
              {memories.length}
            </span>
          </div>
          <button
            type="button"
            class="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
            title="Refresh memories"
            onclick={loadMemories}>
            <RotateCcw class="size-3 {memoryLoading ? 'animate-spin' : ''}" />
          </button>
        </div>

        {#if memoryLoading}
          <div class="flex items-center justify-center py-4">
            <span class="text-[10px] text-muted-foreground">Loading memories…</span>
          </div>
        {:else if memories.length === 0}
          <div class="flex flex-col items-center gap-1 py-4 text-center">
            <BookOpen class="size-4 text-muted-foreground/30" />
            <span class="text-[10px] text-muted-foreground/60">No memories saved yet</span>
            <span class="text-[9px] text-muted-foreground/40"
              >The AI will remember things you tell it during chat</span>
          </div>
        {:else}
          <div class="max-h-[200px] space-y-1.5 overflow-y-auto">
            {#each memories as mem (mem.key)}
              <div
                class="group flex items-start gap-2 rounded-lg border border-border/30 bg-background/80 px-3 py-2 dark:border-border/20 dark:bg-white/[0.02]">
                {#if editingKey === mem.key}
                  <div class="flex-1 space-y-1.5">
                    <span class="text-[10px] font-semibold text-foreground/70">{mem.key}</span>
                    <textarea
                      class="w-full resize-none rounded-md border border-border/50 bg-muted/30 px-2 py-1.5 text-[11px] text-foreground outline-none focus:border-indigo-500/50 dark:bg-white/[0.03]"
                      rows="2"
                      bind:value={editingValue}></textarea>
                    <div class="flex gap-1">
                      <button
                        type="button"
                        class="flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-0.5 text-[9px] font-medium text-indigo-500 transition-colors hover:bg-indigo-500/20"
                        onclick={() => saveMemory(mem.key, editingValue)}>
                        <Save class="size-2.5" /> Save
                      </button>
                      <button
                        type="button"
                        class="rounded-md px-2 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-muted"
                        onclick={() => {
                          editingKey = null;
                          editingValue = '';
                        }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                {:else}
                  <div class="min-w-0 flex-1">
                    <div class="text-[10px] font-semibold text-foreground/80">{mem.key}</div>
                    <div class="mt-0.5 text-[10px] leading-snug text-muted-foreground/70">
                      {mem.value}
                    </div>
                    {#if mem.savedAt}
                      <div class="mt-1 text-[8px] text-muted-foreground/40">
                        {new Date(mem.savedAt).toLocaleDateString()}
                      </div>
                    {/if}
                  </div>
                  <div
                    class="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      class="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
                      title="Edit"
                      onclick={() => {
                        editingKey = mem.key;
                        editingValue = mem.value;
                      }}>
                      <Pencil class="size-3" />
                    </button>
                    <button
                      type="button"
                      class="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-500"
                      title="Delete"
                      onclick={() => deleteMemory(mem.key)}>
                      <Trash2 class="size-3" />
                    </button>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <!-- Add new memory -->
        <div class="space-y-1.5 border-t border-border/30 pt-2">
          <span class="text-[9px] font-semibold tracking-wider text-muted-foreground/50 uppercase"
            >Add Memory</span>
          <div class="flex gap-1.5">
            <input
              type="text"
              placeholder="Key (e.g. preferred_style)"
              class="h-7 flex-1 rounded-md border border-border/40 bg-muted/20 px-2 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-indigo-500/50 dark:bg-white/[0.03]"
              bind:value={newMemoryKey} />
            <input
              type="text"
              placeholder="Value"
              class="h-7 flex-[2] rounded-md border border-border/40 bg-muted/20 px-2 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-indigo-500/50 dark:bg-white/[0.03]"
              bind:value={newMemoryValue} />
            <button
              type="button"
              class="flex h-7 items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 text-[10px] font-medium text-emerald-500 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
              disabled={!newMemoryKey.trim() || !newMemoryValue.trim()}
              onclick={() => saveMemory(newMemoryKey.trim(), newMemoryValue.trim())}>
              <Save class="size-3" /> Add
            </button>
          </div>
        </div>

        <p class="px-0.5 text-[10px] leading-relaxed text-muted-foreground/50">
          Memories help the AI remember your preferences across conversations.
        </p>
      </div>
    </div>

    <Dialog.Footer class="flex items-center justify-between border-t border-border/30 pt-3">
      <div class="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          class="h-8 gap-1.5 rounded-lg text-xs"
          onclick={downloadAppState}
          title="Export all app state as JSON">
          <Download class="size-3.5" />
          Export
        </Button>
        <span class="text-[9px] text-muted-foreground/40">Graphini v1.0</span>
      </div>
      <Button
        class="h-8 rounded-lg bg-indigo-600 text-xs text-white hover:bg-indigo-700"
        onclick={() => onOpenChange(false)}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
