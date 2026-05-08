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
  import { AppShell, AppSidebar } from '$lib/components/shell';
  import SidebarTrigger from '$lib/components/ui/sidebar/sidebar-trigger.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import { Button } from '$lib/components/ui/button';
  import Chat from '$lib/features/chat/components/Chat.simple.svelte';
  import { authStore } from '$lib/stores/auth.svelte';
  import type { DiagramEngine } from '$lib/types/workspace';
  import { detectEngine } from '$lib/util/detectEngine';
  import { canvasStatus } from '$lib/stores/canvasStatus.svelte';
  // autosave replaced by workspace auto-save
  import { conversationsStore } from '$lib/stores/conversations.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { kv } from '$lib/stores/kvStore.svelte';
  import { panels, type PanelId } from '$lib/stores/panels.svelte';
  import { cn } from '$lib/utils';
  import {
    AlertCircle,
    AlignLeft,
    ArrowLeft,
    Braces,
    Eraser,
    FileText,
    GitBranch,
    Grid2x2,
    Loader2 as Loader2Spin,
    Maximize2,
    Network,
    Scan,
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

  // Modal states
  let isSettingsModalOpen = $state(false);
  let isShortcutsModalOpen = $state(false);

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

  const storedEngine = $derived(workspaceStore.workspace?.document?.engine ?? 'mermaid');
  const activeDiagramEngine = $derived(detectEngine($inputStateStore.code || '', storedEngine));
  const EngineIcon = $derived.by(() => {
    switch (activeDiagramEngine) {
      case 'json':
        return Braces;
      case 'yaml':
        return AlignLeft;
      case 'markdown':
        return FileText;
      default:
        return Workflow;
    }
  });
  const engineShort = $derived.by(() => {
    switch (activeDiagramEngine) {
      case 'mermaid':
        return 'mmd';
      case 'markdown':
        return 'md';
      default:
        return activeDiagramEngine;
    }
  });
  const isMermaidDiagram = $derived(activeDiagramEngine === 'mermaid');
  const isMarkdownDocument = $derived(activeDiagramEngine === 'markdown');
  const isDocumentPanelRenderable = $derived(isMarkdownDocument);
  const hasMandatoryFileViewer = $derived(
    activeDiagramEngine === 'mermaid' ||
      activeDiagramEngine === 'markdown' ||
      activeDiagramEngine === 'json' ||
      activeDiagramEngine === 'yaml'
  );
  const hasWorkspaceContentPanel = $derived(
    panels.panels.canvas.visible || panels.panels.code.visible || panels.panels.document.visible
  );
  const leftmostVisiblePanel = $derived.by(() => {
    for (const id of panels.order) {
      if (id === 'chat' ? panels.panels.chat.visible : panels.panels[id].visible) return id;
    }
    return null;
  });
  let isViewRendering = $state(false);
  let viewRenderError = $state('');
  $effect(() => {
    canvasStatus.renderError = viewRenderError;
    canvasStatus.isRendering = isViewRendering;
  });

  let lastLoadedChatId: string | null = null;
  let isInitialChatLoad = true;
  let pendingChatLoadId: string | null = null;

  // Metadata cache: each conversation has an immutable workspace_id + user_id,
  // so we never need to refetch /api/conversations/:id for chats we've already
  // resolved this session. Skipping that fetch is what makes rapid switches /
  // deletes feel instant instead of a network roundtrip per click.
  const conversationMetaCache = new Map<string, { workspaceId: string; ownerId: string }>();
  const inflightMetaFetches = new Map<string, Promise<void>>();

  function prefetchConversation(chatId: string): void {
    if (!chatId || conversationMetaCache.has(chatId) || inflightMetaFetches.has(chatId)) return;
    const promise = (async () => {
      try {
        const res = await fetch(`/api/conversations/${encodeURIComponent(chatId)}`, {
          credentials: 'include'
        });
        if (!res.ok) return;
        const data = await res.json();
        const workspaceId = data.conversation?.workspace_id;
        const ownerId = data.conversation?.user_id;
        if (workspaceId && ownerId) {
          conversationMetaCache.set(chatId, { workspaceId, ownerId });
        }
      } catch {
        /* ignore — best-effort prefetch */
      } finally {
        inflightMetaFetches.delete(chatId);
      }
    })();
    inflightMetaFetches.set(chatId, promise);
  }

  // Generation token + AbortController so only the most recent loadChat call
  // affects state. Without this, rapid deletes/switches let an older fetch
  // resolve last and stomp the workspace with stale data — the crash the user
  // hit when chaining deletes.
  let loadGeneration = 0;
  let loadAbort: AbortController | null = null;

  async function loadChat(chatId: string, ownerId: string) {
    if (chatId === lastLoadedChatId) return;
    lastLoadedChatId = chatId;

    loadAbort?.abort();
    loadAbort = new AbortController();
    const gen = ++loadGeneration;
    const signal = loadAbort.signal;
    const isStale = () => gen !== loadGeneration;

    if (isInitialChatLoad) wsLoading = true;
    wsError = '';
    try {
      let workspaceId: string | undefined;
      let conversationOwner: string | undefined;

      // If a hover-triggered prefetch is already in flight for this chat,
      // await it instead of firing a duplicate request.
      const inflight = inflightMetaFetches.get(chatId);
      if (inflight) await inflight;
      if (isStale()) return;

      const cached = conversationMetaCache.get(chatId);
      if (cached) {
        workspaceId = cached.workspaceId;
        conversationOwner = cached.ownerId;
      } else {
        const res = await fetch(`/api/conversations/${encodeURIComponent(chatId)}`, {
          credentials: 'include',
          signal
        });
        if (isStale()) return;
        if (!res.ok) {
          wsError =
            res.status === 401
              ? 'Sign in to open this chat'
              : res.status === 404
                ? 'Chat not found'
                : 'Failed to load chat';
          return;
        }
        const data = await res.json();
        if (isStale()) return;
        workspaceId = data.conversation?.workspace_id;
        conversationOwner = data.conversation?.user_id;
        if (workspaceId && conversationOwner) {
          conversationMetaCache.set(chatId, { workspaceId, ownerId: conversationOwner });
        }
      }

      if (conversationOwner && conversationOwner !== ownerId) {
        wsError = 'Chat not found';
        return;
      }
      if (!workspaceId) {
        wsError = 'Chat is missing a workspace';
        return;
      }

      const currentId = workspaceStore.workspace?.id;
      if (workspaceId !== currentId) {
        const ok = await workspaceStore.load(workspaceId);
        if (isStale()) return;
        if (!ok) wsError = workspaceStore.state.error || 'Failed to load workspace';
      }

      conversationsStore.setActive(chatId);
      // Defer the chat load if the panel hasn't mounted yet; an effect below
      // picks it up the moment chatComponent becomes available. Avoids the
      // old 50ms-tick busy-wait that capped first-load latency at 1.5s.
      if (chatComponent) {
        await chatComponent.loadConversation(chatId);
      } else {
        pendingChatLoadId = chatId;
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      if (isStale()) return;
      wsError = 'Failed to load chat';
    } finally {
      if (!isStale()) {
        wsLoading = false;
        isInitialChatLoad = false;
      }
    }
  }

  $effect(() => {
    const chatId = $page.params.chat_id;
    const ownerId = $page.params.id;
    if (!chatId || !ownerId) return;
    conversationsStore.setActive(chatId);
    void loadChat(chatId, ownerId);
  });

  // Drains the pending chat-load the moment the Chat component mounts.
  $effect(() => {
    if (!chatComponent || !pendingChatLoadId) return;
    const id = pendingChatLoadId;
    pendingChatLoadId = null;
    void chatComponent.loadConversation(id);
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let selectedElementLabel = $state<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let selectedElementNodeName = $state<string | null>(null);
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
      if (config.layout === 'elk') currentLayout = 'elk';
      else if (config.layout === 'tidy-tree') currentLayout = 'tidy-tree';
      else currentLayout = 'dagre';
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
      !authStore.hasSession &&
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

    // Conversation/workspace loading lives in the $effect above so it re-runs
    // whenever $page.params.chat_id changes (e.g. clicking "New chat" or a
    // sidebar conversation). onMount only fires once per route component.

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

    // Chat.simple.svelte already creates the DB conversation via /api/conversations
    // and refreshes the sidebar list. We just listen so we can refresh if needed,
    // but never POST a second create here.
    const handleConversationCreated = () => {
      if (authStore.isLoggedIn) conversationsStore.fetch();
    };
    window.addEventListener('conversation-created', handleConversationCreated);

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
      window.removeEventListener('conversation-created', handleConversationCreated);
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

  function clearDiagram() {
    const code = ($inputStateStore.code || '').trim();
    if (code && !confirm('Clear the diagram? This cannot be undone.')) return;
    updateCodeStore({ code: '', updateDiagram: true });
    workspaceStore.markDirty();
    panZoomState.reset();
    zoomLevel = 100;
  }

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
  const activeChatTitle = $derived(
    conversationsStore.list.find((c) => c.id === conversationsStore.activeId)?.title || 'New chat'
  );

  $effect(() => {
    const name = workspaceStore.workspace?.title || 'Untitled';
    document.title = `${name} — Graphini`;
  });

  // Track activation order to evict oldest when exceeding max-2
  let panelActivationOrder = $state<PanelId[]>(['chat', 'code']);

  function handleTogglePanel(panel: PanelId) {
    const isVisible = panels.panels[panel].visible;
    const visiblePanels = (['chat', 'canvas', 'code'] as PanelId[]).filter(
      (p) => panels.panels[p].visible
    );

    if (isVisible) {
      // Hiding — only allow if at least one will remain
      if (visiblePanels.length <= 1) return;
      panels.hide(panel);
      panelActivationOrder = panelActivationOrder.filter((p) => p !== panel);
      return;
    }

    // Showing — if 2 already visible, hide the oldest
    if (visiblePanels.length >= 2) {
      const toHide = panelActivationOrder.find((p) => visiblePanels.includes(p));
      if (toHide) {
        panels.hide(toHide);
        panelActivationOrder = panelActivationOrder.filter((p) => p !== toHide);
      }
    }
    panels.show(panel);
    if (panel === 'canvas') panels.hide('document');
    panelActivationOrder = [...panelActivationOrder.filter((p) => p !== panel), panel];
  }

  async function startNewChat() {
    const userId = authStore.user?.id ?? $page.params.id;
    if (!userId) return;
    const created = await conversationsStore.create('New chat');
    if (!created?.id) return;
    panels.show('chat');
    await goto(`/app/${userId}/${created.id}`);
  }

  async function selectConversation(id: string) {
    const userId = authStore.user?.id ?? $page.params.id;
    if (!userId) return;
    if (id === $page.params.chat_id) {
      panels.show('chat');
      return;
    }
    panels.show('chat');
    await goto(`/app/${userId}/${id}`);
  }

  // Track in-flight deletes so a user mashing the trash icon doesn't fire a
  // second DELETE for the same row before the first resolves.
  const pendingDeletes = new Set<string>();

  async function deleteConversation(id: string) {
    if (pendingDeletes.has(id)) return;
    pendingDeletes.add(id);
    try {
      const wasActive = conversationsStore.activeId === id;
      conversationMetaCache.delete(id);
      await conversationsStore.delete(id);
      window.dispatchEvent(new CustomEvent('conversation-deleted', { detail: { id, wasActive } }));
      if (!wasActive) return;
      const userId = authStore.user?.id ?? $page.params.id;
      if (!userId) return;
      // Pick the next still-existing chat. The store's delete already filtered
      // the list synchronously after the API responded, so list[0] is safe.
      const next = conversationsStore.list[0];
      const targetId = next?.id ?? (await conversationsStore.create('New chat'))?.id;
      if (targetId) {
        await goto(`/app/${userId}/${targetId}`, { replaceState: true });
      }
    } finally {
      pendingDeletes.delete(id);
    }
  }

  $effect(() => {
    if (isDocumentPanelRenderable && panels.panels.document.visible) return;
    if (!isDocumentPanelRenderable && panels.panels.document.visible) {
      panels.hide('document');
    }
  });

  $effect(() => {
    if (
      hasMandatoryFileViewer &&
      !panels.panels.chat.visible &&
      !panels.panels.canvas.visible &&
      !panels.panels.code.visible
    ) {
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
{:else if authStore.hasSession}
  <div class="h-screen overflow-hidden bg-background" bind:clientWidth={width}>
    <AppShell>
      {#snippet sidebar()}
        <AppSidebar
          onNewChat={startNewChat}
          onSelectConversation={selectConversation}
          onDeleteConversation={deleteConversation}
          onPrefetchConversation={prefetchConversation}
          onTogglePanel={handleTogglePanel}
          onOpenSettings={() => (isSettingsModalOpen = true)} />
      {/snippet}
      <div class="flex min-h-0 flex-1 overflow-hidden" role="main">
        {#each panels.order as panelId (panelId)}
          {#if panels.panels[panelId].visible || panelId === 'chat'}
            {#if panelId === 'canvas'}
              <div
                class={cn(
                  'relative flex min-w-0 flex-1 flex-col overflow-hidden',
                  leftmostVisiblePanel !== 'canvas' && 'border-l border-border'
                )}>
                {#if !isMarkdownDocument}
                  <div class="flex shrink-0 flex-col border-b border-border bg-background">
                    <div class="flex h-9 shrink-0 items-center gap-1.5 px-3">
                      {#if leftmostVisiblePanel === 'canvas'}
                        <SidebarTrigger class="-ml-1" />
                      {/if}
                      <EngineIcon class="size-4 text-muted-foreground" />
                      <span class="text-[13px] font-semibold text-foreground">Canvas</span>
                      <span class="text-[12px] text-muted-foreground/60">|</span>
                      <span class="text-[12px] text-muted-foreground">{engineShort}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-7 {isGridVisible ? 'active' : ''}"
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
                            class="toolbar-btn active size-7"
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
                                <GitBranch />
                                <span>Dagre</span>
                              </button>
                              <button
                                type="button"
                                class={cn('layout-menu-item', currentLayout === 'elk' && 'active')}
                                onclick={() => handleLayoutChange('elk')}>
                                <Network />
                                <span>ELK</span>
                              </button>
                            </div>
                          {/if}
                        </div>
                      {/if}
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-7"
                        title="Fullscreen"
                        onclick={toggleFullscreen}><Maximize2 class="size-4" /></Button>
                      <div class="toolbar-separator"></div>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-7"
                        title="Zoom In"
                        onclick={zoomIn}><ZoomIn class="size-4" /></Button>
                      <div class="toolbar-zoom-label">{zoomLevel}%</div>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-7"
                        title="Zoom Out"
                        onclick={zoomOut}><ZoomOut class="size-4" /></Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-7"
                        title="Reset View"
                        onclick={resetView}><Scan class="size-4" /></Button>
                      <div class="toolbar-separator"></div>
                      <Button
                        variant="ghost"
                        size="icon"
                        class="toolbar-btn size-7 text-muted-foreground hover:text-destructive"
                        title="Clear diagram"
                        onclick={clearDiagram}><Eraser class="size-4" /></Button>
                      <div class="ml-auto">
                        {#if isMermaidDiagram && viewRenderError}
                          <button
                            type="button"
                            class="flex max-w-[260px] cursor-pointer items-center gap-1.5 rounded-full border border-red-500/20 bg-red-500/5 px-2 py-0.5 transition-colors hover:bg-red-500/10"
                            title="Click to auto-fix: {viewRenderError}"
                            onclick={async () => {
                              const msg = `Please fix this Mermaid error: "${viewRenderError}"`;
                              await handleSendChatMessage(msg, { isRepair: true });
                            }}>
                            <span class="size-1.5 shrink-0 rounded-full bg-red-500/70"></span>
                            <span class="truncate text-[10px] font-medium text-red-400/90"
                              >{viewRenderError}</span>
                          </button>
                        {:else if isViewRendering}
                          <div class="rounded-full bg-amber-500/10 p-1.5" title="Rendering…">
                            <span class="block size-1.5 animate-pulse rounded-full bg-amber-500/70"
                            ></span>
                          </div>
                        {:else}
                          <div class="rounded-full bg-emerald-500/10 p-1.5" title="Ready">
                            <span class="block size-1.5 rounded-full bg-emerald-500/70"></span>
                          </div>
                        {/if}
                      </div>
                    </div>
                    {#if selectedElementType !== null}
                      <div
                        class="flex min-h-12 items-center gap-1 border-t border-border px-3 py-1.5">
                        <ElementToolbar mode="inline" />
                      </div>
                    {/if}
                  </div>
                {/if}
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
                  <ColorPanel bind:open={isColorPanelOpen} />
                  <IconPanel bind:open={isIconPanelOpen} />
                </div>
              </div>
            {:else if panelId === 'document'}
              {#if isDocumentPanelRenderable}
                <div
                  class={cn(
                    'relative min-w-0 overflow-hidden',
                    leftmostVisiblePanel !== 'document' && 'border-l border-border'
                  )}
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
                class={cn(
                  'relative min-w-0 overflow-hidden',
                  leftmostVisiblePanel !== 'code' && 'border-l border-border'
                )}
                style="{panels.panels.canvas.visible
                  ? `width: ${panels.panels.code.width}px;`
                  : ''} min-width: {panels.panels.code.minWidth}px; flex: {!panels.panels.canvas
                  .visible
                  ? '1 1 0%'
                  : '0 0 auto'};">
                {#if panels.panels.canvas.visible}
                  <PanelResizeHandle
                    position="right"
                    onResize={(delta) => handlePanelResize('code', delta)} />
                {/if}
                <div class="flex h-full flex-col bg-background">
                  <div
                    class="box-content flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
                    <div class="flex items-center gap-1.5">
                      {#if leftmostVisiblePanel === 'code'}
                        <SidebarTrigger class="-ml-1" />
                      {/if}
                      <EngineIcon class="size-4 text-muted-foreground" />
                      <span class="text-[13px] font-semibold text-foreground">Code</span>
                      <span class="text-[12px] text-muted-foreground/60">|</span>
                      <span class="text-[12px] text-muted-foreground">
                        {#if isMermaidDiagram && $stateStore.editorMode === 'config'}
                          config
                        {:else}
                          {engineShort}
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
                class="relative flex h-full min-w-0 flex-col overflow-hidden"
                style={!panels.panels.chat.visible
                  ? 'display: none;'
                  : hasWorkspaceContentPanel
                    ? `width: ${panels.panels.chat.width}px; min-width: ${panels.panels.chat.minWidth}px; flex: 0 0 auto;`
                    : `min-width: ${panels.panels.chat.minWidth}px; flex: 1 1 0%;`}>
                {#if hasWorkspaceContentPanel}
                  <PanelResizeHandle
                    position="right"
                    onResize={(delta) => handlePanelResize('chat', delta)} />
                {/if}
                <header
                  class="box-content flex h-9 shrink-0 items-center gap-2 border-b border-border px-3"
                  style="background-color: var(--chat-background);">
                  <SidebarTrigger class="-ml-1" />
                  <p
                    class="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-foreground"
                    translate="no">
                    {activeChatTitle}
                  </p>
                </header>
                <div class="min-h-0 flex-1 overflow-hidden">
                  <ChatPanel onSelectConversation={(id) => chatComponent?.loadConversation(id)}>
                    <Chat bind:this={chatComponent} />
                  </ChatPanel>
                </div>
              </div>
            {/if}
          {/if}
        {/each}
      </div>
    </AppShell>
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
  @reference "../../../../app.css";

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
    @apply flex h-7 min-w-10 items-center justify-center rounded-[5px] px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums;
  }

  .layout-menu {
    @apply absolute top-full right-0 z-50 mt-1 w-28 overflow-hidden rounded-md border border-border bg-popover p-0.5 text-popover-foreground shadow-md;
  }

  .layout-menu-item {
    @apply flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-[5px] px-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground;
  }

  .layout-menu-item.active {
    @apply bg-foreground/10 text-foreground;
  }

  .layout-menu-item :global(svg) {
    @apply size-3 shrink-0 text-muted-foreground/70;
  }

  .layout-menu-item.active :global(svg),
  .layout-menu-item:hover :global(svg) {
    @apply text-foreground;
  }
</style>
