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
  import { panels, VISIBLE_PANEL_SWITCHER_IDS, type PanelId } from '$lib/stores/panels.svelte';
  import { cn } from '$lib/utils';
  import {
    AlertCircle,
    ArrowLeft,
    Braces,
    Circle,
    Code2,
    Diamond,
    Download,
    FileCode2,
    FileText,
    GitBranch,
    Grid2x2,
    Hand,
    Hexagon,
    Layers,
    Loader2 as Loader2Spin,
    LogOut,
    Maximize2,
    MessageSquare,
    MousePointer2,
    Network,
    Pencil,
    PenTool,
    Plus,
    RectangleHorizontal,
    Scan,
    Settings,
    Square,
    Triangle,
    UserCircle,
    Workflow,
    X,
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

  function standardizeDiagramType(type: string): string {
    const typeMap: Record<string, string> = {
      block: 'block',
      c4: 'c4',
      class: 'classDiagram',
      'class-diagram': 'classDiagram',
      'entity-relationship': 'erDiagram',
      er: 'erDiagram',
      'flow-chart': 'flowchart',
      flowchart: 'flowchart',
      gantt: 'gantt',
      'git-graph': 'gitGraph',
      gitgraph: 'gitGraph',
      journey: 'journey',
      kanban: 'kanban',
      mindmap: 'mindmap',
      packet: 'packet',
      pie: 'pie',
      quadrant: 'quadrantChart',
      'quadrant-chart': 'quadrantChart',
      requirement: 'requirement',
      sankey: 'sankey',
      sequence: 'sequenceDiagram',
      'sequence-diagram': 'sequenceDiagram',
      state: 'stateDiagram',
      'state-diagram': 'stateDiagram',
      timeline: 'timeline',
      treemap: 'treemap',
      'user-journey': 'journey',
      xy: 'xyChart',
      'xy-chart': 'xyChart',
      zenuml: 'zenuml'
    };
    return typeMap[type] || type;
  }

  const docURLBase = 'https://mermaid.js.org';
  const docMap: Record<string, Record<string, string>> = {
    architecture: { code: '/syntax/architecture.html' },
    block: { code: '/syntax/block.html' },
    c4: { code: '/syntax/c4.html' },
    class: { code: '/syntax/classDiagram.html', config: '/syntax/classDiagram.html#configuration' },
    er: {
      code: '/syntax/entityRelationshipDiagram.html',
      config: '/syntax/entityRelationshipDiagram.html#styling'
    },
    flowchart: { code: '/syntax/flowchart.html', config: '/syntax/flowchart.html#configuration' },
    gantt: { code: '/syntax/gantt.html', config: '/syntax/gantt.html#configuration' },
    gitGraph: {
      code: '/syntax/gitgraph.html',
      config: '/syntax/gitgraph.html#gitgraph-specific-configuration-options'
    },
    journey: { code: '/syntax/userJourney.html' },
    kanban: { code: '/syntax/kanban.html', config: '/syntax/kanban.html#configuration-options' },
    mindmap: { code: '/syntax/mindmap.html' },
    packet: {
      code: '/syntax/packet.html',
      config: '/config/schema-docs/config-defs-packet-diagram-config.html'
    },
    pie: { code: '/syntax/pie.html', config: '/syntax/pie.html#configuration' },
    quadrantChart: {
      code: '/syntax/quadrantChart.html',
      config: '/syntax/quadrantChart.html#chart-configurations'
    },
    requirement: { code: '/syntax/requirementDiagram.html' },
    sankey: { code: '/syntax/sankey.html', config: '/syntax/sankey.html#configuration' },
    sequence: {
      code: '/syntax/sequenceDiagram.html',
      config: '/syntax/sequenceDiagram.html#configuration'
    },
    stateDiagram: { code: '/syntax/stateDiagram.html' },
    timeline: { code: '/syntax/timeline.html', config: '/syntax/timeline.html#themes' },
    treemap: { code: '/syntax/treemap.html', config: '/syntax/treemap.html#configuration-options' },
    xychart: { code: '/syntax/xyChart.html', config: '/syntax/xyChart.html#chart-configurations' },
    zenuml: { code: '/syntax/zenuml.html' }
  };

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

  // Drag-and-drop panel reordering
  let dragPanelId = $state<PanelId | null>(null);
  let dragOverPanelId = $state<PanelId | null>(null);

  function handlePanelDragStart(e: DragEvent, id: PanelId) {
    dragPanelId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  }
  function handlePanelDragOver(e: DragEvent, id: PanelId) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOverPanelId = id;
  }
  function handlePanelDrop(e: DragEvent, targetId: PanelId) {
    e.preventDefault();
    if (!dragPanelId || dragPanelId === targetId) {
      dragPanelId = null;
      dragOverPanelId = null;
      return;
    }
    const order = [...panels.order];
    const fromIdx = order.indexOf(dragPanelId);
    const toIdx = order.indexOf(targetId);
    if (fromIdx >= 0 && toIdx >= 0) {
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, dragPanelId);
      panels.reorder(order);
    }
    dragPanelId = null;
    dragOverPanelId = null;
  }
  function handlePanelDragEnd() {
    dragPanelId = null;
    dragOverPanelId = null;
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
  let currentState: unknown = $state(undefined);
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

  const documentationURL = $derived.by(() => {
    const { diagramType, editorMode } = currentState || {};
    if (!diagramType) return { key: '', url: docURLBase };
    const key = standardizeDiagramType(diagramType);
    const docConfig = docMap[key] || { code: '' };
    const url = docURLBase + (docConfig[editorMode] || docConfig.code || '');
    return { key, url };
  });

  const unsubscribe = (
    inputStateStore as unknown as { subscribe: (cb: (s: unknown) => void) => () => void }
  ).subscribe((state: unknown) => {
    currentState = state;
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
    panels.show('canvas');
    panels.show('code');
    panels.show('chat');
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
    showShapeDropdown = false;
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

  // Shape dropdown state for plus button
  let showShapeDropdown = $state(false);
  const shapeOptions: { id: string; label: string; syntax: [string, string] }[] = [
    { id: 'rect', label: 'Rectangle', syntax: ['[', ']'] },
    { id: 'rounded', label: 'Rounded', syntax: ['(', ')'] },
    { id: 'stadium', label: 'Stadium', syntax: ['([', '])'] },
    { id: 'circle', label: 'Circle', syntax: ['((', '))'] },
    { id: 'rhombus', label: 'Diamond', syntax: ['{', '}'] },
    { id: 'hexagon', label: 'Hexagon', syntax: ['{{', '}}'] },
    { id: 'trapezoid', label: 'Trapezoid', syntax: ['[/', '\\]'] },
    { id: 'cylinder', label: 'Cylinder', syntax: ['[(', ')]'] },
    { id: 'subroutine', label: 'Subroutine', syntax: ['[[', ']]'] },
    { id: 'flag', label: 'Flag', syntax: ['>', ']'] }
  ];

  const handleLayoutChange = (layout: LayoutOption) => {
    currentLayout = layout;
    setLayout(layout);
    showLayoutDropdown = false;
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

  const handleClearChat = () => chatComponent?.clearChat();
  const handleNewChat = () => chatComponent?.newChat();
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

  let isRenamingInNavbar = $state(false);
  let navbarRenameValue = $state('');
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

  function startNavbarRename() {
    navbarRenameValue =
      workspaceTabs.find((tab) => tab.id === activeWorkspaceId)?.title || 'Untitled';
    isRenamingInNavbar = true;
  }

  async function saveNavbarRename() {
    if (!workspaceStore.workspace || !navbarRenameValue.trim()) {
      isRenamingInNavbar = false;
      return;
    }
    if (activeWorkspaceId) {
      workspaceStore.renameDiagram(activeWorkspaceId, navbarRenameValue.trim());
    }
    isRenamingInNavbar = false;
  }

  async function handleNewWorkspace(engine: DiagramEngine, title: string) {
    workspaceStore.addDiagram(engine, title);
  }

  function handleSwitchTab(tab: WorkspaceTab) {
    if (tab.id === activeWorkspaceId) return;
    workspaceStore.switchDiagram(tab.id);
  }

  $effect(() => {
    if (isDocumentPanelRenderable && panels.panels.document.visible) return;
    if (!isDocumentPanelRenderable && panels.panels.document.visible) {
      panels.hide('document');
    }
  });

  $effect(() => {
    if (hasMandatoryFileViewer && !panels.panels.canvas.visible) {
      panels.show('canvas');
    }
  });

  function handleCloseTab(event: Event, tabId: string) {
    event.stopPropagation();
    workspaceStore.closeDiagram(tabId);
  }
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
        onclick={() => goto(resolve('/dashboard'))}>
        <ArrowLeft class="size-3.5" />
        Back to Dashboard
      </button>
    </div>
  </div>
{:else if authStore.isLoggedIn}
  <div class="flex h-screen flex-col overflow-hidden bg-background" bind:clientWidth={width}>
    <!-- ═══ TOP HEADER BAR ═══ -->
    <header class="flex h-12 items-center border-b border-border bg-card pr-3">
      <div class="flex h-full min-w-0 flex-1 items-center">
        <div class="flex h-full w-14 shrink-0 items-center justify-center border-r border-border">
          <img src="/brand/logo.png" alt="Graphini" class="size-7" />
        </div>

        <div class="tab-switcher" role="tablist" aria-label="Workspace files">
          {#each workspaceTabs as tab (tab.id)}
            {@const isActiveTab = tab.id === activeWorkspaceId}
            {#if isActiveTab && isRenamingInNavbar}
              <input
                type="text"
                bind:value={navbarRenameValue}
                class="mx-1 h-8 w-52 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-foreground focus:border-primary focus:ring-1 focus:ring-primary/30 focus:outline-none"
                onkeydown={(e) => {
                  if (e.key === 'Enter') saveNavbarRename();
                  if (e.key === 'Escape') isRenamingInNavbar = false;
                }}
                onblur={() => saveNavbarRename()} />
            {:else}
              <button
                type="button"
                class="workspace-tab {isActiveTab ? 'active' : ''}"
                aria-selected={isActiveTab}
                role="tab"
                onclick={() => handleSwitchTab(tab)}
                ondblclick={() => {
                  if (isActiveTab) startNavbarRename();
                }}
                title={isActiveTab ? 'Double-click to rename' : `Open ${tab.title}`}>
                {#if tab.engine === 'json'}
                  <Braces class="size-3.5" />
                {:else if tab.engine === 'yaml'}
                  <FileCode2 class="size-3.5" />
                {:else if tab.engine === 'markdown'}
                  <FileText class="size-3.5" />
                {:else}
                  <Workflow class="size-3.5" />
                {/if}
                <span class="tab-title max-w-[160px] truncate">{tab.title}</span>
                <span
                  role="button"
                  tabindex="0"
                  class="tab-close"
                  aria-label="Close {tab.title}"
                  onkeydown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') handleCloseTab(e, tab.id);
                  }}
                  onclick={(e) => handleCloseTab(e, tab.id)}>
                  <X class="size-3.5" />
                </span>
              </button>
            {/if}
          {/each}

          <DropdownMenu.Root>
            <DropdownMenu.Trigger class="workspace-tab" aria-label="New file" title="New file">
              <Plus class="size-3.5" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              align="start"
              sideOffset={5}
              class="w-64 rounded-md border-border bg-card p-1 shadow-sm dark:border-white/10">
              <DropdownMenu.Label class="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                New file
              </DropdownMenu.Label>
              <DropdownMenu.Item
                class="rounded-md px-2 py-2 data-highlighted:bg-muted/60"
                onclick={() => handleNewWorkspace('mermaid', 'Untitled Mermaid')}>
                <Workflow class="mt-0.5 size-4" />
                <span class="min-w-0">
                  <span class="block text-sm font-medium">Mermaid</span>
                  <span class="block text-xs text-muted-foreground">Diagram source and canvas</span>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="rounded-md px-2 py-2 data-highlighted:bg-muted/60"
                onclick={() => handleNewWorkspace('markdown', 'Untitled Markdown')}>
                <FileText class="mt-0.5 size-4" />
                <span class="min-w-0">
                  <span class="block text-sm font-medium">Markdown</span>
                  <span class="block text-xs text-muted-foreground">Notes, specs, and docs</span>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="rounded-md px-2 py-2 data-highlighted:bg-muted/60"
                onclick={() => handleNewWorkspace('json', 'Untitled JSON')}>
                <Braces class="mt-0.5 size-4" />
                <span class="min-w-0">
                  <span class="block text-sm font-medium">JSON</span>
                  <span class="block text-xs text-muted-foreground">Structured data viewer</span>
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="rounded-md px-2 py-2 data-highlighted:bg-muted/60"
                onclick={() => handleNewWorkspace('yaml', 'Untitled YAML')}>
                <FileCode2 class="mt-0.5 size-4" />
                <span class="min-w-0">
                  <span class="block text-sm font-medium">YAML</span>
                  <span class="block text-xs text-muted-foreground">Config and manifest files</span>
                </span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </div>

      <!-- Right: Actions -->
      <div class="flex items-center gap-1">
        <div
          class="mr-1 hidden items-center gap-0.5 border border-border bg-card p-0.5 lg:flex dark:border-white/10">
          {#each VISIBLE_PANEL_SWITCHER_IDS as panelId (panelId)}
            {@const Icon = panelIcons[panelId]}
            {@const panelConfig = panels.panels}
            {@const isActive = panelConfig[panelId].visible}
            {@const label = panelConfig[panelId].label}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="flex items-center rounded-md transition-all duration-150
              {dragOverPanelId === panelId && dragPanelId !== panelId
                ? 'ring-2 ring-primary/40'
                : ''}
              {dragPanelId === panelId ? 'opacity-40' : ''}"
              draggable="true"
              ondragstart={(e) => handlePanelDragStart(e, panelId)}
              ondragover={(e) => handlePanelDragOver(e, panelId)}
              ondrop={(e) => handlePanelDrop(e, panelId)}
              ondragend={handlePanelDragEnd}>
              <button
                type="button"
                class="flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-150
                {isActive
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground/70 hover:bg-muted/30 hover:text-foreground'}"
                title={label}
                onclick={() => panels.toggle(panelId)}>
                <Icon class="size-3.5" />
                <span class="hidden xl:inline">{label}</span>
              </button>
            </div>
          {/each}
        </div>
        <!-- User Auth -->
        {#if authStore.isLoggedIn}
          {@const initials = (authStore.user?.display_name || authStore.user?.email || 'U')
            .split(' ')
            .map((w) => w[0])
            .join('')
            .toUpperCase()
            .slice(0, 2)}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class="flex size-8 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground ring-1 ring-border/50 transition-colors hover:ring-border focus:outline-none">
              {initials}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="w-56">
              <DropdownMenu.Label class="flex flex-col gap-0.5">
                <span class="text-sm font-medium">{authStore.user?.display_name || 'User'}</span>
                <span class="text-xs font-normal text-muted-foreground"
                  >{authStore.user?.email}</span>
              </DropdownMenu.Label>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                class="gap-2"
                onclick={() => {
                  isSettingsModalOpen = true;
                }}>
                <Settings class="size-4" /><span>Settings</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                class="gap-2 text-red-500 focus:text-red-500"
                onclick={() => authStore.logout()}>
                <LogOut class="size-4" /><span>Sign out</span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {:else}
          <button
            type="button"
            class="flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground ring-1 ring-border/50 transition-colors hover:bg-muted/80"
            title="Sign in"
            onclick={() => authStore.login()}>
            <UserCircle class="size-4" />
          </button>
        {/if}
      </div>
    </header>

    <!-- ═══ MAIN CONTENT: DYNAMIC PANEL LAYOUT ═══ -->
    <div class="flex flex-1 overflow-hidden" role="main">
      {#each panels.order as panelId (panelId)}
        {#if panels.panels[panelId].visible || panelId === 'chat'}
          {#if panelId === 'canvas'}
            <div class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
              <!-- Floating Vertical Canvas Toolbar -->
              {#if isMermaidDiagram}
                <div
                  class="absolute top-1/2 left-3 z-30 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-border bg-card p-1.5 shadow-sm">
                  <!-- Plus button with shape dropdown -->
                  <div class="relative">
                    <Button
                      variant="ghost"
                      size="icon"
                      class="toolbar-btn size-8"
                      title="Add Node (N)"
                      onclick={() => {
                        showShapeDropdown = !showShapeDropdown;
                        showLayoutDropdown = false;
                      }}><Plus class="size-4" /></Button>
                    {#if showShapeDropdown}
                      <div
                        class="absolute top-0 left-full z-50 ml-1.5 w-[200px] rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-sm">
                        <div class="mb-1 flex items-center justify-between px-1.5 py-0.5">
                          <span class="text-[10px] font-medium text-muted-foreground"
                            >Add Node</span>
                          <button
                            type="button"
                            class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            onclick={() => (showShapeDropdown = false)}>
                            <X class="size-3" />
                          </button>
                        </div>
                        <div class="grid grid-cols-5 gap-1">
                          {#each shapeOptions as shape (shape.label)}
                            <button
                              type="button"
                              class="flex flex-col items-center justify-center gap-0.5 rounded-lg p-1.5 transition-colors hover:bg-accent"
                              title={shape.label}
                              onclick={() => handleAddNode(shape.syntax)}>
                              {#if shape.id === 'rect'}
                                <RectangleHorizontal class="size-4 text-muted-foreground" />
                              {:else if shape.id === 'rounded'}
                                <Square class="size-4 text-muted-foreground" />
                              {:else if shape.id === 'circle'}
                                <Circle class="size-4 text-muted-foreground" />
                              {:else if shape.id === 'rhombus'}
                                <Diamond class="size-4 text-muted-foreground" />
                              {:else if shape.id === 'hexagon'}
                                <Hexagon class="size-4 text-muted-foreground" />
                              {:else if shape.id === 'trapezoid'}
                                <Triangle class="size-4 text-muted-foreground" />
                              {:else}
                                <span
                                  class="font-mono text-[9px] leading-none text-muted-foreground"
                                  >{shape.syntax[0]}{shape.syntax[1]}</span>
                              {/if}
                              <span
                                class="text-[7px] leading-none font-medium text-muted-foreground"
                                >{shape.label}</span>
                            </button>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                  <div class="mx-1 h-px bg-border"></div>

                  {#if documentationURL.key}
                    <a
                      href={documentationURL.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="toolbar-btn size-8"
                      title="View {documentationURL.key} docs">
                      <FileCode2 class="size-4" />
                    </a>
                    <div class="mx-1 h-px bg-border"></div>
                  {/if}

                  <!-- Tool selection buttons -->
                  <Button
                    variant="ghost"
                    size="icon"
                    class="toolbar-btn size-8 {activeTool === 'select' ? 'active' : ''}"
                    title="Select (V)"
                    onclick={() => handleToolSelect('select')}
                    ><MousePointer2 class="size-4" /></Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="toolbar-btn size-8 {activeTool === 'pan' ? 'active' : ''}"
                    title="Pan (H)"
                    onclick={() => handleToolSelect('pan')}><Hand class="size-4" /></Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="toolbar-btn size-8 {activeTool === 'draw' ? 'active' : ''}"
                    title="Draw (D)"
                    onclick={() => handleToolSelect('draw')}><Pencil class="size-4" /></Button>
                  <div class="mx-1 h-px bg-border"></div>

                  <!-- Style and display options -->
                  <Button
                    variant="ghost"
                    size="icon"
                    class="toolbar-btn size-8 {isRoughMode ? 'active' : ''}"
                    title="Hand-Drawn (R)"
                    onclick={toggleRoughMode}><PenTool class="size-4" /></Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="toolbar-btn size-8 {isGridVisible ? 'active' : ''}"
                    title="Grid (G)"
                    onclick={toggleGrid}><Grid2x2 class="size-4" /></Button>
                  <div class="mx-1 h-px bg-border"></div>

                  <!-- Layout dropdown -->
                  <div class="relative">
                    <Button
                      variant="ghost"
                      size="icon"
                      class="toolbar-btn size-8 {currentLayout === 'dagre' ||
                      currentLayout === 'elk'
                        ? 'active'
                        : ''}"
                      title="Layout Options"
                      onclick={() => {
                        showLayoutDropdown = !showLayoutDropdown;
                        showShapeDropdown = false;
                      }}>
                      <Workflow class="size-4" />
                    </Button>
                    {#if showLayoutDropdown}
                      <div
                        class="absolute top-0 left-full z-50 ml-1.5 w-32 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-sm">
                        <div class="mb-0.5 flex items-center justify-between px-2 py-1">
                          <span class="text-[10px] font-medium text-muted-foreground">Layout</span>
                          <button
                            type="button"
                            class="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            onclick={() => (showLayoutDropdown = false)}>
                            <X class="size-3" />
                          </button>
                        </div>
                        <button
                          type="button"
                          class={cn(
                            'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors',
                            currentLayout === 'dagre'
                              ? 'bg-accent font-medium text-foreground'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          )}
                          onclick={() => handleLayoutChange('dagre')}>
                          <GitBranch class="size-3" />
                          Dagre
                        </button>
                        <button
                          type="button"
                          class={cn(
                            'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors',
                            currentLayout === 'elk'
                              ? 'bg-accent font-medium text-foreground'
                              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                          )}
                          onclick={() => handleLayoutChange('elk')}>
                          <Network class="size-3" />
                          ELK
                        </button>
                      </div>
                    {/if}
                  </div>
                  <div class="mx-1 h-px bg-border"></div>

                  <!-- Export -->
                  <Button
                    variant="ghost"
                    size="icon"
                    class="toolbar-btn size-8"
                    title="Export SVG (Ctrl+S)"
                    onclick={handleExport}><Download class="size-4" /></Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="toolbar-btn size-8"
                    title="Fullscreen"
                    onclick={() => {
                      if (document.fullscreenElement) document.exitFullscreen();
                      else document.documentElement.requestFullscreen();
                    }}><Maximize2 class="size-4" /></Button>
                  <div class="mx-1 h-px bg-border"></div>

                  <!-- Zoom controls at bottom -->
                  <Button
                    variant="ghost"
                    size="icon"
                    class="toolbar-btn size-8"
                    title="Zoom In"
                    onclick={() => {
                      panZoomState.zoomIn();
                      zoomLevel = Math.min(400, zoomLevel + 10);
                    }}><ZoomIn class="size-4" /></Button>
                  <div
                    class="flex size-8 items-center justify-center rounded-[5px] text-[10px] font-medium text-muted-foreground tabular-nums">
                    {zoomLevel}%
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="toolbar-btn size-8"
                    title="Zoom Out"
                    onclick={() => {
                      panZoomState.zoomOut();
                      zoomLevel = Math.max(25, zoomLevel - 10);
                    }}><ZoomOut class="size-4" /></Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="toolbar-btn size-8"
                    title="Reset View"
                    onclick={() => {
                      panZoomState.reset();
                      zoomLevel = 100;
                    }}><Scan class="size-4" /></Button>
                </div>
              {/if}

              <!-- Diagram View -->
              <div class="relative flex-1 overflow-hidden">
                {#if isMermaidDiagram}
                  <View
                    {panZoomState}
                    shouldShowGrid={$stateStore.grid}
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
                    title={activeDiagramTitle}
                    source={$inputStateStore.code || ''} />
                  <div
                    class="absolute bottom-8 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-sm">
                    <Button
                      variant="ghost"
                      size="icon"
                      class="toolbar-btn size-8"
                      title="Zoom Out"
                      onclick={() => {
                        panZoomState.zoomOut();
                        zoomLevel = Math.max(25, zoomLevel - 10);
                      }}><ZoomOut class="size-4" /></Button>
                    <div
                      class="flex h-8 min-w-10 items-center justify-center rounded-[5px] px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                      {zoomLevel}%
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="toolbar-btn size-8"
                      title="Zoom In"
                      onclick={() => {
                        panZoomState.zoomIn();
                        zoomLevel = Math.min(400, zoomLevel + 10);
                      }}><ZoomIn class="size-4" /></Button>
                    <div class="mx-1 h-5 w-px bg-border"></div>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="toolbar-btn size-8"
                      title="Reset View"
                      onclick={() => {
                        panZoomState.reset();
                        zoomLevel = 100;
                      }}><Scan class="size-4" /></Button>
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
                  : ''} min-width: {panels.panels.document.minWidth}px; flex: {!panels.panels.canvas
                  .visible
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
              class="relative min-w-0 overflow-hidden border-l border-border"
              style="{!panels.panels.chat.visible ? 'display: none;' : ''}{panels.panels.canvas
                .visible
                ? `width: ${panels.panels.chat.width}px;`
                : ''} min-width: {panels.panels.chat.minWidth}px; flex: {!panels.panels.canvas
                .visible
                ? '1 1 0%'
                : '0 0 auto'};">
              <PanelResizeHandle
                position="left"
                onResize={(delta) => handlePanelResize('chat', delta)} />
              <ChatPanel
                onNewChat={handleNewChat}
                onClearChat={handleClearChat}
                onSelectConversation={(id) => chatComponent?.loadConversation(id)}>
                <div class="flex h-full flex-col">
                  <div class="flex-1 overflow-hidden">
                    <Chat bind:this={chatComponent} />
                  </div>
                </div>
              </ChatPanel>
            </div>
          {/if}
        {/if}
      {/each}
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

  .tab-switcher {
    @apply ml-2 flex h-full min-w-0 flex-1 items-end gap-0 overflow-x-auto border-b border-border bg-card dark:border-white/10;
  }

  :global(.workspace-tab) {
    @apply flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-left text-[11px] font-medium transition-colors duration-150;
    @apply text-muted-foreground hover:border-transparent hover:bg-background hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:outline-none;
  }

  :global(.workspace-tab.active) {
    @apply min-w-0 border-foreground bg-background text-foreground;
  }

  .tab-title {
    @apply text-[11px] font-medium tracking-normal text-current;
  }

  .tab-close {
    @apply -mr-1 flex size-5 max-w-0 items-center justify-center overflow-hidden text-muted-foreground opacity-0 transition-all duration-150 ease-out;
    @apply pointer-events-none hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:opacity-100 focus-visible:outline-none;
  }

  :global(.workspace-tab):hover .tab-close,
  :global(.workspace-tab):focus-within .tab-close {
    @apply pointer-events-auto max-w-5 opacity-100;
  }

  @media (max-width: 767px) {
    .workspace-tab {
      @apply px-2;
    }

    .tab-title {
      @apply text-[11px];
    }
  }
</style>
