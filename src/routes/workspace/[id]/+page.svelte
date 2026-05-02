<script lang="ts">
  import { PanZoomState } from '$/features/diagram/panZoom';
  import {
    inputStateStore,
    setLayout,
    stateStore,
    updateCodeStore,
    type LayoutOption
  } from '$/util/state/state';
  import { logEvent } from '$/util/stats';
  import { initHandler } from '$/util/util';
  import ColorPanel from '$lib/components/canvas/ColorPanel.svelte';
  import ElementToolbar from '$lib/components/canvas/ElementToolbar.svelte';
  import IconPanel from '$lib/components/canvas/IconPanel.svelte';
  import Editor from '$lib/features/editor/components/Editor.svelte';
  import StructuredGraphView from '$lib/components/layout/StructuredGraphView.svelte';
  import { View } from '$lib/components/layout';
  import { ChatPanel, DocumentPanel, PanelResizeHandle } from '$lib/components/panels';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import Chat from '$lib/features/chat/components/Chat.simple.svelte';
  import { authStore } from '$lib/stores/auth.svelte';
  import type { DiagramEngine } from '$lib/types/workspace';
  // autosave replaced by workspace auto-save
  import { conversationsStore } from '$lib/stores/conversations.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { kv } from '$lib/stores/kvStore.svelte';
  import { panels, type PanelId } from '$lib/stores/panels.svelte';
  import { cn } from '$lib/utils';
  import {
    AlertCircle,
    ArrowLeft,
    Braces,
    Code2,
    FileCode2,
    FileText,
    GitBranch,
    Grid2x2,
    Layers,
    Loader2 as Loader2Spin,
    LogOut,
    Maximize2,
    MessageSquare,
    Network,
    PanelLeftClose,
    Plus,
    Scan,
    Settings,
    Trash2,
    UserCircle,
    Workflow,
    ZoomIn,
    ZoomOut
  } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { get } from 'svelte/store';

  const panZoomState = new PanZoomState();

  // Workspace loading from route param
  let wsLoading = $state(true);
  let wsError = $state<string | null>(null);

  let width = $state(0);
  let isMobile = $derived(width < 640);

  function loadUIState<T>(key: string, fallback: T): T {
    try {
      const v = kv.get<T>('ui', `graphini_ui_${key}`);
      if (v !== null && v !== undefined) {
        const parsed = v;
        // Validate parsed value matches expected type of fallback
        if (typeof parsed === typeof fallback || (fallback === null && parsed !== undefined)) {
          return parsed as T;
        }
      }
    } catch {
      // Remove corrupted data
      try {
        kv.delete('ui', `graphini_ui_${key}`);
      } catch {
        // ignore
      }
    }
    return fallback;
  }
  function saveUIState(key: string, value: unknown) {
    try {
      kv.set('ui', `graphini_ui_${key}`, value);
    } catch {
      // ignore
    }
  }

  // Panel icon map for toggle buttons
  const panelIcons: Record<PanelId, typeof Layers> = {
    canvas: Layers,
    chat: MessageSquare,
    code: Code2,
    document: FileText
  };
  const workspacePanelIds: PanelId[] = ['code', 'canvas'];

  // Modal states
  let isSettingsModalOpen = $state(false);
  let isShortcutsModalOpen = $state(false);
  let isWorkspaceSidebarCollapsed = $state(loadUIState('workspaceSidebarCollapsed', false));

  // Canvas panel states
  let isColorPanelOpen = $state(false);
  let isIconPanelOpen = $state(false);

  // Panel resize helper
  function handlePanelResize(panelId: PanelId, delta: number) {
    const currentWidth = panels.panels[panelId].width;
    panels.setWidth(panelId, currentWidth + delta);
  }

  // Toolbar state
  let currentLayout: LayoutOption = $state('dagre');
  let activeTool = $state<'select' | 'pan' | 'draw'>(loadUIState('activeTool', 'select'));
  let isGridVisible = $state(loadUIState('gridVisible', false));
  let isRoughMode = $state(loadUIState('roughMode', false));
  let zoomLevel = $state(100);

  const activeDiagramEngine = $derived(workspaceStore.workspace?.document?.engine ?? 'mermaid');
  const isMermaidDiagram = $derived(activeDiagramEngine === 'mermaid');
  const isMarkdownDocument = $derived(activeDiagramEngine === 'markdown');
  const isDocumentPanelRenderable = $derived(isMarkdownDocument);
  const hasMandatoryFileViewer = $derived(
    activeDiagramEngine === 'mermaid' ||
      activeDiagramEngine === 'markdown' ||
      activeDiagramEngine === 'json' ||
      activeDiagramEngine === 'yaml'
  );
  let isViewRendering = $state(false);
  let viewRenderError = $state('');
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let selectedElementLabel = $state<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let selectedElementNodeName = $state<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let selectedElementType = $state<'node' | 'edge' | null>(null);

  // Persist toolbar UI state
  let uiSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const _at = activeTool;
    const _gv = isGridVisible;
    const _rm = isRoughMode;
    if (uiSaveTimeout) clearTimeout(uiSaveTimeout);
    uiSaveTimeout = setTimeout(() => {
      saveUIState('activeTool', _at);
      saveUIState('gridVisible', _gv);
      saveUIState('roughMode', _rm);
    }, 300);
  });

  const unsubscribe = (
    inputStateStore as unknown as { subscribe: (cb: (s: unknown) => void) => () => void }
  ).subscribe((state: unknown) => {
    try {
      const config = JSON.parse(state.mermaid);
      currentLayout = config.layout === 'elk' ? 'elk' : 'dagre';
    } catch {
      currentLayout = 'dagre';
    }
  });

  const setupPanZoomObserver = () => {
    panZoomState.onPanZoomChange = (pan, zoom) => {
      updateCodeStore({ pan, zoom });
      zoomLevel = Math.round(zoom * 100);
      logEvent('panZoom');
    };
  };

  // Auth guard: redirect to login only after fetchMe() has fully completed
  // and confirmed no user. No-op when DEV_BYPASS_AUTH is active (server returns user).
  // Guard prevents redirect loops — only redirect once per page load.
  let hasAttemptedRedirect = false;
  $effect(() => {
    if (
      authStore.isInitialized &&
      !authStore.isLoading &&
      !authStore.isLoggedIn &&
      !hasAttemptedRedirect
    ) {
      hasAttemptedRedirect = true;
      authStore.login();
    }
  });

  onMount(() => {
    panels.setWorkspaceOrder();
    panels.show('chat');
    panels.show('code');
    panels.hide('canvas');
    panels.hide('document');

    // Load workspace from route param — always reload if ID changed
    const workspaceId = $page.params.id;
    const currentId = workspaceStore.workspace?.id;
    if (workspaceId && workspaceId !== currentId) {
      if (currentId) workspaceStore.unload();
      workspaceStore.load(workspaceId).then((success) => {
        if (!success) {
          wsError = workspaceStore.state.error || 'Failed to load workspace';
        }
        wsLoading = false;
      });
    } else {
      wsLoading = false;
    }

    setupPanZoomObserver();

    const setup = async () => {
      await initHandler();
      if (authStore.isLoggedIn) await conversationsStore.fetch();
      window.addEventListener('appinstalled', () => logEvent('pwaInstalled', { isMobile }));
    };
    setup();

    const handleNodeSelected = (e: CustomEvent) => {
      const rawId = e.detail.nodeId || '';
      selectedElementNodeName =
        rawId
          .replace(/^flowchart-/, '')
          .replace(/^stateDiagram-/, '')
          .replace(/^classDiagram-/, '')
          .replace(/-\d+$/, '') || null;
      selectedElementLabel = e.detail.label || 'Node';
      selectedElementType = 'node';
    };
    const handleEdgeSelected = (e: CustomEvent) => {
      selectedElementLabel = e.detail.label || 'Edge';
      selectedElementType = 'edge';
    };
    const handleElementSelected = (e: CustomEvent) => {
      const detail = e.detail;
      const eType = detail.elementType;
      selectedElementLabel = detail.label || '';
      selectedElementNodeName = detail.nodeId
        ? detail.nodeId
            .replace(/^flowchart-/, '')
            .replace(/^stateDiagram-/, '')
            .replace(/^classDiagram-/, '')
            .replace(/-\d+$/, '')
        : null;
      if (eType === 'node' || eType === 'icon' || eType === 'subgraph') {
        selectedElementType = 'node';
      } else if (eType === 'edge') {
        selectedElementType = 'edge';
      }
    };
    const handleSelectionCleared = () => {
      selectedElementLabel = null;
      selectedElementNodeName = null;
      selectedElementType = null;
    };
    window.addEventListener('node-selected', handleNodeSelected as EventListener);
    window.addEventListener('edge-selected', handleEdgeSelected as EventListener);
    window.addEventListener('element-selected', handleElementSelected as EventListener);
    window.addEventListener('selection-cleared', handleSelectionCleared as EventListener);

    const handleConversationCreated = async (e: CustomEvent) => {
      if (authStore.isLoggedIn) await conversationsStore.create(e.detail?.title || 'New Chat');
    };
    window.addEventListener('conversation-created', handleConversationCreated as EventListener);

    const handleOpenAuthModal = () => {
      authStore.login();
    };
    window.addEventListener('open-auth-modal', handleOpenAuthModal);

    // Workspace-based: no need to auto-create files; workspace is loaded by /workspace/[id]

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDelete();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleExport();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleImport();
      }
      if (e.key === 'v' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleToolSelect('select');
      }
      if (e.key === 'p' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleToolSelect('pan');
      }
      if (e.key === 'd' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleToolSelect('draw');
      }
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        handleAddNode();
      }
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleGrid();
      }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleRoughMode();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        panZoomState.zoomIn();
        zoomLevel = Math.min(400, zoomLevel + 10);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        panZoomState.zoomOut();
        zoomLevel = Math.max(25, zoomLevel - 10);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        panZoomState.reset();
        zoomLevel = 100;
      }
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        isShortcutsModalOpen = !isShortcutsModalOpen;
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unsubscribe();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('node-selected', handleNodeSelected as EventListener);
      window.removeEventListener('edge-selected', handleEdgeSelected as EventListener);
      window.removeEventListener('element-selected', handleElementSelected as EventListener);
      window.removeEventListener('selection-cleared', handleSelectionCleared as EventListener);
      window.removeEventListener(
        'conversation-created',
        handleConversationCreated as EventListener
      );
      window.removeEventListener('open-auth-modal', handleOpenAuthModal);
    };
  });

  let chatComponent = $state<Chat | undefined>(undefined);

  const handleToolSelect = (tool: 'select' | 'pan' | 'draw') => {
    activeTool = tool;
    window.dispatchEvent(new CustomEvent('tool-changed', { detail: { tool } }));
  };

  const handleAddNode = (shapeSyntax?: readonly [string, string]) => {
    const code = get(inputStateStore).code || '';
    const lines = code.split('\n');
    // Generate a unique node ID
    const existingIds = new SvelteSet<string>();
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_]\w*)\s*[([{<>@]/);
      if (m) existingIds.add(m[1]);
    }
    let nodeId = 'NewNode';
    let counter = 1;
    while (existingIds.has(nodeId)) {
      nodeId = `NewNode${counter++}`;
    }
    // Use provided shape syntax or default to rectangle []
    const open = shapeSyntax?.[0] ?? '[';
    const close = shapeSyntax?.[1] ?? ']';
    const newLine = `    ${nodeId}${open}New Node${close}`;
    const newCode = code.trimEnd() + '\n' + newLine + '\n';
    updateCodeStore({ code: newCode, updateDiagram: true });
  };

  const handleDelete = () => window.dispatchEvent(new CustomEvent('delete-selected'));

  const handleExport = () => {
    const svgElement = document.querySelector('#graph-div');
    if (svgElement) {
      const clone = svgElement.cloneNode(true) as Element;
      clone.querySelectorAll('.graphini-selection-rect').forEach((el) => el.remove());
      clone
        .querySelectorAll('.graphini-selected')
        .forEach((el) => el.classList.remove('graphini-selected'));
      const svgData = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([svgData], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const wsTitle = workspaceStore.workspace?.title;
      a.download = `${wsTitle || 'diagram'}.svg`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mmd,.mermaid,.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => updateCodeStore({ code: ev.target?.result as string });
        reader.readAsText(file);
      }
    };
    input.click();
  };

  // Layout dropdown state
  let showLayoutDropdown = $state(false);

  const handleLayoutChange = (layout: LayoutOption) => {
    currentLayout = layout;
    setLayout(layout);
    showLayoutDropdown = false;
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };

  const zoomIn = () => {
    panZoomState.zoomIn();
    zoomLevel = Math.min(400, zoomLevel + 10);
  };

  const zoomOut = () => {
    panZoomState.zoomOut();
    zoomLevel = Math.max(25, zoomLevel - 10);
  };

  const resetView = () => {
    panZoomState.reset();
    zoomLevel = 100;
  };

  let gridStyle = $state<'dots' | 'squares'>('dots');
  const cycleGrid = () => {
    if (!isGridVisible) {
      // Off → dots
      isGridVisible = true;
      gridStyle = 'dots';
    } else if (gridStyle === 'dots') {
      // dots → squares
      gridStyle = 'squares';
    } else {
      // squares → off
      isGridVisible = false;
    }
    window.dispatchEvent(
      new CustomEvent('grid-toggle', { detail: { visible: isGridVisible, style: gridStyle } })
    );
  };
  const toggleGrid = cycleGrid;
  const toggleRoughMode = () => {
    isRoughMode = !isRoughMode;
    window.dispatchEvent(
      new CustomEvent('rough-mode-toggle', { detail: { enabled: isRoughMode } })
    );
  };

  const handleSendChatMessage = async (
    message: string,
    options?: { isRepair?: boolean }
  ): Promise<boolean> => {
    if (chatComponent) return await chatComponent.sendMessageExternal(message, options);
    return false;
  };

  // Workspace-based: file creation handled by workspace store
  async function ensureFileExists() {
    // No-op: workspace handles persistence
  }

  interface WorkspaceTab {
    engine: DiagramEngine;
    id: string;
    title: string;
  }
  const workspaceTabs = $derived(workspaceStore.diagrams as WorkspaceTab[]);
  const activeWorkspaceId = $derived(workspaceStore.activeDiagramId || '');
  const activeDiagramTitle = $derived(
    workspaceTabs.find((tab) => tab.id === activeWorkspaceId)?.title || 'Untitled'
  );

  $effect(() => {
    const name = workspaceStore.workspace?.title || 'Untitled';
    document.title = `${name} — Graphini`;
  });

  function toggleWorkspaceSidebar() {
    isWorkspaceSidebarCollapsed = !isWorkspaceSidebarCollapsed;
    saveUIState('workspaceSidebarCollapsed', isWorkspaceSidebarCollapsed);
  }

  async function handleNewWorkspace(engine: DiagramEngine, title: string) {
    workspaceStore.addDiagram(engine, title);
  }

  function showChatPanel() {
    panels.toggle('chat');
  }

  function showCodePanel() {
    panels.show('code');
    panels.hide('canvas');
    panels.hide('document');
  }

  function showPreviewPanel() {
    panels.show('canvas');
    panels.hide('code');
    panels.hide('document');
  }

  async function startNewChat() {
    conversationsStore.setActive(null);
    panels.show('chat');
    await chatComponent?.newChat();
  }

  async function selectConversation(id: string) {
    conversationsStore.setActive(id);
    panels.show('chat');
    await chatComponent?.loadConversation(id);
  }

  async function deleteConversation(id: string) {
    const wasActive = conversationsStore.activeId === id;
    await conversationsStore.delete(id);
    window.dispatchEvent(new CustomEvent('conversation-deleted', { detail: { id, wasActive } }));
    if (wasActive) {
      await startNewChat();
    }
  }

  $effect(() => {
    if (isDocumentPanelRenderable && panels.panels.document.visible) return;
    if (!isDocumentPanelRenderable && panels.panels.document.visible) {
      panels.hide('document');
    }
  });

  $effect(() => {
    if (hasMandatoryFileViewer && !panels.panels.canvas.visible && !panels.panels.code.visible) {
      panels.show('canvas');
    }
  });
