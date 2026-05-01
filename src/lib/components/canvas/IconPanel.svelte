<script lang="ts">
  import { inputStateStore, updateCodeStore } from '$/util/state/state';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { injectNodeImg, svgIdToNodeName } from '$lib/util/diagram/diagramMapper';
  import {
    ChevronDown,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    Globe,
    HardDrive,
    Loader2,
    Palette,
    Search,
    Trash2,
    X
  } from 'lucide-svelte';
  import { onDestroy, onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { get } from 'svelte/store';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  interface IconEntry {
    id: string;
    path: string;
    category: string;
    keywords: string[];
  }

  let searchQuery = $state('');
  let allIcons = $state<IconEntry[]>([]);
  let expandedCategories = new SvelteSet<string>();
  let loading = $state(false);
  let selectedIcon = $state<string | null>(null);
  let selectedNodeId = $state<string | null>(null);
  let isApplying = $state(false);
  let allExpanded = $state(true);
  let activeCategory = $state<string | null>(null);

  // Track where the panel was opened from for positioning
  let openSource = $state<'toolbar' | 'sidebar'>('sidebar');

  // Tab state: 'local' or 'web'
  let activeTab = $state<'local' | 'web'>('local');

  // Web icon search state
  interface WebIcon {
    id: string;
    prefix: string;
    name: string;
    url: string;
  }
  let webSearchQuery = $state('');
  let webResults = $state<WebIcon[]>([]);
  let webLoading = $state(false);
  let webSearchTimer: ReturnType<typeof setTimeout> | null = null;

  async function searchWebIcons(query: string) {
    if (!query.trim()) {
      webResults = [];
      return;
    }
    webLoading = true;
    try {
      const encoded = encodeURIComponent(query);
      const res = await fetch(`https://api.iconify.design/search?query=${encoded}&limit=60`);
      if (res.ok) {
        const data = await res.json();
        const icons: string[] = data.icons || [];
        webResults = icons.map((iconId) => {
          const [prefix, ...nameParts] = iconId.split(':');
          const name = nameParts.join(':');
          return {
            id: iconId,
            prefix,
            name,
            url: `https://api.iconify.design/${prefix}/${name}.svg`
          };
        });
      } else {
        webResults = [];
      }
    } catch {
      webResults = [];
    }
    webLoading = false;
  }

  function handleWebSearchInput(value: string) {
    webSearchQuery = value;
    if (webSearchTimer) clearTimeout(webSearchTimer);
    webSearchTimer = setTimeout(() => searchWebIcons(value), 350);
  }

  function selectWebIcon(icon: WebIcon) {
    selectedIcon = icon.url;
    applyImgIcon(icon.url, icon.name);
  }

  function formatWebIconName(name: string): string {
    return name
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  const CATEGORY_LABELS: Record<string, string> = {
    aws: 'Amazon Web Services',
    azure: 'Microsoft Azure',
    cisco: 'Cisco',
    d365: 'Dynamics 365',
    fabric: 'Microsoft Fabric',
    gcp: 'Google Cloud',
    general: 'General & Brands',
    k8s: 'Kubernetes',
    oci: 'Oracle Cloud',
    power: 'Power Platform',
    ui: 'UI Elements'
  };

  const CATEGORY_ORDER = [
    'general',
    'aws',
    'azure',
    'gcp',
    'k8s',
    'cisco',
    'fabric',
    'd365',
    'power',
    'oci',
    'ui'
  ];

  function formatIconName(id: string): string {
    return id
      .replace(/^(aws|azure|gcp|cisco|k8s|fabric|d365|power|oci)-/, '')
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function toggleAllCategories() {
    if (allExpanded) {
      expandedCategories = new SvelteSet();
      allExpanded = false;
    } else {
      expandedCategories = new SvelteSet(CATEGORY_ORDER);
      allExpanded = true;
    }
  }

  function switchToColorPanel() {
    open = false;
    window.dispatchEvent(
      new CustomEvent('open-color-panel', {
        detail: { type: 'node', id: selectedNodeId }
      })
    );
  }

  function selectIcon(icon: IconEntry) {
    selectedIcon = icon.path;
    applyImgIcon(icon.path, icon.id);
  }

  function applyImgIcon(imgUrl: string) {
    if (!selectedNodeId) {
      const syntax = `@{ img: "${imgUrl}", pos: "b", w: 60, h: 60, constraint: "on" }`;
      navigator.clipboard?.writeText(syntax);
      return;
    }

    isApplying = true;
    const state = get(inputStateStore);
    let code = state.code || '';
    const nodeName = svgIdToNodeName(selectedNodeId);
    code = injectNodeImg(code, nodeName, imgUrl);
    updateCodeStore({ code, updateDiagram: true });

    window.dispatchEvent(
      new CustomEvent('icon-selected', {
        detail: { iconId: imgUrl, nodeName }
      })
    );

    setTimeout(() => {
      isApplying = false;
    }, 600);
  }

  function removeIcon() {
    if (!selectedNodeId) return;
    isApplying = true;
    const state = get(inputStateStore);
    let code = state.code || '';
    const nodeName = svgIdToNodeName(selectedNodeId);
    const iconPattern = new RegExp(
      `(${nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*@\\{\\s*(?:icon|img):\\s*"[^"]*"[^}]*\\}`,
      'g'
    );
    code = code.replace(iconPattern, '$1');
    updateCodeStore({ code, updateDiagram: true });
    selectedIcon = null;
    setTimeout(() => {
      isApplying = false;
    }, 600);
  }

  function handleOpenIconPanel(e?: CustomEvent) {
    open = true;
    if (e?.detail?.nodeId) {
      selectedNodeId = e.detail.nodeId;
    }
    openSource = e?.detail?.source === 'toolbar' ? 'toolbar' : 'sidebar';
  }

  function handleNodeSelected(e: CustomEvent) {
    const id = e.detail?.nodeId || e.detail?.id || null;
    selectedNodeId = id;
  }

  function handleSelectionCleared() {
    selectedNodeId = null;
  }

  // Load icons from index.json
  async function loadIcons() {
    loading = true;
    try {
      const res = await fetch('/icons/index.json');
      if (res.ok) {
        const data = await res.json();
        allIcons = data.icons || [];
      }
    } catch {
      allIcons = [];
    }
    loading = false;
    expandedCategories = new SvelteSet(CATEGORY_ORDER);
    allExpanded = true;
  }

  // Get categories with counts
  let categoryList = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const icon of allIcons) {
      counts[icon.category] = (counts[icon.category] || 0) + 1;
    }
    return CATEGORY_ORDER.filter((c) => counts[c] > 0).map((c) => ({
      id: c,
      label: CATEGORY_LABELS[c] || c,
      count: counts[c] || 0
    }));
  });

  // Filter icons based on search and active category
  let filteredIcons = $derived.by(() => {
    let icons = allIcons;
    if (activeCategory) {
      icons = icons.filter((i) => i.category === activeCategory);
    }
    if (!searchQuery.trim()) return icons;
    const q = searchQuery.toLowerCase();
    return icons.filter(
      (icon) =>
        icon.id.toLowerCase().includes(q) ||
        icon.keywords.some((kw) => kw.toLowerCase().includes(q))
    );
  });

  // Group filtered icons by category
  let groupedIcons = $derived.by(() => {
    const groups: Record<string, IconEntry[]> = {};
    for (const icon of filteredIcons) {
      if (!groups[icon.category]) groups[icon.category] = [];
      groups[icon.category].push(icon);
    }
    return groups;
  });

  function toggleCategory(cat: string) {
    if (expandedCategories.has(cat)) {
      expandedCategories.delete(cat);
    } else {
      expandedCategories.add(cat);
    }
    allExpanded = expandedCategories.size === CATEGORY_ORDER.length;
  }

  onMount(() => {
    window.addEventListener('open-icon-panel', handleOpenIconPanel as EventListener);
    window.addEventListener('node-selected', handleNodeSelected as EventListener);
    window.addEventListener('selection-cleared', handleSelectionCleared as EventListener);
    loadIcons();
  });

  onDestroy(() => {
    window.removeEventListener('open-icon-panel', handleOpenIconPanel as EventListener);
    window.removeEventListener('node-selected', handleNodeSelected as EventListener);
    window.removeEventListener('selection-cleared', handleSelectionCleared as EventListener);
  });
