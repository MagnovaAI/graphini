<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button';
  import { authStore } from '$lib/stores/auth.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import type { DiagramWorkspaceSummary } from '$lib/types/workspace';
  import { cn } from '$lib/util';
  import {
    Plus,
    Search,
    Clock,
    Star,
    MoreHorizontal,
    Folder,
    GitBranch,
    Network,
    Workflow,
    Table2,
    BarChart3,
    Calendar,
    FileText,
    Trash2,
    Copy,
    Loader2,
    LayoutDashboard,
    Share2,
    LogOut,
    User,
    Command
  } from 'lucide-svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import { onMount, onDestroy, type ComponentType } from 'svelte';
  import { fade } from 'svelte/transition';
  import { mode } from 'mode-watcher';
  import mermaid from 'mermaid';

  let mermaidInitialized = false;
  function initMermaid() {
    if (mermaidInitialized) return;
    mermaidInitialized = true;
    mermaid.initialize({
      startOnLoad: false,
      theme: $mode === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit'
    });
  }

  function mermaidPreview(node: HTMLElement, code: string | null) {
    initMermaid();
    let cancelled = false;

    async function renderPreview(source: string | null) {
      node.innerHTML = '';
      if (!source?.trim()) return;

      const originalConsoleError = console.error;
      const originalConsoleWarn = console.warn;
      try {
        console.error = () => {};
        console.warn = () => {};
        await mermaid.parse(source);

        const id = `preview-${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await mermaid.render(id, source);
        if (cancelled) return;
        if (svg.includes('Syntax error in text') || svg.includes('mermaid version')) return;

        node.innerHTML = svg;
        const svgEl = node.querySelector('svg');
        if (svgEl) {
          svgEl.style.maxWidth = '100%';
          svgEl.style.maxHeight = '100%';
          svgEl.style.width = 'auto';
          svgEl.style.height = 'auto';
        }
      } catch {
        node.innerHTML = '';
      } finally {
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
      }
    }

    void renderPreview(code);

    return {
      update(nextCode: string | null) {
        void renderPreview(nextCode);
      },
      destroy() {
        cancelled = true;
      }
    };
  }

  const typeIcons: Record<string, ComponentType> = {
    class: Network,
    default: FileText,
    erd: Table2,
    flowchart: Workflow,
    gantt: Calendar,
    sequence: GitBranch,
    state: BarChart3
  };

  let workspaces = $state<DiagramWorkspaceSummary[]>([]);
  let totalCount = $state(0);
  let loading = $state(true);
  let creating = $state(false);
  let searchQuery = $state('');
  let activeFilter = $state('all');
  let deleteTarget = $state<{ id: string; title: string } | null>(null);
  let deleting = $state(false);
  let createError = $state<string | null>(null);
  let searchTimeout: ReturnType<typeof setTimeout>;
  let mounted = $state(false);
  let searchFocused = $state(false);

  const sidebarItems = [
    { id: 'all', label: 'All Diagrams', icon: LayoutDashboard },
    { id: 'starred', label: 'Starred', icon: Star },
    { id: 'shared', label: 'Shared with me', icon: Share2 }
  ];

  const typeColorsDark: Record<string, { bg: string; border: string; text: string }> = {
    class: { bg: 'rgba(6, 182, 212, 0.06)', border: 'rgba(6, 182, 212, 0.12)', text: '#67e8f9' },
    erd: { bg: 'rgba(59, 130, 246, 0.06)', border: 'rgba(59, 130, 246, 0.12)', text: '#93c5fd' },
    flowchart: {
      bg: 'rgba(139, 92, 246, 0.06)',
      border: 'rgba(139, 92, 246, 0.12)',
      text: '#c4b5fd'
    },
    gantt: { bg: 'rgba(245, 158, 11, 0.06)', border: 'rgba(245, 158, 11, 0.12)', text: '#fcd34d' },
    sequence: {
      bg: 'rgba(16, 185, 129, 0.06)',
      border: 'rgba(16, 185, 129, 0.12)',
      text: '#6ee7b7'
    },
    state: { bg: 'rgba(244, 63, 94, 0.06)', border: 'rgba(244, 63, 94, 0.12)', text: '#fda4af' }
  };

  const typeColorsLight: Record<string, { bg: string; border: string; text: string }> = {
    class: { bg: 'rgba(6, 182, 212, 0.06)', border: 'rgba(6, 182, 212, 0.18)', text: '#0891b2' },
    erd: { bg: 'rgba(59, 130, 246, 0.06)', border: 'rgba(59, 130, 246, 0.18)', text: '#2563eb' },
    flowchart: {
      bg: 'rgba(139, 92, 246, 0.06)',
      border: 'rgba(139, 92, 246, 0.18)',
      text: '#7c3aed'
    },
    gantt: { bg: 'rgba(245, 158, 11, 0.06)', border: 'rgba(245, 158, 11, 0.18)', text: '#d97706' },
    sequence: {
      bg: 'rgba(16, 185, 129, 0.06)',
      border: 'rgba(16, 185, 129, 0.18)',
      text: '#059669'
    },
    state: { bg: 'rgba(244, 63, 94, 0.06)', border: 'rgba(244, 63, 94, 0.18)', text: '#e11d48' }
  };

  const defaultDark = {
    bg: 'rgba(255, 255, 255, 0.02)',
    border: 'rgba(255, 255, 255, 0.06)',
    text: 'rgba(255, 255, 255, 0.4)'
  };

  const defaultLight = {
    bg: 'rgba(0, 0, 0, 0.02)',
    border: 'rgba(0, 0, 0, 0.06)',
    text: 'rgba(0, 0, 0, 0.4)'
  };

  function getTypeStyle(type: string | null) {
    const isDark = $mode === 'dark';
    const colors = isDark ? typeColorsDark : typeColorsLight;
    const fallback = isDark ? defaultDark : defaultLight;
    return colors[type || ''] || fallback;
  }

  async function loadWorkspaces() {
    loading = true;
    const result = await workspaceStore.list({
      starred: activeFilter === 'starred',
      search: searchQuery || undefined
    });
    workspaces = result.workspaces;
    totalCount = result.total;
    loading = false;
  }

  onMount(() => {
    mounted = true;
    authStore.init();
    loadWorkspaces();

    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('.search-input');
        input?.focus();
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    clearTimeout(searchTimeout);
  });

  $effect(() => {
    void activeFilter;
    loadWorkspaces();
  });

  function handleSearchInput(e: Event) {
    searchQuery = (e.target as HTMLInputElement).value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadWorkspaces(), 400);
  }

  function nextUntitledName(): string {
    const prefix = 'Untitled Workspace';
    const existing = new Set(workspaces.map((w) => w.title));
    if (!existing.has(prefix)) return prefix;
    let i = 1;
    while (existing.has(`${prefix} ${i}`)) i++;
    return `${prefix} ${i}`;
  }

  async function handleNewWorkspace() {
    if (creating) return;
    createError = null;
    if (!authStore.isInitialized) await authStore.init();
    if (!authStore.isLoggedIn) {
      authStore.login(window.location.href);
      return;
    }
    creating = true;
    try {
      const ws = await workspaceStore.create(nextUntitledName(), 'mermaid');
      if (ws) {
        await goto(resolve(`/workspace/${ws.id}`));
        return;
      }
      createError = workspaceStore.error || 'Failed to create workspace';
    } finally {
      creating = false;
    }
  }

  async function handleStar(ws: DiagramWorkspaceSummary) {
    const s = !ws.is_starred;
    await workspaceStore.toggleStar(ws.id, s);
    ws.is_starred = s;
    workspaces = [...workspaces];
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    deleting = true;
    await workspaceStore.delete(deleteTarget.id);
    workspaces = workspaces.filter((w) => w.id !== deleteTarget?.id);
    totalCount--;
    deleting = false;
    deleteTarget = null;
  }

  async function handleDuplicate(ws: DiagramWorkspaceSummary) {
    const dup = await workspaceStore.duplicate(ws.id);
    if (dup) loadWorkspaces();
  }

  function formatTime(dateStr: string): string {
    const d = new Date(dateStr);
    const ms = Date.now() - d.getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
  }
</script>

<svelte:head><title>Dashboard — Graphini</title></svelte:head>

{#if deleteTarget}
  <Dialog.Root
    open={!!deleteTarget}
    onOpenChange={(o) => {
      if (!o) deleteTarget = null;
    }}>
    <Dialog.Content class="max-w-sm">
      <Dialog.Header>
        <Dialog.Title class="text-[15px] font-semibold text-foreground"
          >Delete workspace</Dialog.Title>
        <Dialog.Description class="text-[13px] text-muted-foreground">
          Are you sure you want to delete <strong class="text-foreground/80"
            >"{deleteTarget.title}"</strong
          >? This action cannot be undone.
        </Dialog.Description>
      </Dialog.Header>
      <div class="flex justify-end gap-2.5 pt-5">
        <Button variant="outline" size="sm" onclick={() => (deleteTarget = null)}>Cancel</Button>
        <Button variant="destructive" size="sm" disabled={deleting} onclick={confirmDelete}>
          {#if deleting}<Loader2 class="mr-1.5 size-3.5 animate-spin" />{/if}Delete
        </Button>
      </div>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<div class="dash-root">
  <!-- Sidebar -->
  <aside class="dash-sidebar">
    <div class="flex h-full flex-col">
      <div class="sidebar-header">
        <a href={resolve('/')} class="flex items-center gap-2.5">
          <img src="/brand/logo.png" alt="Graphini" class="size-7 rounded-lg" />
          <span class="text-[14px] font-semibold tracking-tight text-foreground/90">Graphini</span>
        </a>
      </div>

      <nav class="flex-1 px-3 py-3">
        <p class="sidebar-label">Workspace</p>
        <div class="space-y-0.5">
          {#each sidebarItems as item (item.id)}
            {@const Icon = item.icon}
            <button
              class={cn('sidebar-nav-item', activeFilter === item.id && 'active')}
              onclick={() => (activeFilter = item.id)}
              aria-label="{item.label} filter">
              <Icon class="size-[15px]" />
              <span class="flex-1 text-left">{item.label}</span>
            </button>
          {/each}
        </div>
      </nav>

      <div class="sidebar-footer">
        {#if authStore.isLoggedIn && authStore.user}
          <div class="flex items-center gap-2.5">
            {#if authStore.user.avatar_url}
              <img
                src={authStore.user.avatar_url}
                alt={authStore.user.display_name || 'User'}
                class="size-8 rounded-full ring-1 ring-border" />
            {:else}
              <div class="user-avatar-badge">
                {(authStore.user.display_name || authStore.user.email || '?')[0].toUpperCase()}
              </div>
            {/if}
            <div class="min-w-0 flex-1">
              <p class="truncate text-[12px] font-medium text-foreground/80">
                {authStore.user.display_name || authStore.user.email}
              </p>
              {#if authStore.user.display_name}
                <p class="truncate text-[10px] text-muted-foreground/60">{authStore.user.email}</p>
              {/if}
            </div>
            <button
              class="sidebar-icon-btn"
              onclick={() => authStore.logout()}
              title="Sign out"
              aria-label="Sign out">
              <LogOut class="size-3.5" />
            </button>
          </div>
        {:else}
          <button class="signin-btn" onclick={() => authStore.login()}>
            <User class="size-3.5" />
            Sign in to save work
          </button>
        {/if}
      </div>
    </div>
  </aside>

  <!-- Main content -->
  <div class="dash-main">
    <!-- Mobile header -->
    <header class="mobile-header md:hidden">
      <span class="text-[13px] font-semibold text-foreground/90">Dashboard</span>
    </header>

    <!-- Mobile filters -->
    <div class="mobile-filters md:hidden">
      {#each sidebarItems as item (item.id)}
        <button
          class={cn('mobile-filter-btn', activeFilter === item.id && 'active')}
          onclick={() => (activeFilter = item.id)}>
          {item.label}
        </button>
      {/each}
    </div>

    <!-- Content area -->
    <div class="content-scroll">
      <div class="mx-auto max-w-[1200px]">
        {#if mounted}
          <div class="content-header" in:fade={{ duration: 150 }}>
            <div class="flex items-center gap-3">
              <h1 class="content-title">
                {activeFilter === 'starred'
                  ? 'Starred'
                  : activeFilter === 'shared'
                    ? 'Shared with me'
                    : 'All Diagrams'}
              </h1>
              <span class="count-badge">{totalCount}</span>
            </div>

            <div class="flex items-center gap-3">
              <div class={cn('search-wrapper', searchFocused && 'focused')}>
                <Search class="search-icon" />
                <input
                  type="text"
                  placeholder="Search diagrams..."
                  class="search-input"
                  value={searchQuery}
                  oninput={handleSearchInput}
                  onfocus={() => (searchFocused = true)}
                  onblur={() => (searchFocused = false)} />
                <kbd class="search-kbd">
                  <Command class="size-2.5" />K
                </kbd>
              </div>
              <button class="new-btn" disabled={creating} onclick={handleNewWorkspace}>
                {#if creating}
                  <Loader2 class="size-4 animate-spin" />
                {:else}
                  <Plus class="size-4" />
                {/if}
                New
              </button>
            </div>
          </div>
        {/if}

        {#if createError}
          <div class="create-error" role="alert" in:fade={{ duration: 150 }}>
            {createError}
          </div>
        {/if}

        <!-- Auth banner -->
        {#if !authStore.isLoggedIn && authStore.isInitialized}
          <div class="auth-banner" in:fade={{ duration: 150 }}>
            <div
              class="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 class="text-[14px] font-semibold text-foreground">Sign in to save your work</h3>
                <p class="mt-1 text-[12px] text-muted-foreground/70">
                  Create an account to save diagrams, star favorites, and access them from anywhere.
                </p>
              </div>
              <button class="new-btn shrink-0" onclick={() => authStore.login()}>Sign in</button>
            </div>
          </div>
        {/if}

        <!-- Loading state -->
        {#if loading}
          <div class="flex flex-1 items-center justify-center py-32">
            <div class="text-center" in:fade={{ duration: 150 }}>
              <div class="loading-spinner mx-auto"></div>
              <p class="mt-4 text-[12px] text-muted-foreground/60">Loading workspaces...</p>
            </div>
          </div>

          <!-- Populated grid -->
        {:else if workspaces.length > 0}
          <div class="card-grid">
            <!-- Workspace cards -->
            {#each workspaces as ws (ws.id)}
              {@const Icon = typeIcons[ws.diagram_type || ''] || typeIcons.default}
              {@const style = getTypeStyle(ws.diagram_type)}
              <div class="ws-card group" in:fade={{ duration: 150 }}>
                <button
                  class="ws-preview"
                  style="background: {style.bg}"
                  onclick={() => goto(resolve(`/workspace/${ws.id}`))}
                  aria-label="Open {ws.title}">
                  {#if ws.mermaid_preview}
                    <div class="ws-preview-mermaid" use:mermaidPreview={ws.mermaid_preview}></div>
                  {:else}
                    <div
                      class="ws-preview-icon"
                      style="background: {style.bg}; border-color: {style.border}; color: {style.text}">
                      <Icon class="size-6" />
                    </div>
                  {/if}
                </button>

                <div class="ws-body">
                  <div class="flex items-start justify-between gap-2">
                    <button class="ws-title" onclick={() => goto(resolve(`/workspace/${ws.id}`))}>
                      {ws.title}
                    </button>
                    <div
                      class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      <button
                        class="ws-action-btn"
                        onclick={() => handleStar(ws)}
                        aria-label={ws.is_starred ? 'Unstar' : 'Star'}>
                        <Star
                          class="size-3.5 {ws.is_starred ? 'fill-amber-400 text-amber-400' : ''}" />
                      </button>
                      <DropdownMenu.Root>
                        <DropdownMenu.Trigger>
                          <button class="ws-action-btn" aria-label="More options">
                            <MoreHorizontal class="size-3.5" />
                          </button>
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content align="end" class="min-w-[160px]">
                          <DropdownMenu.Item onclick={() => handleDuplicate(ws)}>
                            <Copy class="mr-2 size-3.5" />Duplicate
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator />
                          <DropdownMenu.Item
                            class="text-destructive"
                            onclick={() => (deleteTarget = { id: ws.id, title: ws.title })}>
                            <Trash2 class="mr-2 size-3.5" />Delete
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Root>
                    </div>
                  </div>

                  {#if ws.is_starred}
                    <Star
                      class="absolute top-4 right-4 size-3 fill-amber-400 text-amber-400 transition-opacity group-hover:opacity-0" />
                  {/if}

                  <div class="ws-meta">
                    {#if ws.engine === 'mermaid'}
                      <span
                        class="ws-type-badge"
                        style="color: #ff3670; background: rgba(255,54,112,0.08); border-color: rgba(255,54,112,0.15);">
                        Mermaid
                      </span>
                    {/if}
                    {#if ws.diagram_type}
                      <span
                        class="ws-type-badge"
                        style="color: {style.text}; background: {style.bg}; border-color: {style.border}">
                        {ws.diagram_type}
                      </span>
                    {/if}
                    <span class="ws-time">
                      <Clock class="size-3" />
                      {formatTime(ws.updated_at)}
                    </span>
                  </div>
                </div>
              </div>
            {/each}
          </div>

          <!-- Empty state -->
        {:else}
          <div class="empty-state" in:fade={{ duration: 150 }}>
            <div class="empty-icon-wrap">
              <Folder class="size-7 text-muted-foreground/50" />
            </div>
            <h3 class="mt-5 text-[15px] font-semibold text-foreground/80">
              {searchQuery ? 'No matches found' : 'No workspaces yet'}
            </h3>
            <p class="mt-2 max-w-xs text-[12px] leading-relaxed text-muted-foreground/60">
              {searchQuery
                ? 'Try a different search term or clear your filters.'
                : 'Create your first diagram to get started. Describe it in plain English or write Mermaid DSL directly.'}
            </p>
            {#if !searchQuery}
              <button class="new-btn mt-6" disabled={creating} onclick={handleNewWorkspace}>
                <Plus class="size-4" />Create your first diagram
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  @reference "../../app.css";

  /* ── Layout ── */
  .dash-root {
    @apply relative flex min-h-[100dvh];
    background: var(--background);
  }

  /* ── Sidebar ── */
  .dash-sidebar {
    @apply hidden w-[240px] shrink-0 md:block;
    position: relative;
    z-index: 10;
    background: var(--surface-overlay);
    border-right: 1px solid var(--surface-border);
  }

  .sidebar-header {
    @apply flex items-center px-5 py-4;
    border-bottom: 1px solid var(--surface-border);
  }

  .sidebar-label {
    @apply mb-2 px-3 text-[11px] font-medium;
    color: var(--dash-text-faint);
  }

  .sidebar-nav-item {
    @apply flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] font-medium;
    @apply focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none;
    color: var(--dash-text-secondary);
    cursor: pointer;
    transition:
      background 150ms ease,
      color 150ms ease;
  }
  .sidebar-nav-item:hover {
    background: var(--dash-hover-bg);
    color: var(--dash-hover-text);
  }
  .sidebar-nav-item.active {
    background: var(--dash-hover-bg);
    color: var(--foreground);
  }

  .sidebar-footer {
    @apply p-3;
    border-top: 1px solid var(--surface-border);
  }

  .user-avatar-badge {
    @apply flex size-8 items-center justify-center rounded-full text-[11px] font-semibold;
    background: var(--dash-hover-bg);
    color: var(--dash-text-secondary);
    border: 1px solid var(--surface-border);
  }

  .sidebar-icon-btn {
    @apply flex size-7 items-center justify-center rounded-md;
    @apply focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none;
    color: var(--dash-text-faint);
    cursor: pointer;
    transition:
      background 150ms ease,
      color 150ms ease;
  }
  .sidebar-icon-btn:hover {
    background: var(--dash-hover-bg);
    color: var(--dash-hover-text);
  }

  .signin-btn {
    @apply flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium;
    @apply focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none;
    color: var(--dash-text-secondary);
    background: var(--surface-overlay);
    border: 1px solid var(--surface-border);
    cursor: pointer;
    transition:
      background 150ms ease,
      color 150ms ease;
  }
  .signin-btn:hover {
    background: var(--dash-hover-bg);
    color: var(--foreground);
  }

  /* ── Main ── */
  .dash-main {
    @apply relative z-10 flex flex-1 flex-col;
  }

  .content-scroll {
    @apply flex-1 overflow-y-auto px-5 py-7 sm:px-8 md:px-10;
  }

  /* ── Mobile ── */
  .mobile-header {
    @apply flex items-center justify-between border-b px-4 py-3;
    border-color: var(--surface-border);
  }

  .mobile-filters {
    @apply flex items-center gap-2 overflow-x-auto px-4 py-2;
    border-bottom: 1px solid var(--surface-border);
  }

  .mobile-filter-btn {
    @apply shrink-0 rounded-md px-3 py-1.5 text-[11px] font-medium;
    @apply focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none;
    color: var(--dash-text-secondary);
    cursor: pointer;
    transition:
      background 150ms ease,
      color 150ms ease;
  }
  .mobile-filter-btn.active {
    background: var(--dash-hover-bg);
    color: var(--foreground);
  }

  /* ── Content Header ── */
  .content-header {
    @apply mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between;
  }

  .content-title {
    @apply text-xl font-bold tracking-tight text-foreground;
  }

  .count-badge {
    @apply inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums;
    background: var(--surface-border);
    color: var(--dash-text-tertiary);
    min-width: 20px;
  }

  /* ── Search ── */
  .search-wrapper {
    @apply relative flex items-center;
    width: 220px;
    transition: width 150ms ease;
  }
  .search-wrapper.focused {
    width: 280px;
  }

  .search-wrapper :global(.search-icon) {
    @apply absolute left-2.5 size-3.5;
    color: var(--dash-text-faint);
    pointer-events: none;
  }

  .search-input {
    @apply w-full rounded-lg py-2 pr-12 pl-8 text-[12px] outline-none;
    color: var(--foreground);
    background: var(--surface-overlay);
    border: 1px solid var(--surface-border);
    transition: border-color 150ms ease;
  }
  .search-input::placeholder {
    color: var(--dash-text-faint);
  }
  .search-input:focus {
    border-color: var(--foreground);
  }

  .search-kbd {
    @apply absolute right-2 flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-medium;
    color: var(--dash-text-faint);
    background: var(--surface-overlay);
    border: 1px solid var(--surface-border);
    pointer-events: none;
  }

  /* ── Primary Button ── */
  .new-btn {
    @apply inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-semibold;
    @apply focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none;
    color: var(--primary-foreground);
    background: var(--foreground);
    cursor: pointer;
    transition: opacity 150ms ease;
  }
  .new-btn:hover {
    opacity: 0.85;
  }

  .new-btn:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  .create-error {
    @apply mb-5 rounded-lg px-3 py-2 text-[12px] font-medium text-red-500;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.18);
  }

  /* ── Auth Banner ── */
  .auth-banner {
    @apply mb-7 rounded-lg p-5;
    background: var(--surface-overlay);
    border: 1px solid var(--surface-border);
  }

  /* ── Card Grid ── */
  .card-grid {
    @apply grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4;
  }

  /* ── Workspace Card ── */
  .ws-card {
    @apply relative flex min-h-[200px] flex-col rounded-xl;
    background: var(--surface-overlay);
    border: 1px solid var(--surface-border);
    transition:
      border-color 150ms ease,
      box-shadow 150ms ease;
  }
  .ws-card:hover {
    border-color: var(--dash-text-faint);
    box-shadow: 0 2px 8px var(--dash-card-shadow);
  }

  .ws-preview {
    @apply relative flex h-[100px] w-full items-center justify-center overflow-hidden rounded-t-xl;
    border-bottom: 1px solid var(--surface-border);
    cursor: pointer;
  }

  .ws-preview-mermaid {
    @apply flex size-full items-center justify-center overflow-hidden p-2;
    opacity: 0.7;
    pointer-events: none;
  }
  .ws-preview-mermaid :global(svg) {
    max-width: 100%;
    max-height: 100%;
  }

  .ws-preview-icon {
    @apply flex size-12 items-center justify-center rounded-xl;
    border: 1px solid;
    position: relative;
    z-index: 1;
  }

  .ws-body {
    @apply relative flex flex-1 flex-col p-3.5;
  }

  .ws-title {
    @apply text-left text-[12px] leading-snug font-medium;
    @apply focus-visible:outline-none;
    color: var(--dash-text-primary);
    cursor: pointer;
    transition: color 150ms ease;
  }
  .ws-title:hover,
  .ws-title:focus-visible {
    color: var(--foreground);
  }

  .ws-action-btn {
    @apply flex size-6 items-center justify-center rounded-md;
    @apply focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none;
    color: var(--dash-text-tertiary);
    cursor: pointer;
    transition:
      background 150ms ease,
      color 150ms ease;
  }
  .ws-action-btn:hover {
    background: var(--dash-hover-bg);
    color: var(--dash-hover-text);
  }

  .ws-meta {
    @apply mt-auto flex items-center gap-2 pt-3;
  }

  .ws-type-badge {
    @apply rounded-md px-1.5 py-0.5 text-[9px] font-semibold tracking-wide capitalize;
    border: 1px solid;
  }

  .ws-time {
    @apply flex items-center gap-1 text-[10px];
    color: var(--dash-text-tertiary);
  }

  /* ── Empty State ── */
  .empty-state {
    @apply flex flex-col items-center justify-center py-28 text-center;
  }

  .empty-icon-wrap {
    @apply flex size-14 items-center justify-center rounded-xl;
    background: var(--surface-overlay);
    border: 1px solid var(--surface-border);
  }

  /* ── Loading ── */
  .loading-spinner {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid var(--surface-border);
    border-top-color: var(--foreground);
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