</script>

{#if !authStore.isInitialized || authStore.isLoading || wsLoading}
  <div class="flex h-screen items-center justify-center bg-background">
    <div class="flex flex-col items-center gap-3 text-muted-foreground">
      <Loader2Spin class="size-6 animate-spin text-primary" />
      <span class="text-[13px]">Loading workspace...</span>
    </div>
  </div>
{:else if wsError}
  <div class="flex h-screen items-center justify-center bg-background">
    <div class="text-center">
      <div
        class="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl"
        style="background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.15);">
        <AlertCircle class="size-6 text-red-400" />
      </div>
      <h2 class="text-base font-semibold text-foreground">Couldn't load workspace</h2>
      <p class="mt-2 max-w-xs text-[13px] text-muted-foreground/70">{wsError}</p>
      <button
        class="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-all hover:bg-primary/90"
        onclick={() => goto(resolve('/app'))}>
        <ArrowLeft class="size-3.5" />
        Back to App
      </button>
    </div>
  </div>
{:else if authStore.isLoggedIn}
  <div class="flex h-screen overflow-hidden bg-background" bind:clientWidth={width}>
    <aside
      class="workspace-sidebar {isWorkspaceSidebarCollapsed ? 'collapsed' : ''}"
      aria-label="Workspace sidebar">
      <div class="sidebar-top">
        <div class="sidebar-header-row">
          {#if isWorkspaceSidebarCollapsed}
            <button
              type="button"
              class="sidebar-logo-button"
              aria-label="Expand sidebar"
              title="Expand sidebar"
              onclick={toggleWorkspaceSidebar}>
              <img src="/brand/logo.png" alt="" class="size-7" />
            </button>
          {:else}
            <a href={resolve('/app')} class="brand-lockup" aria-label="Back to app">
              <img src="/brand/logo.png" alt="" class="size-7 shrink-0" />
              <span>Graphini</span>
            </a>
            <button
              type="button"
              class="sidebar-icon-action"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              onclick={toggleWorkspaceSidebar}>
              <PanelLeftClose class="size-4" />
            </button>
          {/if}
        </div>

        <div class="sidebar-primary-actions">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class="sidebar-new-button {isWorkspaceSidebarCollapsed ? 'compact' : ''}"
              aria-label="New"
              title="New">
              <Plus class="size-3.5 shrink-0" />
              {#if !isWorkspaceSidebarCollapsed}
                <span>New</span>
              {/if}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              align="start"
              side={isWorkspaceSidebarCollapsed ? 'right' : 'bottom'}
              sideOffset={8}
              class="sidebar-create-menu">
              <DropdownMenu.Item class="sidebar-create-item" onclick={startNewChat}>
                <MessageSquare class="size-4" />
                <span>New Chat</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                class="sidebar-create-item"
                onclick={() => handleNewWorkspace('mermaid', 'Untitled Mermaid')}>
                <Workflow class="size-4" />
                <span>Mermaid</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="sidebar-create-item"
                onclick={() => handleNewWorkspace('markdown', 'Untitled Markdown')}>
                <FileText class="size-4" />
                <span>Markdown</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="sidebar-create-item"
                onclick={() => handleNewWorkspace('json', 'Untitled JSON')}>
                <Braces class="size-4" />
                <span>JSON</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="sidebar-create-item"
                onclick={() => handleNewWorkspace('yaml', 'Untitled YAML')}>
                <FileCode2 class="size-4" />
                <span>YAML</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>

          <button
            type="button"
            class="panel-tab sidebar-chat-tab {isWorkspaceSidebarCollapsed ? 'compact' : ''} {panels
              .panels.chat.visible
              ? 'active'
              : ''}"
            aria-pressed={panels.panels.chat.visible}
            title="Chat"
            onclick={showChatPanel}>
            <MessageSquare class="size-3.5 shrink-0" />
            {#if !isWorkspaceSidebarCollapsed}
              <span>Chat</span>
            {/if}
          </button>

          <div class="sidebar-panel-toggles" aria-label="Workspace panels">
            {#each workspacePanelIds as panelId (panelId)}
              {@const Icon = panelIcons[panelId]}
              {@const panelConfig = panels.panels}
              {@const isActive = panelConfig[panelId].visible}
              {@const label = panelConfig[panelId].label}
              <button
                type="button"
                class="panel-tab {isWorkspaceSidebarCollapsed ? 'compact' : ''} {isActive
                  ? 'active'
                  : ''}"
                aria-pressed={isActive}
                title={label}
                onclick={() => (panelId === 'code' ? showCodePanel() : showPreviewPanel())}>
                <Icon class="size-3.5 shrink-0" />
                {#if !isWorkspaceSidebarCollapsed}
                  <span>{label}</span>
                {/if}
              </button>
            {/each}
          </div>
        </div>
      </div>

      {#if !isWorkspaceSidebarCollapsed}
        <div class="conversation-list" aria-label="Chats">
          {#if conversationsStore.isLoading}
            <div class="conversation-empty">Loading chats...</div>
          {:else if !authStore.isLoggedIn}
            <div class="conversation-empty">Sign in to save chats</div>
          {:else if conversationsStore.list.length === 0}
            <div class="conversation-empty">No chats yet</div>
          {:else}
            {#each conversationsStore.list as conv (conv.id)}
              <div
                class="conversation-item {conv.id === conversationsStore.activeId ? 'active' : ''}">
                <button
                  type="button"
                  class="conversation-select"
                  title={conv.title || 'Untitled chat'}
                  onclick={() => selectConversation(conv.id)}>
                  {conv.title || 'Untitled chat'}
                </button>
                <button
                  type="button"
                  class="conversation-delete"
                  aria-label="Delete chat"
                  title="Delete chat"
                  onclick={() => deleteConversation(conv.id)}>
                  <Trash2 class="size-3.5" />
                </button>
              </div>
            {/each}
          {/if}
        </div>
      {/if}

      <div class="sidebar-footer-row">
        <button
          type="button"
          class="sidebar-footer-button"
          title="Settings"
          onclick={() => (isSettingsModalOpen = true)}>
          <Settings class="size-4 shrink-0" />
          {#if !isWorkspaceSidebarCollapsed}
            <span>Settings</span>
          {/if}
        </button>
        {#if authStore.isLoggedIn}
          {@const initials = (authStore.user?.display_name || authStore.user?.email || 'U')
            .split(' ')
            .map((w) => w[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger class="sidebar-footer-button" title="Account">
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {initials}
              </span>
              {#if !isWorkspaceSidebarCollapsed}
                <span class="min-w-0 flex-1 truncate text-left">
                  {authStore.user?.display_name || authStore.user?.email || 'User'}
                </span>
              {/if}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              align="start"
              side="right"
              sideOffset={8}
              class="sidebar-account-menu">
              <DropdownMenu.Label class="flex flex-col gap-0.5">
                <span class="text-sm font-medium">{authStore.user?.display_name || 'User'}</span>
                <span class="text-xs font-normal text-muted-foreground"
                  >{authStore.user?.email}</span>
              </DropdownMenu.Label>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                class="sidebar-create-item"
                onclick={() => {
                  isSettingsModalOpen = true;
                }}>
                <Settings class="size-4" /><span>Settings</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                class="sidebar-create-item text-red-500 focus:text-red-500"
                onclick={() => authStore.logout()}>
                <LogOut class="size-4" /><span>Sign out</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {:else}
          <button
            type="button"
            class="sidebar-footer-button"
            title="Sign in"
            onclick={() => authStore.login()}>
            <UserCircle class="size-4 shrink-0" />
            {#if !isWorkspaceSidebarCollapsed}
              <span>Sign in</span>
            {/if}
          </button>
        {/if}
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 overflow-hidden">
      <!-- ═══ MAIN CONTENT: DYNAMIC PANEL LAYOUT ═══ -->
      <div class="flex flex-1 overflow-hidden" role="main">
        {#each panels.order as panelId (panelId)}
          {#if panels.panels[panelId].visible || panelId === 'chat'}
            {#if panelId === 'canvas'}
              <div class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
                <!-- Diagram View -->
                <div class="relative flex-1 overflow-hidden">
                  {#if isMermaidDiagram}
                    <View
                      {panZoomState}
                      shouldShowGrid={isGridVisible}
                      {gridStyle}
                      bind:isRendering={isViewRendering}
                      bind:renderError={viewRenderError} />
                  {:else if isMarkdownDocument}
                    <div class="h-full overflow-auto bg-background p-8">
                      <article
                        class="mx-auto min-h-full max-w-3xl rounded-2xl border border-border bg-card p-8 shadow-sm">
                        <div class="mb-5 flex items-center gap-2 border-b border-border pb-3">
                          <FileText class="size-4 text-muted-foreground" />
                          <span class="text-sm font-semibold text-foreground"
                            >{activeDiagramTitle}</span>
                          <span
                            class="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                            >Markdown</span>
                        </div>
                        <pre
                          class="font-sans text-sm leading-7 whitespace-pre-wrap text-foreground/90">{$inputStateStore.code ||
                            'Start writing in the Code panel.'}</pre>
                      </article>
                    </div>
                  {:else}
                    <StructuredGraphView
                      engine={activeDiagramEngine}
                      {panZoomState}
                      shouldShowGrid={isGridVisible}
                      {gridStyle}
                      title={activeDiagramTitle}
                      source={$inputStateStore.code || ''} />
                  {/if}
                  {#if !isMarkdownDocument}
                    <div class="canvas-bottom-toolbar">
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-8 {isGridVisible ? 'active' : ''}"
                        title={isGridVisible
                          ? gridStyle === 'dots'
                            ? 'Grid: dots'
                            : 'Grid: squares'
                          : 'Grid: off'}
                        onclick={toggleGrid}><Grid2x2 class="size-4" /></Button>
                      {#if isMermaidDiagram}
                        <div class="relative">
                          <Button
                            variant="ghost"
                            size="icon"
                            class="toolbar-btn active size-8"
                            title="Layout Options"
                            onclick={() => (showLayoutDropdown = !showLayoutDropdown)}>
                            <Workflow class="size-4" />
                          </Button>
                          {#if showLayoutDropdown}
                            <div class="layout-menu">
                              <button
                                type="button"
                                class={cn(
                                  'layout-menu-item',
                                  currentLayout === 'dagre' && 'active'
                                )}
                                onclick={() => handleLayoutChange('dagre')}>
                                <GitBranch class="size-3" />
                                Dagre
                              </button>
                              <button
                                type="button"
                                class={cn('layout-menu-item', currentLayout === 'elk' && 'active')}
                                onclick={() => handleLayoutChange('elk')}>
                                <Network class="size-3" />
                                ELK
                              </button>
                            </div>
                          {/if}
                        </div>
                      {/if}
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-8"
                        title="Fullscreen"
                        onclick={toggleFullscreen}><Maximize2 class="size-4" /></Button>
                      <div class="toolbar-separator"></div>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-8"
                        title="Zoom In"
                        onclick={zoomIn}><ZoomIn class="size-4" /></Button>
                      <div class="toolbar-zoom-label">{zoomLevel}%</div>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-8"
                        title="Zoom Out"
                        onclick={zoomOut}><ZoomOut class="size-4" /></Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-8"
                        title="Reset View"
                        onclick={resetView}><Scan class="size-4" /></Button>
                    </div>
                  {/if}
                  <ColorPanel bind:open={isColorPanelOpen} />
                  <IconPanel bind:open={isIconPanelOpen} />
                  <ElementToolbar />

                  <!-- Minimal render status indicator (top-right) -->
                  <div class="absolute top-3 right-3 z-20">
                    {#if isMermaidDiagram && viewRenderError}
                      <button
                        type="button"
                        class="flex cursor-pointer items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 transition-colors hover:bg-red-500/25"
                        title="Click to auto-fix: {viewRenderError}"
                        onclick={async () => {
                          const msg = `Please fix this Mermaid error: "${viewRenderError}"`;
                          await handleSendChatMessage(msg, { isRepair: true });
                        }}>
                        <span class="size-2 rounded-full bg-red-500"></span>
                        <span
                          class="max-w-[120px] truncate text-[10px] font-medium text-red-600 dark:text-red-400"
                          >Error</span>
                      </button>
                    {:else if isViewRendering}
                      <div class="rounded-full bg-amber-500/15 p-1.5" title="Rendering…">
                        <span class="block size-2 animate-pulse rounded-full bg-amber-500"></span>
                      </div>
                    {:else}
                      <div class="rounded-full bg-emerald-500/15 p-1.5" title="Ready">
                        <span class="block size-2 rounded-full bg-emerald-500"></span>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            {:else if panelId === 'document'}
              {#if isDocumentPanelRenderable}
                <div
                  class="relative min-w-0 overflow-hidden border-l border-border"
                  style="{panels.panels.canvas.visible
                    ? `width: ${panels.panels.document.width}px;`
                    : ''} min-width: {panels.panels.document.minWidth}px; flex: {!panels.panels
                    .canvas.visible
                    ? '1 1 0%'
                    : '0 0 auto'};">
                  <PanelResizeHandle
                    position="left"
                    onResize={(delta) => handlePanelResize('document', delta)} />
                  <DocumentPanel />
                </div>
              {/if}
            {:else if panelId === 'code'}
              <div
                class="relative min-w-0 overflow-hidden border-l border-border"
                style="{panels.panels.canvas.visible
                  ? `width: ${panels.panels.code.width}px;`
                  : ''} min-width: {panels.panels.code.minWidth}px; flex: {!panels.panels.canvas
                  .visible
                  ? '1 1 0%'
                  : '0 0 auto'};">
                <PanelResizeHandle
                  position="left"
                  onResize={(delta) => handlePanelResize('code', delta)} />
                <div class="flex h-full flex-col bg-card">
                  <div
                    class="flex h-10 items-center justify-between gap-1.5 border-b border-border px-3">
                    <div class="flex items-center gap-1.5">
                      <Code2 class="size-4 text-muted-foreground" />
                      <span class="text-xs font-semibold text-foreground">Code</span>
                      <span class="text-[10px] text-muted-foreground">
                        {#if !isMermaidDiagram}
                          {activeDiagramEngine}
                        {:else}
                          {$stateStore.editorMode === 'config' ? 'config' : 'mermaid'}
                        {/if}
                      </span>
                    </div>
                    {#if isMermaidDiagram}
                      <div class="flex items-center gap-1">
                        <button
                          type="button"
                          class="flex h-6 items-center gap-1 rounded-md border border-border bg-background px-2 text-[10px] font-medium transition-colors hover:bg-muted/50"
                          onclick={() => {
                            const currentMode = $stateStore.editorMode;
                            const newMode = currentMode === 'code' ? 'config' : 'code';
                            updateCodeStore({ editorMode: newMode });
                          }}
                          title="Switch between mermaid code and configuration">
                          {$stateStore.editorMode === 'code' ? 'Config' : 'Code'}
                        </button>
                      </div>
                    {/if}
                  </div>
                  <div class="flex-1 overflow-hidden text-[12px]">
                    <Editor
                      onUpdate={(code) => {
                        updateCodeStore({ code });
                        ensureFileExists();
                        workspaceStore.markDirty();
                      }}
                      language={activeDiagramEngine}
                      showMermaidError={isMermaidDiagram}
                      isMobile={width < 768}
                      sendChatMessage={handleSendChatMessage} />
                  </div>
                </div>
              </div>
            {:else if panelId === 'chat'}
              <div
                class="relative flex min-w-0 flex-col overflow-hidden border-r border-border"
                style="{!panels.panels.chat.visible ? 'display: none;' : ''}width: {panels.panels
                  .chat.width}px; min-width: {panels.panels.chat.minWidth}px; flex: 0 0 auto;">
                <PanelResizeHandle
                  position="right"
                  onResize={(delta) => handlePanelResize('chat', delta)} />
                <header class="chat-header">
                  <p class="workspace-title" translate="no">{activeDiagramTitle}</p>
                </header>
                <div class="min-h-0 flex-1">
                  <ChatPanel onSelectConversation={(id) => chatComponent?.loadConversation(id)}>
                    <div class="flex h-full flex-col">
                      <div class="flex-1 overflow-hidden">
                        <Chat bind:this={chatComponent} />
                      </div>
                    </div>
                  </ChatPanel>
                </div>
              </div>
            {/if}
          {/if}
        {/each}
      </div>
    </div>
  </div>

  <!-- Modals -->
  <SettingsModal bind:open={isSettingsModalOpen} onOpenChange={(v) => (isSettingsModalOpen = v)} />

  <!-- Keyboard Shortcuts Modal -->
  {#if isShortcutsModalOpen}
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
      tabindex="0"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onclick={() => (isShortcutsModalOpen = false)}
      onkeydown={(e) => {
        if (e.key === 'Escape') isShortcutsModalOpen = false;
      }}>
      <section
        role="group"
        tabindex="-1"
        class="mx-4 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-modal-title" class="text-sm font-semibold text-foreground">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            class="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close shortcuts dialog"
            onclick={() => (isShortcutsModalOpen = false)}>
            <svg class="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"
              ><path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div class="space-y-3">
          <div>
            <h3
              class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Tools
            </h3>
            <div class="space-y-1">
              {#each [['V', 'Select tool'], ['P', 'Pan tool'], ['D', 'Draw tool'], ['G', 'Toggle grid'], ['R', 'Rough mode']] as [key, label] (key)}
                <div
                  class="flex items-center justify-between rounded-md px-2 py-1 hover:bg-muted/50">
                  <span class="text-xs text-foreground/80">{label}</span>
                  <kbd
                    class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >{key}</kbd>
                </div>
              {/each}
            </div>
          </div>
          <div>
            <h3
              class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Edit
            </h3>
            <div class="space-y-1">
              {#each [['⌘S', 'Export'], ['⌘O', 'Import'], ['Del', 'Delete selected']] as [key, label] (key)}
                <div
                  class="flex items-center justify-between rounded-md px-2 py-1 hover:bg-muted/50">
                  <span class="text-xs text-foreground/80">{label}</span>
                  <kbd
                    class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >{key}</kbd>
                </div>
              {/each}
            </div>
          </div>
          <div>
            <h3
              class="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              View
            </h3>
            <div class="space-y-1">
              {#each [['⌘+', 'Zoom in'], ['⌘-', 'Zoom out'], ['⌘0', 'Reset zoom'], ['?', 'This dialog']] as [key, label] (key)}
                <div
                  class="flex items-center justify-between rounded-md px-2 py-1 hover:bg-muted/50">
                  <span class="text-xs text-foreground/80">{label}</span>
                  <kbd
                    class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >{key}</kbd>
                </div>
              {/each}
            </div>
          </div>
        </div>
      </section>
    </div>
  {/if}
{/if}

<style>
  @reference "../../../app.css";

  .workspace-sidebar {
    --workspace-sidebar-width: 256px;
    --workspace-sidebar-collapsed-width: 64px;
    --workspace-sidebar-control: 36px;

    width: var(--workspace-sidebar-width);
    @apply flex h-screen shrink-0 flex-col overflow-hidden border-r border-border bg-card transition-[width] duration-200 ease-out dark:border-white/10;
  }

  .workspace-sidebar.collapsed {
    width: var(--workspace-sidebar-collapsed-width);
  }

  .sidebar-top {
    @apply shrink-0 border-b border-border dark:border-white/10;
  }

  .sidebar-header-row {
    @apply flex h-12 shrink-0 items-center justify-between gap-2 px-3;
  }

  .workspace-sidebar.collapsed .sidebar-header-row {
    @apply h-12 justify-center px-0;
  }

  .brand-lockup {
    @apply flex min-w-0 items-center gap-2 rounded-md text-[13px] font-semibold tracking-tight text-foreground transition-opacity hover:opacity-80;
  }

  .sidebar-icon-action {
    @apply flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:outline-none;
  }

  .sidebar-logo-button {
    @apply flex size-10 items-center justify-center rounded-md transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:outline-none;
  }

  .workspace-sidebar.collapsed .sidebar-logo-button {
    width: var(--workspace-sidebar-control);
    height: var(--workspace-sidebar-control);
  }

  .sidebar-primary-actions {
    @apply grid gap-2 p-2 pt-0;
  }

  .workspace-sidebar.collapsed .sidebar-primary-actions {
    @apply justify-items-center gap-1 px-0 pt-0;
  }

  .sidebar-new-button {
    grid-template-columns: 48px minmax(0, 1fr);
    @apply grid h-8 w-full items-center rounded-md bg-primary text-left text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:outline-none;
  }

  .sidebar-new-button.compact {
    width: var(--workspace-sidebar-control);
    height: var(--workspace-sidebar-control);
    @apply justify-center px-0;
  }

  .sidebar-new-button.compact {
    grid-template-columns: 1fr;
  }

  :global(.workspace-sidebar .sidebar-new-button > svg) {
    @apply justify-self-center;
  }

  :global(.workspace-sidebar .sidebar-new-button > span) {
    @apply min-w-0 truncate;
  }

  :global(.sidebar-create-menu),
  :global(.sidebar-account-menu) {
    @apply w-56 rounded-md border-border bg-card p-1 text-foreground shadow-sm dark:border-white/10;
  }

  :global(.sidebar-create-menu) {
    @apply w-52;
  }

  :global(.sidebar-create-item) {
    @apply h-8 gap-2 rounded-md px-2 text-[12.5px] text-muted-foreground data-highlighted:bg-muted/60 data-highlighted:text-foreground;
  }

  :global(.sidebar-create-item svg) {
    @apply text-muted-foreground;
  }

  .sidebar-panel-toggles {
    @apply grid gap-0.5;
  }

  .sidebar-chat-tab {
    @apply mb-1;
  }

  .workspace-sidebar.collapsed .sidebar-chat-tab {
    @apply mb-1;
  }

  .panel-tab,
  .sidebar-footer-button {
    grid-template-columns: 48px minmax(0, 1fr);
    @apply relative grid h-8 w-full min-w-0 items-center rounded-md text-left text-[12.5px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:outline-none;
  }

  :global(.workspace-sidebar .panel-tab > svg),
  :global(.workspace-sidebar .sidebar-footer-button > svg),
  :global(.workspace-sidebar .sidebar-footer-button > span:first-child) {
    @apply justify-self-center;
  }

  :global(.workspace-sidebar .panel-tab > span),
  :global(.workspace-sidebar .sidebar-footer-button > span:not(:first-child)) {
    @apply min-w-0 truncate;
  }

  .panel-tab.active {
    @apply bg-background text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))];
  }

  .panel-tab.active::before {
    content: '';
    @apply pointer-events-none absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-primary;
  }

  .workspace-sidebar.collapsed .panel-tab.active::before {
    @apply hidden;
  }

  .panel-tab.compact,
  .workspace-sidebar.collapsed .sidebar-footer-button {
    width: var(--workspace-sidebar-control);
    height: var(--workspace-sidebar-control);
    @apply justify-center px-0;
    grid-template-columns: 1fr;
  }

  .conversation-list {
    @apply min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2;
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--border)) transparent;
  }

  .conversation-list::-webkit-scrollbar {
    width: 6px;
  }

  .conversation-list::-webkit-scrollbar-thumb {
    background-color: hsl(var(--border));
    border-radius: 9999px;
  }

  .conversation-item {
    @apply grid h-8 w-full min-w-0 grid-cols-[minmax(0,1fr)_28px] items-center rounded-md text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground;
  }

  .conversation-item.active {
    @apply bg-background text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))];
  }

  .conversation-select {
    @apply h-full min-w-0 truncate px-2 text-left focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:outline-none;
  }

  .conversation-delete {
    @apply flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:outline-none;
  }

  .conversation-empty {
    @apply px-2 py-3 text-[12px] text-muted-foreground;
  }

  .sidebar-footer-row {
    @apply mt-auto grid shrink-0 gap-0.5 border-t border-border p-2 dark:border-white/10;
  }

  .workspace-sidebar.collapsed .sidebar-footer-row {
    @apply justify-items-center px-0;
  }

  .chat-header {
    @apply flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-3;
  }

  .workspace-title {
    @apply min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground;
  }

  .canvas-bottom-toolbar {
    @apply absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-card p-1 shadow-sm;
  }

  :global(.toolbar-btn) {
    @apply text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground;
  }

  :global(.toolbar-btn.active) {
    @apply bg-muted text-foreground;
  }

  .toolbar-separator {
    @apply mx-1 h-5 w-px bg-border;
  }

  .toolbar-zoom-label {
    @apply flex h-8 min-w-10 items-center justify-center rounded-[5px] px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums;
  }

  .layout-menu {
    @apply absolute bottom-full left-1/2 z-50 mb-2 w-32 -translate-x-1/2 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-sm;
  }

  .layout-menu-item {
    @apply flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground;
  }

  .layout-menu-item.active {
    @apply bg-accent font-medium text-foreground;
  }

  @media (max-width: 767px) {
    .workspace-sidebar {
      --workspace-sidebar-width: 232px;
      --workspace-sidebar-collapsed-width: 56px;
    }

    .chat-header {
      @apply px-2.5;
    }

    .canvas-bottom-toolbar {
      @apply bottom-3;
    }
  }
</style>