</script>

{#if open}
  <div
    class="absolute z-50 flex w-80 animate-in flex-col rounded-xl border border-border bg-card/95 shadow-[0_4px_24px_var(--dash-card-shadow)] backdrop-blur-sm duration-200 {openSource ===
    'toolbar'
      ? 'bottom-24 left-1/2 h-[55vh] -translate-x-1/2 slide-in-from-bottom-2'
      : 'top-16 right-4 h-[70vh] slide-in-from-right-2'}">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
      <div class="flex items-center gap-2">
        {#if isApplying}
          <Loader2 class="size-3.5 animate-spin text-primary" />
        {:else}
          <Search class="size-3.5 text-primary" />
        {/if}
        <span class="text-xs font-semibold">Icons</span>
        <span class="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground"
          >{allIcons.length}</span>
        {#if selectedNodeId}
          <span
            class="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-medium text-indigo-500">
            {svgIdToNodeName(selectedNodeId)}
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          class="size-6"
          title={allExpanded ? 'Collapse all' : 'Expand all'}
          onclick={toggleAllCategories}>
          {#if allExpanded}<ChevronsDownUp class="size-3" />{:else}<ChevronsUpDown
              class="size-3" />{/if}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="size-6"
          title="Colors"
          onclick={switchToColorPanel}>
          <Palette class="size-3" />
        </Button>
        <Button variant="ghost" size="icon" class="size-6" onclick={() => (open = false)}>
          <X class="size-3" />
        </Button>
      </div>
    </div>

    <!-- Tab switcher: Local / Web -->
    <div class="flex border-b border-border/30">
      <button
        type="button"
        class="flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[10px] font-medium transition-colors {activeTab ===
        'local'
          ? 'border-b-2 border-primary text-primary'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => (activeTab = 'local')}>
        <HardDrive class="size-3" />
        Local
        <span class="rounded bg-muted px-1 py-0.5 text-[8px]">{allIcons.length}</span>
      </button>
      <button
        type="button"
        class="flex flex-1 items-center justify-center gap-1.5 py-1.5 text-[10px] font-medium transition-colors {activeTab ===
        'web'
          ? 'border-b-2 border-primary text-primary'
          : 'text-muted-foreground hover:text-foreground'}"
        onclick={() => (activeTab = 'web')}>
        <Globe class="size-3" />
        Web
        <span class="rounded bg-muted px-1 py-0.5 text-[8px]">200k+</span>
      </button>
    </div>

    {#if activeTab === 'local'}
      <!-- Local: Search -->
      <div class="border-b border-border/30 p-2">
        <div class="relative">
          <Search class="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            bind:value={searchQuery}
            placeholder="Search {allIcons.length}+ local icons..."
            class="h-7 pl-7 text-xs" />
        </div>
      </div>

      <!-- Category filter tabs -->
      <div
        class="scrollbar-thin flex items-center gap-1 overflow-x-auto border-b border-border/30 px-2 py-1">
        <button
          type="button"
          class="shrink-0 rounded-md px-2 py-0.5 text-[9px] font-medium transition-all {activeCategory ===
          null
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
          onclick={() => (activeCategory = null)}>
          All
        </button>
        {#each categoryList as cat (cat.id)}
          <button
            type="button"
            class="shrink-0 rounded-md px-2 py-0.5 text-[9px] font-medium transition-all {activeCategory ===
            cat.id
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
            onclick={() => (activeCategory = activeCategory === cat.id ? null : cat.id)}
            title="{cat.label} ({cat.count})">
            {cat.label.length > 12 ? cat.id.toUpperCase() : cat.label}
            <span class="ml-0.5 text-[8px] opacity-60">{cat.count}</span>
          </button>
        {/each}
      </div>

      <!-- Icon Grid -->
      <div class="scrollbar-thin flex-1 overflow-y-auto p-2">
        {#if loading}
          <div class="flex items-center justify-center py-8">
            <Loader2 class="size-5 animate-spin text-muted-foreground" />
          </div>
        {:else if filteredIcons.length === 0}
          <div class="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Search class="size-6 text-muted-foreground/40" />
            <p class="text-[11px] text-muted-foreground">No icons found for "{searchQuery}"</p>
          </div>
        {:else}
          {#each CATEGORY_ORDER as catId (catId)}
            {#if groupedIcons[catId]?.length}
              <div class="mb-1">
                <button
                  type="button"
                  class="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  onclick={() => toggleCategory(catId)}>
                  {#if expandedCategories.has(catId)}
                    <ChevronDown class="size-3" />
                  {:else}
                    <ChevronRight class="size-3" />
                  {/if}
                  <span>{CATEGORY_LABELS[catId] || catId}</span>
                  <span class="ml-auto text-[9px] text-muted-foreground/60"
                    >{groupedIcons[catId].length}</span>
                </button>

                {#if expandedCategories.has(catId)}
                  <div class="grid grid-cols-5 gap-1 px-1 py-1">
                    {#each groupedIcons[catId] as icon (icon.id)}
                      <button
                        type="button"
                        class="group flex flex-col items-center gap-0.5 rounded-lg border border-transparent p-1 transition-all hover:border-border hover:bg-accent/50 {selectedIcon ===
                        icon.path
                          ? 'border-indigo-500 bg-indigo-500/10'
                          : ''}"
                        title={formatIconName(icon.id)}
                        onclick={() => selectIcon(icon)}>
                        <img
                          src={icon.path}
                          alt={icon.id}
                          class="size-6 object-contain"
                          loading="lazy"
                          onerror={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }} />
                        <span
                          class="max-w-full truncate text-[7px] leading-tight text-muted-foreground group-hover:text-foreground">
                          {formatIconName(icon.id).slice(0, 10)}
                        </span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          {/each}
        {/if}
      </div>
    {:else}
      <!-- Web: Search -->
      <div class="border-b border-border/30 p-2">
        <div class="relative">
          <Globe class="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={webSearchQuery}
            oninput={(e) => handleWebSearchInput((e.target as HTMLInputElement).value)}
            placeholder="Search Iconify (200k+ icons)..."
            class="h-7 pl-7 text-xs" />
        </div>
        <p class="mt-1 text-[8px] text-muted-foreground">
          Powered by <a href="https://iconify.design" target="_blank" class="underline">Iconify</a> —
          logos, devicon, simple-icons, mdi, heroicons & more
        </p>
      </div>

      <!-- Web results grid -->
      <div class="scrollbar-thin flex-1 overflow-y-auto p-2">
        {#if webLoading}
          <div class="flex items-center justify-center py-8">
            <Loader2 class="size-5 animate-spin text-muted-foreground" />
          </div>
        {:else if webResults.length === 0 && webSearchQuery.trim()}
          <div class="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Globe class="size-6 text-muted-foreground/40" />
            <p class="text-[11px] text-muted-foreground">
              No web icons found for "{webSearchQuery}"
            </p>
          </div>
        {:else if webResults.length === 0}
          <div class="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <Globe class="size-6 text-muted-foreground/40" />
            <p class="text-[11px] text-muted-foreground">Type to search 200,000+ icons</p>
            <p class="text-[9px] text-muted-foreground/60">
              logos, devicon, simple-icons, mdi, heroicons, phosphor, tabler...
            </p>
          </div>
        {:else}
          <div class="grid grid-cols-5 gap-1">
            {#each webResults as icon (icon.id)}
              <button
                type="button"
                class="group flex flex-col items-center gap-0.5 rounded-lg border border-transparent p-1 transition-all hover:border-border hover:bg-accent/50 {selectedIcon ===
                icon.url
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : ''}"
                title="{formatWebIconName(icon.name)} ({icon.prefix})"
                onclick={() => selectWebIcon(icon)}>
                <img
                  src={icon.url}
                  alt={icon.name}
                  class="size-6 object-contain"
                  loading="lazy"
                  onerror={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }} />
                <span
                  class="max-w-full truncate text-[7px] leading-tight text-muted-foreground group-hover:text-foreground">
                  {formatWebIconName(icon.name).slice(0, 10)}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Selected icon footer -->
    {#if selectedIcon}
      <div class="border-t border-border/50 p-2">
        <div class="flex items-center gap-2 rounded-md bg-muted/50 p-2">
          <img src={selectedIcon} alt="Selected" class="size-6 object-contain" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[10px] font-medium">{selectedIcon.split('/').pop()}</p>
            <p class="text-[9px] text-muted-foreground">
              {selectedNodeId
                ? `Applied to ${svgIdToNodeName(selectedNodeId)}`
                : 'Copied to clipboard'}
            </p>
          </div>
          {#if selectedNodeId}
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              title="Remove icon from node"
              onclick={removeIcon}>
              <Trash2 class="size-3.5" />
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}
