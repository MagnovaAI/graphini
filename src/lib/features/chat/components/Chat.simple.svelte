<script lang="ts">
  import * as Popover from '$lib/components/ui/popover';
  import { Textarea } from '$lib/components/ui/textarea';
  import {
    PromptInput,
    PromptInputAttachment,
    PromptInputAttachments,
    PromptInputBody,
    PromptInputSubmit,
    PromptInputToolbar,
    PromptInputTools
  } from '$lib/features/chat/components/ai-elements';
  import { CodeArtifact } from '$lib/features/chat/components/ai-elements/code-artifact';
  import type { PromptInputMessage } from '$lib/features/chat/components/ai-elements/prompt-input';
  import { Response } from '$lib/features/chat/components/ai-elements/response';
  import { parse as mermaidParse } from '$lib/features/diagram/mermaid';
  import { canvasStatus } from '$lib/stores/canvasStatus.svelte';
  import { authStore } from '$lib/stores/auth.svelte';
  import { documentMarkdownStore } from '$lib/stores/documentStore.svelte';
  import { workspaceStore } from '$lib/stores/workspace.svelte';
  import { kv } from '$lib/stores/kvStore.svelte';
  import { modelsStore } from '$lib/stores/models.svelte';
  // sessionFilesStore removed — workspace handles state
  import { toolsStore } from '$lib/stores/toolsStore.svelte';
  import { svgIdToNodeName } from '$lib/util/diagram/diagramMapper';
  import { inputStateStore, stateStore, updateCodeStore } from '$lib/util/state/state';
  import {
    AlertCircle,
    ArrowDown,
    BookOpen,
    Brain,
    Building2,
    ChartBar,
    Check,
    ChevronRight,
    ChevronsUpDown,
    ClipboardCheck,
    Database,
    FileText,
    GitBranch,
    Globe,
    Lightbulb,
    ListChecks,
    MessageCircleQuestion,
    Network,
    Paintbrush,
    Palette,
    Paperclip,
    Plus,
    RefreshCw,
    RotateCcw,
    Search,
    ShieldCheck,
    Smartphone,
    Sparkles,
    Square,
    Target,
    Undo2,
    Wrench,
    Zap
  } from 'lucide-svelte';
  import { onMount, tick } from 'svelte';
  // get from svelte/store not needed — removed
  import { v4 as uuidv4 } from 'uuid';

  // Per-file chat state: each file gets its own conversation
  function getCurrentFileId(): string {
    const workspaceId = workspaceStore.workspace?.id;
    const diagramId = workspaceStore.activeDiagramId;
    return workspaceId && diagramId ? `${workspaceId}:${diagramId}` : workspaceId || '_default';
  }

  function getDiagramIdFromFileId(fileId: string): string | null {
    const separatorIndex = fileId.indexOf(':');
    return separatorIndex >= 0 ? fileId.slice(separatorIndex + 1) : null;
  }

  function getActiveWorkspaceTab() {
    return workspaceStore.diagrams.find((diagram) => diagram.id === workspaceStore.activeDiagramId);
  }

  function getActiveWorkspaceEngine() {
    return (
      getActiveWorkspaceTab()?.engine ?? workspaceStore.workspace?.document?.engine ?? 'mermaid'
    );
  }

  function isOutputForActiveTab(output: Record<string, unknown> | undefined) {
    if (!output) return true;
    const activeTab = getActiveWorkspaceTab();
    const outputTabId = output.targetTabId;
    const outputTabName = output.targetTabName;
    if (typeof outputTabId === 'string' && activeTab?.id) return outputTabId === activeTab.id;
    if (typeof outputTabName === 'string' && activeTab?.title) {
      return outputTabName === activeTab.title;
    }
    return true;
  }

  function currentInputTargetsActiveTab(inputJson: string) {
    const activeTab = getActiveWorkspaceTab();
    const targetMatch = inputJson.match(/"targetTabName"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (!targetMatch || !activeTab?.title) return true;
    return targetMatch[1].replace(/\\"/g, '"') === activeTab.title;
  }

  const mermaidDeclarationPattern =
    /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|kanban|gitGraph|gitgraph|quadrantChart|xyChart|xychart|sankey|block|packet|architecture|C4Context|C4Container|C4Component|C4Deployment|requirementDiagram|zenuml)\b/i;

  function extractStreamingJsonNumber(inputJson: string, key: string): number | null {
    const match = inputJson.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
    return match ? Number(match[1]) : null;
  }

  function buildDiagramPatchPreview(inputJson: string, replacement: string, previousCode: string) {
    const startLine = extractStreamingJsonNumber(inputJson, 'startLine');
    const endLine = extractStreamingJsonNumber(inputJson, 'endLine');
    if (!startLine || !endLine || startLine > endLine || !previousCode.trim()) return null;

    const lines = previousCode.split('\n');
    if (endLine > lines.length) return null;

    const replacementLines = replacement.split('\n');
    const replacingWholeDocument = startLine === 1 && endLine === lines.length && lines.length > 1;
    if (replacingWholeDocument && mermaidDeclarationPattern.test(replacement.trim())) return null;

    const nextLines = [...lines];
    nextLines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
    return nextLines.join('\n');
  }

  function previewDiagramToolInput(
    toolName: string,
    inputJson: string,
    content: string,
    artifactId: string
  ) {
    if (!content.trim() || !currentInputTargetsActiveTab(inputJson)) return false;
    if (toolName === 'diagramWrite' && !mermaidDeclarationPattern.test(content.trim())) {
      return false;
    }

    const nextCode =
      toolName === 'diagramPatch'
        ? buildDiagramPatchPreview(
            inputJson,
            content,
            artifactMap[artifactId]?.previousCode || $stateStore.code || ''
          )
        : content;

    if (!nextCode?.trim() || !mermaidDeclarationPattern.test(nextCode.trim())) return false;
    inputStateStore.update((s) => ({
      ...s,
      code: nextCode,
      updateDiagram: getActiveWorkspaceEngine() === 'mermaid'
    }));
    return true;
  }

  function getToolDisplayName(toolName: string) {
    const names: Record<string, string> = {
      actionItemExtractor: 'Action Items',
      askQuestions: 'Question Tool',
      autoStyler: 'Style Tool',
      dataAnalyzer: 'Data Analyzer',
      diagramDelete: 'Clear Diagram',
      diagramPatch: 'Diagram Patch',
      diagramRead: 'Diagram Read',
      diagramWrite: 'Diagram Write',
      errorChecker: 'Error Checker',
      fileManager: 'Files',
      gitGuard: 'Git Guard',
      iconSearch: 'Icon Tool',
      iconifier: 'Icon Tool',
      longTermMemory: 'Memory',
      planWithProgress: 'Plan Progress',
      planner: 'Planner',
      selfCritique: 'Review',
      sequentialThinking: 'Thinking',
      styleSearch: 'Style Tool',
      subagentAssemble: 'Subagent Assemble',
      subagentFanout: 'Subagent Fanout',
      tableAnalytics: 'Table Analytics',
      thinking: 'Thinking',
      webSearch: 'Web Search'
    };

    return names[toolName] ?? toolName;
  }

  function applyToolSourceToActiveTab(content: string, output?: Record<string, unknown>) {
    if (!isOutputForActiveTab(output)) return;
    inputStateStore.update((s) => ({
      ...s,
      code: content,
      updateDiagram: getActiveWorkspaceEngine() === 'mermaid'
    }));
    workspaceStore.markDirty();
  }

  // Track current file to detect switches
  let currentFileId = getCurrentFileId();
  let fileEffectInitialized = false;

  // React to workspace switches.
  $effect(() => {
    const newFileId = getCurrentFileId();
    if (!fileEffectInitialized) {
      fileEffectInitialized = true;
      return;
    }
    if (newFileId !== currentFileId) {
      const previousFileId = currentFileId;
      if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }
      if (dbSyncTimeout) {
        clearTimeout(dbSyncTimeout);
        dbSyncTimeout = null;
      }
      saveChatState(previousFileId);
      currentFileId = newFileId;
      restoreChatStateForFile();
    }
  });

  function chatKey(suffix: string, fileId?: string): string {
    return `graphini_chat_${fileId || currentFileId}_${suffix}`;
  }

  // Persist sessionId per file
  let sessionId = (() => {
    try {
      const saved = kv.get<string>('chat', chatKey('sessionId'));
      if (saved) return saved;
    } catch {
      /* ignore */
    }
    const id = uuidv4();
    try {
      kv.set('chat', chatKey('sessionId'), id);
    } catch {
      /* ignore */
    }
    return id;
  })();

  // Notify session files store of current session
  // session files removed — workspace handles state

  // ── DB Sync for chat persistence ──
  let dbConversationId: string | null = null;
  let dbSyncedMessageCount = 0;
  let dbSyncTimeout: ReturnType<typeof setTimeout> | null = null;

  interface DbMessageRow {
    content: string;
    created_at: string;
    id: string;
    metadata: Record<string, unknown> | null;
    model_used: string | null;
    parts: unknown;
    role: string;
  }

  function getDbConversationId(): string | null {
    try {
      return kv.get<string>('chat', chatKey('dbConvId')) || null;
    } catch {
      return null;
    }
  }

  function setDbConversationId(id: string | null) {
    dbConversationId = id;
    try {
      if (id) kv.set('chat', chatKey('dbConvId'), id);
      else kv.delete('chat', chatKey('dbConvId'));
    } catch {
      /* ignore */
    }
  }

  function metadataOf(message: DbMessageRow): Record<string, unknown> {
    return message.metadata && typeof message.metadata === 'object' ? message.metadata : {};
  }

  function messagesFromDbRows(rows: DbMessageRow[]): Record<string, unknown>[] {
    return rows.map((message) => {
      const metadata = metadataOf(message);
      return {
        attachments: metadata.attachments || [],
        content: message.content,
        contextContent: metadata.contextContent,
        id: typeof metadata.clientId === 'string' ? metadata.clientId : message.id,
        model_used: message.model_used,
        role: message.role,
        timestamp: metadata.timestamp || new Date(message.created_at).getTime()
      };
    });
  }

  function partsFromDbRows(rows: DbMessageRow[]): Record<number, ContentPart[]> {
    const restoredParts: Record<number, ContentPart[]> = {};
    rows.forEach((message, index) => {
      if (Array.isArray(message.parts)) restoredParts[index] = message.parts as ContentPart[];
      else if (message.role === 'assistant' && message.content) {
        restoredParts[index] = [{ type: 'text', text: message.content }];
      }
    });
    return restoredParts;
  }

  function applyDbMessages(convId: string, rows: DbMessageRow[]) {
    messages = messagesFromDbRows(rows);
    messageParts = partsFromDbRows(rows);
    dbConversationId = convId || null;
    dbSyncedMessageCount = messages.length;
    conversationStarted = messages.length > 0;
  }

  function clearCurrentFileChatCache() {
    kv.delete('chat', chatKey('messages'));
    kv.delete('chat', chatKey('parts'));
    kv.delete('chat', chatKey('artifacts'));
    kv.delete('chat', chatKey('reasoning'));
    kv.delete('chat', chatKey('checkpoints'));
    kv.delete('chat', chatKey('diagramCode'));
    kv.delete('chat', chatKey('activeConversationId'));
    kv.delete('chat', chatKey('dbConvId'));
  }

  async function ensureDbConversation(): Promise<string | null> {
    if (!authStore.isLoggedIn) return null;
    if (dbConversationId) return dbConversationId;
    // Check localStorage first
    const saved = getDbConversationId();
    if (saved) {
      dbConversationId = saved;
      return saved;
    }
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: conversationTitle || 'New Chat',
          metadata: { fileId: getCurrentFileId() }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const newConvId = data.conversation?.id || null;
        setDbConversationId(newConvId);
        // Persist active conversation ID so it survives refresh
        if (newConvId) {
          try {
            kv.set('chat', chatKey('activeConversationId'), newConvId);
          } catch {
            /* ignore */
          }
          // Refresh conversations list so history panel shows the new conversation
          import('$lib/stores/conversations.svelte')
            .then(({ conversationsStore }) => {
              conversationsStore.fetch();
              conversationsStore.setActive(newConvId);
            })
            .catch(() => {
              /* ignore */
            });
        }
        return dbConversationId;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  async function syncMessagesToDb() {
    if (!authStore.isLoggedIn || messages.length === 0 || !conversationStarted) return;
    const convId = await ensureDbConversation();
    if (!convId) return;
    // Only sync new messages since last sync
    const newMessages = messages.slice(dbSyncedMessageCount);
    if (newMessages.length === 0) return;
    try {
      const payload = newMessages.map((m: Record<string, unknown>, i: number) => {
        const globalIdx = dbSyncedMessageCount + i;
        // Sanitize parts to be JSON-safe
        let safeParts = null;
        try {
          const raw = messageParts[globalIdx];
          if (raw) safeParts = JSON.parse(JSON.stringify(raw));
        } catch {
          /* ignore */
        }
        // DB has content_not_empty constraint — never send empty string
        const rawContent = m.content as string | undefined;
        const content = rawContent && rawContent.trim() ? rawContent : '[tool call]';
        return {
          content,
          metadata: {
            attachments: m.attachments,
            clientId: typeof m.id === 'string' ? m.id : undefined,
            contextContent: m.contextContent,
            timestamp: m.timestamp
          },
          model_used: m.role === 'assistant' ? (m.model_used ?? selectedModelId) : undefined,
          parts: safeParts,
          role: m.role
        };
      });
      const res = await fetch('/api/conversations/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ conversation_id: convId, messages: payload })
      });
      if (res.ok) {
        dbSyncedMessageCount = messages.length;
      }
    } catch {
      /* ignore */
    }
  }

  function debouncedDbSync() {
    if (dbSyncTimeout) clearTimeout(dbSyncTimeout);
    dbSyncTimeout = setTimeout(() => {
      syncMessagesToDb();
      dbSyncTimeout = null;
    }, 2000);
  }

  async function restoreChatFromDb(): Promise<boolean> {
    if (!authStore.isLoggedIn) return false;
    const convId = getDbConversationId();
    if (!convId) return false;
    try {
      const res = await fetch(`/api/conversations/messages?conversation_id=${convId}`, {
        credentials: 'include'
      });
      if (res.status === 404) {
        clearCurrentFileChatCache();
        setDbConversationId(null);
        applyDbMessages('', []);
        return true;
      }
      if (!res.ok) return false;
      const data = await res.json();
      if (!Array.isArray(data.messages)) return false;
      applyDbMessages(convId, data.messages as DbMessageRow[]);
      return true;
    } catch {
      return false;
    }
  }

  // Models loaded from API via modelsStore
  onMount(() => {
    modelsStore.loadSaved();
    modelsStore.fetch();
    loadPromptEnhancerModel();

    // Sync currentFileId with store's actual current file before restoring
    currentFileId = getCurrentFileId();

    // Wait for KV store to initialize (loads cache from server), then restore chat
    const initAndRestore = async () => {
      try {
        // Ensure KV store cache is populated before reading from it
        await kv.init({ force: authStore.isLoggedIn });
        toolsStore.syncFromKv();
        // Restore from KV cache (instant after init)
        restoreChatState();

        // Wait up to 3s for auth to initialize, then try DB restore to merge/override
        for (let i = 0; i < 30; i++) {
          if (authStore.isInitialized) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (authStore.isLoggedIn) {
          // Check if there's a saved active conversation ID (from switching conversations)
          const savedActiveConvId = kv.get<string | null>('chat', chatKey('activeConversationId'));
          if (savedActiveConvId) {
            // Load the specific conversation the user was viewing
            setDbConversationId(savedActiveConvId);
            const restored = await restoreChatFromDb();
            if (restored) {
              conversationStarted = messages.length > 0;
              // Update conversationsStore active ID to match
              const { conversationsStore } = await import('$lib/stores/conversations.svelte');
              await conversationsStore.fetch();
              conversationsStore.setActive(savedActiveConvId);
            }
          } else {
            const restored = await restoreChatFromDb();
            if (restored) {
              conversationStarted = messages.length > 0;
            }
          }
        } else if (authStore.isInitialized && !authStore.isLoggedIn) {
          // Not signed in (could be a guest or fully anonymous). Reset chat
          // panel to a clean slate; guests still get their server messages
          // via Stage 2 navigation logic, not via the legacy KV-restore path.
          try {
            clearCurrentFileChatCache();
          } catch {
            /* ignore */
          }
          messages = [];
          messageParts = {};
          artifactMap = {};
          conversationStarted = false;
          conversationTitle = null;
          inputStateStore.update((s) => ({ ...s, code: '', updateDiagram: true }));
        }
      } catch (err) {
        console.error('[chat] initAndRestore failed:', err);
      } finally {
        isDataReady = true;
      }
    };
    initAndRestore();

    window.addEventListener('node-selected', handleNodeSelectedForContext as EventListener);
    window.addEventListener('edge-selected', handleEdgeSelectedForContext as EventListener);
    window.addEventListener('selection-cleared', handleSelectionClearedForContext);

    // Listen for conversation deletion — clear KV cache so deleted data doesn't come back
    const handleConversationDeleted = (e: CustomEvent) => {
      const { wasActive } = e.detail || {};
      if (wasActive) {
        // Clear all chat KV keys for the current file
        try {
          kv.delete('chat', chatKey('messages'));
          kv.delete('chat', chatKey('parts'));
          kv.delete('chat', chatKey('artifacts'));
          kv.delete('chat', chatKey('reasoning'));
          kv.delete('chat', chatKey('checkpoints'));
          kv.delete('chat', chatKey('diagramCode'));
          kv.set('chat', chatKey('activeConversationId'), null);
          kv.flush();
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('conversation-deleted', handleConversationDeleted as EventListener);

    // Save chat state before page unload
    const handleBeforeUnload = () => {
      saveChatState();
      // Force-flush KV writes immediately so they aren't lost on refresh
      kv.flush();
      if (authStore.isLoggedIn && messages.length > dbSyncedMessageCount) {
        syncMessagesToDb();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Periodic DB sync every 60s to avoid data loss
    const periodicSyncInterval = setInterval(() => {
      if (authStore.isLoggedIn && messages.length > dbSyncedMessageCount) {
        syncMessagesToDb();
      }
    }, 60000);

    // Listen for file changes — handled by $effect below

    return () => {
      window.removeEventListener('node-selected', handleNodeSelectedForContext as EventListener);
      window.removeEventListener('edge-selected', handleEdgeSelectedForContext as EventListener);
      window.removeEventListener('selection-cleared', handleSelectionClearedForContext);
      window.removeEventListener(
        'conversation-deleted',
        handleConversationDeleted as EventListener
      );
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearInterval(periodicSyncInterval);
      if (dbSyncTimeout) clearTimeout(dbSyncTimeout);
      if (saveTimeout) clearTimeout(saveTimeout);
      if (autoFixTimeout) clearTimeout(autoFixTimeout);
      if (fileErrorTimeout) clearTimeout(fileErrorTimeout);
    };
  });

  function restoreChatStateForFile() {
    // Update sessionId for new file
    try {
      const saved = kv.get<string>('chat', chatKey('sessionId'));
      if (saved) {
        sessionId = saved;
      } else {
        const id = uuidv4();
        sessionId = id;
        kv.set('chat', chatKey('sessionId'), id);
      }
    } catch {
      /* ignore */
    }
    // Update DB conversation ID for new file
    dbConversationId = getDbConversationId();
    dbSyncedMessageCount = 0;
    // Restore from localStorage first
    restoreChatState();
    // Then try DB restore if logged in
    if (authStore.isLoggedIn && dbConversationId) {
      restoreChatFromDb().then((restored) => {
        if (restored) conversationStarted = messages.length > 0;
      });
    }
  }

  let isDataReady = $state(false);
  let messages: Record<string, unknown>[] = $state([]);
  let inputText = $state('');
  let fileError = $state<string | null>(null);
  let isLoading = $state(false);
  let conversationStarted = $state(false);
  let conversationTitle = $state<string | null>(null);

  // Checkpoint system: save diagram state before each user message
  interface Checkpoint {
    code: string;
    messageIndex: number;
  }
  let checkpoints = $state<Checkpoint[]>([]);

  // Context: track selected diagram elements for chat context
  let selectedContext = $state<{
    type: 'node' | 'edge' | null;
    label: string;
    ids: string[];
  }>({ type: null, label: '', ids: [] });
  function handleNodeSelectedForContext(e: CustomEvent) {
    const detail = e.detail || {};
    selectedContext = {
      type: 'node',
      label: detail.label || '',
      ids: detail.nodeIds || (detail.nodeId ? [detail.nodeId] : [])
    };
  }
  function handleEdgeSelectedForContext(e: CustomEvent) {
    const detail = e.detail || {};
    selectedContext = {
      type: 'edge',
      label: detail.label || '',
      ids: detail.edgeIds || (detail.edgeId ? [detail.edgeId] : [])
    };
  }
  function handleSelectionClearedForContext() {
    selectedContext = { type: null, label: '', ids: [] };
  }

  function restoreCheckpoint(messageIndex: number) {
    // Find the checkpoint for this user message
    const cp = checkpoints.find((c) => c.messageIndex === messageIndex);
    if (!cp) return;

    // Stop any ongoing streaming/conversation
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    isLoading = false;

    // Clear any active selection to prevent "Node cannot be found" errors
    // when the restored code has different elements than the current render
    window.dispatchEvent(new CustomEvent('selection-cleared'));

    // Restore diagram code with a single updateCodeStore call
    updateCodeStore({ code: cp.code, updateDiagram: true });

    // Put the user message text back in input
    const userMsg = messages[messageIndex];
    if (userMsg) {
      inputText = userMsg.content || '';
    }

    // Remove this message and all subsequent messages
    messages = messages.slice(0, messageIndex);

    // Clean up messageParts and artifactMap for removed messages
    const newParts: Record<number, ContentPart[]> = {};
    for (const [idx, parts] of Object.entries(messageParts)) {
      if (Number(idx) < messageIndex) {
        newParts[Number(idx)] = parts;
      }
    }
    messageParts = newParts;

    // Remove checkpoints at or after this index
    checkpoints = checkpoints.filter((c) => c.messageIndex < messageIndex);

    saveChatState();
  }

  let hoveredMessageIndex = $state<number | null>(null);

  // Per-message artifact tracking with unique IDs
  interface Artifact {
    id: string;
    code: string;
    previousCode: string;
    operation: 'create' | 'update' | 'patch' | 'delete' | 'read';
    isStreaming: boolean;
    title: string;
    language?: string;
    hasErrors?: boolean;
    errors?: string[];
    readFrom?: number;
    readTo?: number;
    totalLines?: number;
  }
  // Artifacts stored by ID for quick lookup
  let artifactMap = $state<Record<string, Artifact>>({});
  let artifactIdsByToolCall = $state<Record<string, string>>({});

  function getToolCallId(value: unknown): string {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
    if (currentToolCallId) return currentToolCallId;
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function getArtifactIdForToolCall(toolName: string, toolCallId: unknown): string {
    const callId = getToolCallId(toolCallId);
    const key = `${toolName}:${callId}`;
    const existing = artifactIdsByToolCall[key];
    if (existing) return existing;

    const safeToolName = toolName.replace(/[^a-z0-9_-]/gi, '-');
    const safeCallId = callId.replace(/[^a-z0-9_-]/gi, '-');
    const artifactId = `artifact-${safeToolName}-${safeCallId}`;
    artifactIdsByToolCall = { ...artifactIdsByToolCall, [key]: artifactId };
    return artifactId;
  }

  interface SubagentAssignment {
    allowedTools?: string[];
    completedAt?: string;
    durationMs?: number;
    events?: { at: string; label: string }[];
    id: string;
    modelId?: string;
    objective: string;
    ownedPaths?: string[];
    output?: string;
    prompt?: string;
    role: string;
    startedAt?: string;
    status?: string;
  }

  // Ordered content parts per assistant message: text, artifact refs, and reasoning in stream order
  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'thinking'; id: string }
    | { type: 'artifact'; artifactId: string }
    | { type: 'reasoning'; id: string; text: string; status: 'running' | 'done' }
    | { type: 'error'; error: string; userMessage?: string }
    | {
        type: 'questionnaire';
        id: string;
        context: string;
        questions: QuestionnaireQuestion[];
        isStreaming?: boolean;
        submitted?: boolean;
      }
    | {
        type: 'tool-status';
        id: string;
        toolName: string;
        status: 'running' | 'done';
        message?: string;
        details?: string[];
        subagents?: SubagentAssignment[];
        iconResults?: {
          nodeId: string;
          nodeText: string;
          status: 'added' | 'removed' | 'skipped';
          iconId?: string;
          iconUrl?: string;
          confidence?: number;
        }[];
        iconMode?: string;
        searchQuery?: string;
        searchReason?: string;
        searchResults?: { title: string; snippet: string; url?: string; source?: string }[];
      }
    | {
        type: 'markdown';
        id: string;
        content: string;
        operation: 'read' | 'write' | 'append';
        lines: number;
        isStreaming?: boolean;
      };

  type PatchChainPart = Extract<ContentPart, { type: 'artifact' }>;
  type DisplayContentPart =
    | ContentPart
    | {
        type: 'tool-chain';
        id: string;
        parts: PatchChainPart[];
        status: 'running' | 'done';
      };

  function messageKey(message: Record<string, unknown>, index: number) {
    return String(message.id ?? `${message.role ?? 'message'}:${message.timestamp ?? index}`);
  }

  function attachmentKey(attachment: Record<string, unknown>, index: number) {
    return String(
      attachment.fileId ??
        attachment.url ??
        `${attachment.filename ?? 'file'}:${attachment.size ?? ''}:${index}`
    );
  }

  function contentPartKey(part: DisplayContentPart, index: number) {
    if (part.type === 'tool-chain') return part.id;
    if (part.type === 'artifact') return part.artifactId;
    if ('id' in part) return part.id;
    if (part.type === 'text') return `text:${part.text.slice(0, 40)}:${index}`;
    if (part.type === 'error') return `error:${part.error}:${index}`;
    return `part:${index}`;
  }

  function isPatchChainPart(part: ContentPart): part is PatchChainPart {
    return part.type === 'artifact' && artifactMap[part.artifactId]?.title === 'Diagram Patch';
  }

  function chainDisplayParts(parts: ContentPart[]): DisplayContentPart[] {
    const chained: DisplayContentPart[] = [];
    let pending: PatchChainPart[] = [];

    const flushPending = () => {
      if (pending.length === 1) {
        chained.push(pending[0]);
      } else if (pending.length > 1) {
        const first = pending[0];
        const last = pending[pending.length - 1];
        chained.push({
          id: `tool-chain:${'id' in first ? first.id : first.artifactId}:${'id' in last ? last.id : last.artifactId}:${pending.length}`,
          parts: pending,
          status: pending.some((part) => toolPartStatus(part) === 'running') ? 'running' : 'done',
          type: 'tool-chain'
        });
      }
      pending = [];
    };

    for (const part of parts) {
      if (isPatchChainPart(part)) {
        pending.push(part);
      } else {
        flushPending();
        chained.push(part);
      }
    }
    flushPending();

    return chained;
  }

  function toolPartStatus(part: PatchChainPart): 'running' | 'done' {
    return artifactMap[part.artifactId]?.isStreaming ? 'running' : 'done';
  }

  function toolPartLabel(part: PatchChainPart): string {
    return artifactMap[part.artifactId]?.title || 'Artifact';
  }

  function toolPartSummary(part: PatchChainPart): string {
    const artifact = artifactMap[part.artifactId];
    if (!artifact) return 'artifact';
    const lines = artifact.code ? artifact.code.split('\n').length : 0;
    const operation = artifact.operation ? `${artifact.operation}` : 'update';
    return `${operation}${lines ? ` · ${lines} line${lines !== 1 ? 's' : ''}` : ''}`;
  }

  function toolPartDetails(part: PatchChainPart): string[] {
    const artifact = artifactMap[part.artifactId];
    if (!artifact?.code) return [];
    return artifact.code
      .split('\n')
      .slice(0, 8)
      .map((line, index) => `${index + 1}: ${line}`);
  }

  function isInternalReasoningStreamPart(data: { type?: string }): boolean {
    const type = data.type ?? '';
    return (
      type === 'thinking' ||
      type === 'thinking-start' ||
      type === 'thinking-delta' ||
      type === 'thinking-end'
    );
  }

  function removeThinkingPart(parts: ContentPart[]): ContentPart[] {
    return parts.filter((part) => part.type !== 'thinking');
  }

  function finalizeReasoningParts(parts: ContentPart[]): ContentPart[] {
    let changed = false;
    const finalized = parts.map((part) => {
      if (part.type === 'reasoning' && part.status === 'running') {
        changed = true;
        return { ...part, status: 'done' };
      }
      return part;
    });
    return changed ? finalized : parts;
  }

  interface QuestionnaireQuestion {
    id: string;
    text: string;
    type: 'single' | 'multi';
    options: { id: string; label: string }[];
  }

  function parseSubagentInput(input: string): {
    agents?: SubagentAssignment[];
    task?: string;
  } {
    try {
      const parsed = JSON.parse(input);
      return {
        agents: Array.isArray(parsed.agents) ? parsed.agents : undefined,
        task: typeof parsed.task === 'string' ? parsed.task : undefined
      };
    } catch {
      const taskMatch = input.match(/"task"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const roles = [...input.matchAll(/"role"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
      const objectives = [...input.matchAll(/"objective"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(
        (match) => match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
      );
      const ids = [...input.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((match) => match[1]);
      const agents = roles.map((role, index) => ({
        id: ids[index] || `agent-${index + 1}`,
        objective: objectives[index] || 'Preparing assignment…',
        role
      }));

      return {
        agents: agents.length > 0 ? agents : undefined,
        task: taskMatch?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, '\n')
      };
    }
  }

  let questionnaireResponses = $state<Record<string, Record<string, string | string[]>>>({});
  let messageParts = $state<Record<number, ContentPart[]>>({});

  // Tool streaming state
  let currentToolCallId = $state<string | null>(null);
  let currentToolName = $state('');
  let currentToolInputJson = $state('');
  let currentReasoningId = $state<string | null>(null);
  let streamCanvasTimer: ReturnType<typeof setTimeout> | null = null;
  let currentArtifactId = $state<string | null>(null);
  // Track whether the last part for the current message is text (to append to it)
  let lastPartWasText = $state(false);
  // lastPartWasReasoning tracking removed — was unused
  let isProcessingFiles = $state(false);
  let selectedModelId = $derived(modelsStore.selectedModelId);
  let modelSearchQuery = $state('');
  let modelPopoverOpen = $state(false);
  let filteredModels = $derived.by(() => {
    const q = modelSearchQuery.toLowerCase().trim();
    if (!q) return modelsStore.models;
    return modelsStore.models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q)
    );
  });

  // Group models by provider for the picker dropdown
  let groupedModels = $derived.by(() => {
    const groups: Record<string, typeof filteredModels> = {};
    for (const model of filteredModels) {
      const key = model.provider || 'Other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(model);
    }
    // Stable alpha order, with selected model's provider first if any
    const selectedProvider = modelsStore.selectedModel?.provider;
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === selectedProvider) return -1;
      if (b === selectedProvider) return 1;
      return a.localeCompare(b);
    });
  });

  function providerLabel(name: string): string {
    if (!name) return 'Other';
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  let messagesContainer: HTMLDivElement;
  let abortController: AbortController | null = $state(null);

  let selectedModel = $derived(modelsStore.selectedModel ?? modelsStore.models[0]);
  let attachmentAccept = $derived(
    `${selectedModel?.imageSupport ? 'image/*,' : ''}.pdf,.txt,.md,.markdown`
  );
  let hasMessages = $derived(messages.length > 0);
  let hasDiagram = $derived(($stateStore.code || '').trim().length > 20);

  // Contextual suggestions based on current state
  let suggestions = $derived.by(() => {
    if (hasDiagram) {
      return [
        {
          icon: Palette,
          label: 'Style it',
          prompt: 'Make the diagram visually stunning with colors, icons, and professional styling'
        },
        {
          icon: Plus,
          label: 'Expand',
          prompt: 'Add more nodes, connections, and detail to make the diagram more comprehensive'
        },
        {
          icon: FileText,
          label: 'Document',
          prompt: 'Write detailed documentation explaining this diagram in the document panel'
        },
        {
          icon: Search,
          label: 'Review',
          prompt: 'Review this diagram for completeness, best practices, and suggest improvements'
        },
        {
          icon: RefreshCw,
          label: 'Convert',
          prompt: 'Convert this diagram to a different type while preserving the information'
        },
        {
          icon: Wrench,
          label: 'Fix errors',
          prompt: 'Check this diagram for syntax errors and fix any issues found'
        }
      ];
    }
    return [
      {
        icon: Building2,
        label: 'System Architecture',
        prompt:
          'Design a cloud architecture diagram with microservices, databases, load balancers, and message queues'
      },
      {
        icon: RefreshCw,
        label: 'User Flow',
        prompt:
          'Create a user authentication flow with login, signup, password reset, and OAuth options'
      },
      {
        icon: Database,
        label: 'Database Schema',
        prompt:
          'Design an ER diagram for an e-commerce platform with users, products, orders, and payments'
      },
      {
        icon: Brain,
        label: 'Mind Map',
        prompt: 'Create a mind map brainstorming ideas for a startup product launch strategy'
      },
      {
        icon: Zap,
        label: 'CI/CD Pipeline',
        prompt:
          'Build a CI/CD pipeline diagram showing code commit to production deployment with testing stages'
      },
      {
        icon: Smartphone,
        label: 'App Screens',
        prompt:
          'Create a sequence diagram showing how a mobile app communicates with backend APIs and third-party services'
      }
    ];
  });

  let chatStatus = $derived<'idle' | 'submitted' | 'streaming' | 'error'>(
    isLoading ? 'streaming' : 'idle'
  );

  // Audio recording state
  let isRecording = $state(false);
  let mediaRecorder = $state<MediaRecorder | null>(null);
  let audioChunks = $state<Blob[]>([]);
  let isTranscribing = $state(false);

  async function startRecording() {
    try {
      // Check if microphone permission is available
      if (navigator.permissions) {
        try {
          const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          if (perm.state === 'denied') {
            alert(
              'Microphone access is blocked. Please allow microphone access in your browser settings.'
            );
            return;
          }
        } catch {
          // permissions.query may not support 'microphone' in all browsers — continue
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (audioChunks.length === 0) return;
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        await transcribeAudio(audioBlob);
      };
      recorder.start();
      mediaRecorder = recorder;
      isRecording = true;
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)) || '';
      if (msg.includes('Permission') || msg.includes('NotAllowedError') || msg.includes('policy')) {
        alert(
          'Microphone access is not available. This may be blocked by your browser or site permissions policy. Please check your browser settings.'
        );
      } else {
        console.error('Microphone error:', e);
      }
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isRecording = false;
    mediaRecorder = null;
  }

  async function transcribeAudio(blob: Blob) {
    isTranscribing = true;
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');
      const res = await fetch('/api/audio', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        if (data.text) {
          inputText = (inputText ? inputText + ' ' : '') + data.text;
        }
      }
    } catch (e) {
      console.error('Transcription failed:', e);
    }
    isTranscribing = false;
  }

  // Context usage tracking
  const FALLBACK_CONTEXT_WINDOW = 128000;
  let contextWindow = $derived(
    selectedModel?.contextWindow || selectedModel?.maxTokens || FALLBACK_CONTEXT_WINDOW
  );
  let estimatedTokens = $derived.by(() => {
    let total = 0;
    for (const msg of messages) {
      const content = String(msg.contextContent || msg.content || '');
      total += Math.ceil(content.length / 3.5);
    }
    // Add current diagram code tokens
    const diagramCode = $stateStore.code || '';
    total += Math.ceil(diagramCode.length / 3.5);
    return total;
  });
  let contextPercent = $derived(Math.min(100, Math.round((estimatedTokens / contextWindow) * 100)));
  let contextTitle = $derived(
    `${estimatedTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens (${contextPercent}% used)${
      selectedModel?.name ? ` · ${selectedModel.name}` : ''
    }`
  );

  // Save chat state to localStorage (full state including artifacts) — per-file
  function saveChatState(fileId = currentFileId) {
    try {
      // Save messages (include attachments for user messages)
      const simpleMessages = messages.map((m: Record<string, unknown>) => {
        const msg: Record<string, unknown> = { id: m.id, role: m.role, content: m.content };
        if (m.contextContent) msg.contextContent = m.contextContent;
        if (m.model_used) msg.model_used = m.model_used;
        if ((m.attachments as Record<string, unknown>[] | undefined)?.length) {
          msg.attachments = (m.attachments as Record<string, unknown>[]).map(
            (a: Record<string, unknown>) => ({
              ext: a.ext,
              fileId: a.fileId,
              filename: a.filename,
              mediaType: a.mediaType,
              size: a.size,
              type: a.type,
              url: (a.mediaType as string)?.startsWith('image/') ? a.url : null
            })
          );
        }
        if (m.timestamp) msg.timestamp = m.timestamp;
        return msg;
      });
      kv.set('chat', chatKey('messages', fileId), simpleMessages);
      const diagramId = getDiagramIdFromFileId(fileId);
      const workspaceMessages = simpleMessages.map((message: Record<string, unknown>) => ({
        content: String(message.content ?? ''),
        id: String(message.id ?? uuidv4()),
        model_used: message.model_used as string | undefined,
        role: (message.role as 'user' | 'assistant' | 'system') ?? 'user',
        timestamp: String(message.timestamp ?? new Date().toISOString())
      }));
      if (diagramId) {
        workspaceStore.setDiagramChatMessages(diagramId, workspaceMessages);
      } else {
        workspaceStore.setActiveDiagramChatMessages(workspaceMessages);
      }
      // Save message parts, excluding provider reasoning/internal thoughts.
      const allParts: Record<number, ContentPart[]> = {};
      for (const [idx, parts] of Object.entries(messageParts)) {
        allParts[Number(idx)] = (parts as ContentPart[])
          .filter((p: ContentPart) => p.type !== 'reasoning' && p.type !== 'thinking')
          .map((p: ContentPart) => {
            if (p.type === 'text') return { type: 'text', text: p.text };
            if (p.type === 'artifact') return { type: 'artifact', artifactId: p.artifactId };
            if (p.type === 'error') return { type: 'error', error: p.error };
            return p;
          });
      }
      kv.set('chat', chatKey('parts', fileId), allParts);
      // Save artifacts (only finalized, non-streaming)
      const savedArtifacts: Record<string, Artifact> = {};
      for (const [id, art] of Object.entries(artifactMap)) {
        if (!art.isStreaming) {
          savedArtifacts[id] = { ...art, isStreaming: false };
        }
      }
      kv.set('chat', chatKey('artifacts', fileId), savedArtifacts);
      kv.delete('chat', chatKey('reasoning', fileId));
      // Save checkpoints
      kv.set('chat', chatKey('checkpoints', fileId), checkpoints);
      // Only the active editor store can safely provide source for the active tab.
      if (fileId === getCurrentFileId()) {
        try {
          const currentCode = (
            inputStateStore as unknown as { get?: () => Record<string, unknown> }
          )?.get?.()?.code;
          if (!currentCode) {
            let storeVal: Record<string, unknown> | null = null;
            const unsub = inputStateStore.subscribe((s: Record<string, unknown>) => {
              storeVal = s;
            });
            unsub();
            if (storeVal?.code) kv.set('chat', chatKey('diagramCode', fileId), storeVal.code);
          } else {
            kv.set('chat', chatKey('diagramCode', fileId), currentCode);
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Restore chat state from localStorage — per-file
  function restoreChatState() {
    // Reset state first
    messages = [];
    messageParts = {};
    artifactMap = {};
    checkpoints = [];
    conversationStarted = false;
    conversationTitle = null;
    try {
      const savedMessages = kv.get<Record<string, unknown>[]>('chat', chatKey('messages'));
      const savedParts = kv.get<Record<number, ContentPart[]>>('chat', chatKey('parts'));
      const savedArtifacts = kv.get<Record<string, Artifact>>('chat', chatKey('artifacts'));
      kv.delete('chat', chatKey('reasoning'));
      const activeTabMessages: Record<string, unknown>[] = (
        getActiveWorkspaceTab()?.chat?.messages ?? []
      ).map((message) => ({ ...message }));
      const restoredMessages: Record<string, unknown>[] =
        savedMessages && Array.isArray(savedMessages) && savedMessages.length > 0
          ? savedMessages
          : activeTabMessages;
      if (restoredMessages && Array.isArray(restoredMessages) && restoredMessages.length > 0) {
        messages = restoredMessages;
        conversationStarted = true;
        if (savedParts) {
          messageParts = Object.fromEntries(
            Object.entries(savedParts).map(([idx, parts]) => [
              idx,
              (parts as ContentPart[]).filter(
                (part) => part.type !== 'reasoning' && part.type !== 'thinking'
              )
            ])
          );
        } else {
          // Rebuild simple text parts from messages
          const parts: Record<number, ContentPart[]> = {};
          restoredMessages.forEach((m: Record<string, unknown>, i: number) => {
            if (m.role === 'assistant' && m.content) {
              parts[i] = [{ type: 'text', text: m.content as string }];
            }
          });
          messageParts = parts;
        }
        // Restore artifacts
        if (savedArtifacts) {
          artifactMap = savedArtifacts;
        }
        // Restore checkpoints
        const savedCheckpoints = kv.get<Checkpoint[]>('chat', chatKey('checkpoints'));
        if (savedCheckpoints) {
          checkpoints = savedCheckpoints;
        }
        // Restore diagram code to canvas
        const savedDiagramCode = kv.get<string>('chat', chatKey('diagramCode'));
        if (savedDiagramCode && savedDiagramCode.trim()) {
          inputStateStore.update((s) => ({ ...s, code: savedDiagramCode, updateDiagram: true }));
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Exported methods for parent component access via bind:this
  export function clearChat() {
    messages = [];
    messageParts = {};
    artifactMap = {};
    inputText = '';
    isLoading = false;
    abortController = null;
    conversationStarted = false;
    conversationTitle = null;
    // Reset DB sync state
    setDbConversationId(null);
    dbSyncedMessageCount = 0;
    // Clear persisted state for current file
    try {
      clearCurrentFileChatCache();
      const newId = uuidv4();
      sessionId = newId;
      kv.set('chat', chatKey('sessionId'), newId);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('conversation-cleared'));
  }

  // New Chat: save current conversation first, then start fresh
  export async function newChat() {
    // Save current conversation state before clearing
    if (conversationStarted && messages.length > 0) {
      saveChatState();
      kv.flush();
      if (authStore.isLoggedIn) {
        await syncMessagesToDb();
      }
    }
    // Reset all state for a fresh conversation
    messages = [];
    messageParts = {};
    artifactMap = {};
    inputText = '';
    isLoading = false;
    abortController = null;
    conversationStarted = false;
    conversationTitle = null;
    checkpoints = [];
    // Create new session
    const newId = uuidv4();
    sessionId = newId;
    setDbConversationId(null);
    dbSyncedMessageCount = 0;
    try {
      kv.set('chat', chatKey('sessionId'), newId);
      // Clear persisted state so restore doesn't bring back old data
      clearCurrentFileChatCache();
    } catch {
      /* ignore */
    }
    // Persist the active conversation ID as null (new chat)
    try {
      kv.delete('chat', chatKey('activeConversationId'));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('conversation-cleared'));
  }

  // Load a specific conversation from DB by its ID
  export async function loadConversation(convId: string) {
    if (!convId) return;
    // Save current state first
    if (conversationStarted && messages.length > 0) {
      saveChatState();
      kv.flush();
      if (authStore.isLoggedIn) {
        await syncMessagesToDb();
      }
    }
    // Reset state
    messages = [];
    messageParts = {};
    artifactMap = {};
    checkpoints = [];
    inputText = '';
    isLoading = false;
    abortController = null;
    conversationStarted = false;
    conversationTitle = null;
    dbSyncedMessageCount = 0;
    // Set the DB conversation ID and try to load
    setDbConversationId(convId);
    // Persist active conversation ID so it survives refresh
    try {
      kv.set('chat', chatKey('activeConversationId'), convId);
    } catch {
      /* ignore */
    }
    // Generate a new session ID for this conversation
    const newId = uuidv4();
    sessionId = newId;
    try {
      kv.set('chat', chatKey('sessionId'), newId);
    } catch {
      /* ignore */
    }
    // Load messages from DB
    try {
      const res = await fetch(`/api/conversations/messages?conversation_id=${convId}`, {
        credentials: 'include'
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.messages || data.messages.length === 0) return;
      applyDbMessages(convId, data.messages as DbMessageRow[]);
      // Save to KV so it persists on refresh
      saveChatState();
      // Scroll to bottom after loading
      await tick();
      scrollToBottom();
    } catch {
      /* ignore */
    }
  }

  export async function sendMessageExternal(
    text: string,
    options?: { isRepair?: boolean }
  ): Promise<boolean> {
    if (!text.trim() || isLoading) return false;
    handleSubmit({ text }, options?.isRepair);
    return true;
  }

  function stopStream() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    isLoading = false;
  }

  let isImprovingPrompt = $state(false);
  let promptEnhancerModel = $state('google/gemini-2.0-flash-001');

  // Fetch admin-configured prompt enhancer model from public settings API
  async function loadPromptEnhancerModel() {
    try {
      const res = await fetch('/api/app-settings?category=prompt_enhancer');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data?.model) {
          promptEnhancerModel = data.data.model;
        }
      }
    } catch {
      /* ignore */
    }
  }

  async function improvePrompt() {
    const raw = inputText.trim();
    if (!raw || isImprovingPrompt) return;
    isImprovingPrompt = true;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentDiagram: '',
          currentMarkdown: '',
          enabledTools: [],
          isRepair: false,
          message: `Improve this prompt for a Mermaid diagram AI assistant. Make it clearer, more specific, and actionable. Return ONLY the improved prompt text, nothing else. No quotes, no explanation.\n\nOriginal: ${raw}`,
          messages: [],
          model: promptEnhancerModel,
          sessionId: `improve-${Date.now()}`
        })
      });
      if (!res.ok) {
        isImprovingPrompt = false;
        return;
      }
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let improved = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'text-delta' || data.type === 'content_block_delta') {
                improved += data.content || data.delta || data.textDelta || '';
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
      if (improved.trim()) inputText = improved.trim();
    } catch (e) {
      console.error('Improve prompt failed:', e);
    }
    isImprovingPrompt = false;
  }

  function retryMessage(userText: string) {
    inputText = userText;
    tick().then(() => {
      handleSubmit({ text: userText });
    });
  }

  // Throttled scroll using rAF to avoid excessive calls during streaming
  let scrollRafId: number | null = null;
  let showScrollButton = $state(false);

  function scrollToBottom() {
    if (scrollRafId) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      tick().then(() => {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      });
    });
  }

  function handleMessagesScroll() {
    if (!messagesContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
    showScrollButton = scrollHeight - scrollTop - clientHeight > 100;
  }

  // Debounced save to avoid serializing on every SSE event
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  let autoFixTimeout: ReturnType<typeof setTimeout> | null = null;
  let fileErrorTimeout: ReturnType<typeof setTimeout> | null = null;
  function debouncedSaveChatState() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveChatState();
      debouncedDbSync();
      saveTimeout = null;
    }, 200);
  }

  function handleQuestionnaireSubmit(
    qId: string,
    questions: QuestionnaireQuestion[],
    context: string,
    assistantIdx: number
  ) {
    // Mark questionnaire as submitted in UI
    const parts = messageParts[assistantIdx] || [];
    const qIdx = parts.findIndex((p: ContentPart) => p.type === 'questionnaire' && p.id === qId);
    if (qIdx >= 0) {
      parts[qIdx] = { ...parts[qIdx], submitted: true } as ContentPart;
      messageParts[assistantIdx] = [...parts];
    }

    const responses = questionnaireResponses[qId] || {};
    let responseText = context ? `Context: ${context}\n\n` : '';
    responseText += 'Here are my answers:\n';
    for (const q of questions) {
      const answer = responses[q.id];
      const answerText = Array.isArray(answer) ? answer.join(', ') : answer || 'No answer';
      responseText += `- ${q.text}: ${answerText}\n`;
    }
    handleSubmit({ text: responseText.trim() });
  }

  // Upload a file and return processed result
  async function uploadFile(file: {
    url?: string;
    mediaType?: string;
    filename?: string;
  }): Promise<{
    url: string | null;
    mediaType: string;
    filename: string;
    type: string;
    extractedText?: string;
    fileId?: string;
    size?: number;
    pageCount?: number;
  } | null> {
    try {
      if (!file.url) return null;
      // Fetch the blob from the data URL or blob URL
      const response = await fetch(file.url);
      const blob = await response.blob();
      const formData = new FormData();
      formData.append('file', blob, file.filename || 'attachment');
      formData.append('sessionId', sessionId);
      formData.append('supportsImages', selectedModel?.imageSupport ? 'true' : 'false');
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const message = await res.text().catch(() => '');
        console.error('Upload failed:', res.status, message);
        if (message) {
          fileError = message;
        }
        return null;
      }
      const result = await res.json();
      // Notify session files store for sidebar display
      if (result?.fileId) {
        // session files removed — file tracking handled by workspace
      }
      return result;
    } catch (err) {
      console.error('Upload error:', err);
      return null;
    }
  }

  async function handleSubmit(message: PromptInputMessage, isRepair = false) {
    const text = message.text?.trim() || '';
    const files = message.files || [];
    if ((!text && files.length === 0) || isLoading || isProcessingFiles || !selectedModel) return;

    // Soft auth check — prompt login if not signed in
    if (!authStore.isLoggedIn) {
      messages = [
        ...messages,
        { id: uuidv4(), role: 'user', content: text },
        {
          id: uuidv4(),
          role: 'assistant',
          content:
            '🔒 **Please sign in to continue.** You need to be logged in to use the AI assistant. Click the user icon in the top-right to sign in or create an account.'
        }
      ];
      window.dispatchEvent(new CustomEvent('open-auth-modal'));
      inputText = '';
      return;
    }

    // --- Process files FIRST (lock send button) ---
    let fileContents: Record<string, unknown>[] = [];
    if (files.length > 0) {
      isProcessingFiles = true;
      try {
        const results = await Promise.all(files.map(uploadFile));
        fileContents = results.filter(Boolean) as Record<string, unknown>[];
      } catch (err) {
        console.error('File processing error:', err);
      }
      isProcessingFiles = false;
      if (fileContents.length !== files.length) {
        fileError =
          fileError ||
          'One or more attachments could not be processed. Use Markdown, text, PDF, or an image with a vision-capable model.';
        if (!text && fileContents.length === 0) return;
      }
    }

    // Save checkpoint: capture diagram state before this user message
    const currentCode = $stateStore.code || '';
    let diagramMutationSucceeded = false;
    let diagramPreviewApplied = false;
    let streamFinished = false;
    const userMsgIndex = messages.length;
    checkpoints = [...checkpoints, { code: currentCode, messageIndex: userMsgIndex }];

    const restoreUncommittedDiagramPreview = () => {
      if (!diagramPreviewApplied || diagramMutationSucceeded) return;
      inputStateStore.update((s) => ({
        ...s,
        code: currentCode,
        updateDiagram: getActiveWorkspaceEngine() === 'mermaid'
      }));
      workspaceStore.markDirty();
      diagramPreviewApplied = false;
    };

    // Build context prefix if elements are selected
    let contextPrefix = '';
    if (selectedContext.type && selectedContext.ids.length > 0) {
      const names = selectedContext.ids.map((id) => svgIdToNodeName(id)).join(', ');
      contextPrefix = `[Context: selected ${selectedContext.type}${selectedContext.ids.length > 1 ? 's' : ''}: ${names}] `;
    }

    // Helper to get file extension
    const getExt = (name: string) => {
      const parts = name.split('.');
      return parts.length > 1 ? (parts.pop() ?? '?').toUpperCase() : '?';
    };

    const userMessage: Record<string, unknown> = {
      id: uuidv4(),
      role: 'user',
      content: text || '',
      timestamp: Date.now()
    };
    // Store attachments for display — merge upload results for richer metadata
    if (files.length > 0) {
      userMessage.attachments = files.map((f: Record<string, unknown>, idx: number) => {
        const uploaded = fileContents[idx];
        return {
          ext: getExt(f.filename || 'file'),
          fileId: uploaded?.fileId || null,
          filename: f.filename || 'file',
          mediaType: f.mediaType || '',
          pageCount: uploaded?.pageCount || null,
          size: uploaded?.size || 0,
          type: uploaded?.type || 'unknown',
          url: f.url || null
        };
      });
    }

    // Build the message content with attachment context before it is persisted.
    let fullMessage = contextPrefix + (text || '');
    for (const fc of fileContents) {
      if (fc.extractedText) {
        fullMessage += `\n\n--- Attached file: ${fc.filename} ---\n${fc.extractedText}\n--- End of ${fc.filename} ---`;
      }
    }
    userMessage.contextContent = fullMessage;

    messages = [...messages, userMessage];
    inputText = '';
    isLoading = true;

    // Auto-create conversation on first message
    if (!conversationStarted) {
      conversationStarted = true;
      const attachmentTitle =
        fileContents.length > 0
          ? `Attachment: ${fileContents.map((file) => file.filename).join(', ')}`
          : 'New chat';
      conversationTitle = text
        ? text.length > 50
          ? `${text.slice(0, 50)}…`
          : text
        : attachmentTitle;
      window.dispatchEvent(
        new CustomEvent('conversation-created', {
          detail: { sessionId, title: conversationTitle }
        })
      );
    }
    currentToolCallId = null;
    currentToolName = '';
    currentToolInputJson = '';
    currentReasoningId = null;
    currentArtifactId = null;
    artifactIdsByToolCall = {};
    lastPartWasText = false;
    scrollToBottom();

    const assistantMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      model_used: selectedModelId
    };
    messages = [...messages, assistantMessage];
    const assistantIndex = messages.length - 1;
    messageParts[assistantIndex] = [{ type: 'thinking', id: `thinking-${assistantMessage.id}` }];

    abortController = new AbortController();

    const sendRequest = () => {
      const activeDbConversationId = dbConversationId;
      const activeTab = getActiveWorkspaceTab();
      const activeEngine = getActiveWorkspaceEngine();
      return fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeTabEngine: activeEngine,
          activeTabId: activeTab?.id,
          activeTabName: activeTab?.title,
          conversationId: activeDbConversationId,
          currentCode: $stateStore.code,
          currentDiagram: activeEngine === 'mermaid' ? $stateStore.code : '',
          currentMarkdown: documentMarkdownStore.value,
          enabledTools: toolsStore.getEnabledToolIds(),
          engine: activeEngine,
          isRepair,
          message: fullMessage,
          messages: messages
            .slice(0, -1)
            .filter(
              (m: Record<string, unknown>) =>
                m.role === 'user' || (m.role === 'assistant' && m.content)
            )
            .map((m: Record<string, unknown>) => ({
              role: m.role,
              content: m.contextContent || m.content
            })),
          model: selectedModelId,
          sessionId: sessionId,
          workspaceTabs: workspaceStore.diagrams.map((tab) => ({
            engine: tab.engine,
            id: tab.id,
            title: tab.title
          }))
        }),
        signal: abortController?.signal
      });
    };

    ensureDbConversation()
      .then(() => sendRequest())
      .then(async (res) => {
        if (!res.ok) {
          // Try to parse error body for specific messages
          let errMsg = `API error ${res.status}`;
          try {
            const errBody = await res.json();
            errMsg = errBody?.message || errBody?.error || errMsg;
            if (
              errMsg.toLowerCase().includes('insufficient gems') ||
              errMsg.toLowerCase().includes('out of gems')
            ) {
              const parts = messageParts[assistantIndex] || [];
              parts.push({
                type: 'error',
                error: '💎 Insufficient gems. Please add more gems to continue.',
                userMessage: text
              });
              messageParts[assistantIndex] = [...parts];
              isLoading = false;
              abortController = null;
              window.dispatchEvent(new CustomEvent('open-refill-gems'));
              scrollToBottom();
              return;
            }
          } catch {
            /* ignore */
          }
          throw new Error(errMsg);
        }

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim() && line.startsWith('data: ')) {
                const dataStr = line.substring(6).trim();
                if (dataStr === '[DONE]') continue;

                try {
                  const data = JSON.parse(dataStr);

                  if (
                    (data.type === 'content' || data.type === 'text-delta') &&
                    (data.content || data.delta || data.textDelta)
                  ) {
                    const content = data.content || data.delta || data.textDelta || '';
                    // Append to last text part, or create a new text part
                    const parts = removeThinkingPart(messageParts[assistantIndex] || []);
                    if (
                      lastPartWasText &&
                      parts.length > 0 &&
                      parts[parts.length - 1].type === 'text'
                    ) {
                      (parts[parts.length - 1] as { type: 'text'; text: string }).text += content;
                    } else {
                      parts.push({ type: 'text', text: content });
                      lastPartWasText = true;
                    }
                    messageParts[assistantIndex] = [...parts];
                    // Update message content in-place for performance (avoid .map on every token)
                    if (messages[assistantIndex]) {
                      messages[assistantIndex] = {
                        ...messages[assistantIndex],
                        content: (messages[assistantIndex].content || '') + content
                      };
                      messages = messages;
                    }
                    scrollToBottom();
                  } else if (data.type === 'reasoning-start') {
                    const parts = removeThinkingPart(messageParts[assistantIndex] || []);
                    const reasoningId = `reasoning-${data.id || currentToolCallId || Date.now()}`;
                    currentReasoningId = reasoningId;
                    if (
                      !parts.some((part) => part.type === 'reasoning' && part.id === reasoningId)
                    ) {
                      parts.push({
                        id: reasoningId,
                        status: 'running',
                        text: '',
                        type: 'reasoning'
                      });
                    }
                    messageParts[assistantIndex] = [...parts];
                    lastPartWasText = false;
                    scrollToBottom();
                  } else if (data.type === 'reasoning-delta') {
                    const reasoningId = data.id
                      ? `reasoning-${data.id}`
                      : (currentReasoningId ?? `reasoning-${currentToolCallId || Date.now()}`);
                    currentReasoningId = reasoningId;
                    const parts = removeThinkingPart(messageParts[assistantIndex] || []);
                    const idx = parts.findIndex(
                      (part) => part.type === 'reasoning' && part.id === reasoningId
                    );
                    const delta = data.delta || '';
                    if (idx >= 0 && parts[idx].type === 'reasoning') {
                      const currentText = parts[idx].text || '';
                      parts[idx] = {
                        ...parts[idx],
                        text: `${currentText}${delta}`
                      };
                    } else {
                      parts.push({
                        id: reasoningId,
                        status: 'running',
                        text: delta,
                        type: 'reasoning'
                      });
                    }
                    messageParts[assistantIndex] = [...parts];
                    lastPartWasText = false;
                    scrollToBottom();
                  } else if (data.type === 'reasoning-end') {
                    const reasoningId = data.id
                      ? `reasoning-${data.id}`
                      : (currentReasoningId ?? `reasoning-${currentToolCallId || Date.now()}`);
                    const parts = messageParts[assistantIndex] || [];
                    const idx = parts.findIndex(
                      (part) => part.type === 'reasoning' && part.id === reasoningId
                    );
                    if (idx >= 0 && parts[idx].type === 'reasoning') {
                      parts[idx] = { ...parts[idx], status: 'done' };
                      messageParts[assistantIndex] = [...parts];
                    }
                    currentReasoningId = null;
                    lastPartWasText = false;
                    scrollToBottom();
                  } else if (isInternalReasoningStreamPart(data)) {
                    // Provider-specific hidden thinking markers are not user-visible.
                    lastPartWasText = false;
                  } else if (data.type === 'tool-input-start') {
                    messageParts[assistantIndex] = removeThinkingPart(
                      messageParts[assistantIndex] || []
                    );
                    currentToolCallId = data.toolCallId;
                    currentToolName = data.toolName || '';
                    currentToolInputJson = '';
                    lastPartWasText = false;

                    const opMap: Record<string, Artifact['operation']> = {
                      codePatch: 'patch',
                      codeRead: 'read',
                      codeWrite: 'create',
                      diagramDelete: 'delete',
                      diagramPatch: 'patch',
                      diagramRead: 'read',
                      diagramWrite: 'create'
                    };
                    const op = opMap[currentToolName] || 'update';
                    const titleMap: Record<string, string> = {
                      codePatch: 'Code Patch',
                      codeRead: 'Code Read',
                      codeWrite: 'Code Write',
                      diagramDelete: 'Diagram Delete',
                      diagramPatch: 'Diagram Patch',
                      diagramRead: 'Diagram Read',
                      diagramWrite: 'Diagram Write'
                    };

                    if (
                      currentToolName === 'diagramWrite' ||
                      currentToolName === 'diagramPatch' ||
                      currentToolName === 'codeWrite' ||
                      currentToolName === 'codePatch'
                    ) {
                      currentArtifactId = getArtifactIdForToolCall(
                        currentToolName,
                        currentToolCallId
                      );
                      const prevCode =
                        currentToolName === 'codeWrite' || currentToolName === 'codePatch'
                          ? artifactMap[currentArtifactId]?.code || ''
                          : $stateStore.code || '';
                      const parts = messageParts[assistantIndex] || [];
                      artifactMap[currentArtifactId] = {
                        code: '',
                        errors: undefined,
                        hasErrors: false,
                        id: currentArtifactId,
                        isStreaming: true,
                        language:
                          currentToolName === 'codeWrite' || currentToolName === 'codePatch'
                            ? artifactMap[currentArtifactId]?.language || 'text'
                            : 'mermaid',
                        operation: op,
                        previousCode: prevCode,
                        title: titleMap[currentToolName] || 'Processing'
                      };
                      artifactMap = { ...artifactMap };
                      if (
                        !parts.some(
                          (part) =>
                            part.type === 'artifact' && part.artifactId === currentArtifactId
                        )
                      ) {
                        parts.push({ type: 'artifact', artifactId: currentArtifactId });
                        messageParts[assistantIndex] = [...parts];
                      }
                      scrollToBottom();
                    } else if (currentToolName === 'askQuestions') {
                      // Show streaming questionnaire placeholder immediately
                      const qId = `q-${currentToolCallId || Date.now()}`;
                      const parts = messageParts[assistantIndex] || [];
                      parts.push({
                        context: '',
                        id: qId,
                        isStreaming: true,
                        questions: [],
                        type: 'questionnaire'
                      });
                      messageParts[assistantIndex] = [...parts];
                      questionnaireResponses[qId] = {};
                      scrollToBottom();
                    } else if (currentToolName === 'codeRead') {
                      const aid = getArtifactIdForToolCall(currentToolName, currentToolCallId);
                      currentArtifactId = aid;
                      const parts = messageParts[assistantIndex] || [];
                      artifactMap[aid] = {
                        code: '',
                        id: aid,
                        isStreaming: true,
                        language: 'text',
                        operation: 'read',
                        previousCode: '',
                        title: 'Reading Code'
                      };
                      artifactMap = { ...artifactMap };
                      parts.push({ type: 'artifact', artifactId: aid });
                      messageParts[assistantIndex] = [...parts];
                      scrollToBottom();
                    } else if (
                      currentToolName === 'markdownWrite' ||
                      currentToolName === 'markdownRead'
                    ) {
                      // Show streaming markdown card immediately
                      const mdId = `md-${currentToolCallId || Date.now()}`;
                      const parts = messageParts[assistantIndex] || [];
                      parts.push({
                        content: '',
                        id: mdId,
                        isStreaming: true,
                        lines: 0,
                        operation: currentToolName === 'markdownRead' ? 'read' : 'write',
                        type: 'markdown'
                      });
                      messageParts[assistantIndex] = [...parts];
                      scrollToBottom();
                    } else if (currentToolName === 'diagramRead') {
                      // diagramRead creates its artifact card in tool-output-available, skip generic status
                    } else {
                      // Generic tool-status UI for all other tools
                      const statusId = `status-${currentToolCallId}`;
                      const parts = messageParts[assistantIndex] || [];
                      parts.push({
                        id: statusId,
                        message: currentToolName,
                        status: 'running',
                        toolName: currentToolName,
                        type: 'tool-status'
                      });
                      messageParts[assistantIndex] = [...parts];
                      scrollToBottom();
                    }
                  } else if (data.type === 'tool-input-delta') {
                    currentToolInputJson += data.inputTextDelta || '';

                    // Handle webSearch — parse query/reason from streaming JSON to show what's being searched
                    if (currentToolName === 'webSearch') {
                      const queryMatch = currentToolInputJson.match(
                        /"query"\s*:\s*"((?:[^"\\]|\\.)*)"/
                      );
                      const reasonMatch = currentToolInputJson.match(
                        /"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/
                      );
                      if (queryMatch) {
                        const statusId = `status-${currentToolCallId}`;
                        const parts = messageParts[assistantIndex] || [];
                        const idx = parts.findIndex(
                          (p: ContentPart) => p.type === 'tool-status' && p.id === statusId
                        );
                        if (idx >= 0) {
                          const q = queryMatch[1].replace(/\\"/g, '"');
                          const r = reasonMatch?.[1]?.replace(/\\"/g, '"');
                          parts[idx] = {
                            ...parts[idx],
                            message: r || `Searching: "${q}"`,
                            searchQuery: q,
                            searchReason: r
                          } as ContentPart;
                          messageParts[assistantIndex] = [...parts];
                        }
                      }
                      // Handle askQuestions — progressively stream questions as JSON arrives
                    } else if (currentToolName === 'askQuestions') {
                      const qId = `q-${currentToolCallId || Date.now()}`;
                      const parts = messageParts[assistantIndex] || [];
                      const qIdx = parts.findIndex(
                        (p: ContentPart) => p.type === 'questionnaire' && p.id === qId
                      );
                      if (qIdx >= 0) {
                        // Try to parse partial context
                        const ctxMatch = currentToolInputJson.match(
                          /"context"\s*:\s*"((?:[^"\\]|\\.)*)"/
                        );
                        const partialCtx = ctxMatch
                          ? ctxMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')
                          : '';

                        // Try to parse partial questions array — extract as many complete question objects as possible
                        let partialQuestions: QuestionnaireQuestion[] = [];
                        const qArrMatch = currentToolInputJson.match(
                          /"questions"\s*:\s*\[([\s\S]*)/
                        );
                        if (qArrMatch) {
                          const qArrStr = qArrMatch[1];
                          // Find each complete question object by matching balanced braces
                          const objRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
                          let match;
                          while ((match = objRegex.exec(qArrStr)) !== null) {
                            try {
                              const qObj = JSON.parse(match[0]);
                              if (qObj.id && qObj.text) {
                                partialQuestions.push({
                                  id: qObj.id,
                                  text: qObj.text,
                                  type: qObj.type || 'single',
                                  options: qObj.options || []
                                });
                              }
                            } catch {
                              /* incomplete object */
                            }
                          }
                        }

                        parts[qIdx] = {
                          ...parts[qIdx],
                          context: partialCtx,
                          questions: partialQuestions,
                          isStreaming: true
                        } as ContentPart;
                        messageParts[assistantIndex] = [...parts];
                        scrollToBottom();
                      }
                    } else if (currentToolName === 'markdownWrite') {
                      // Delta-based streaming: parse content field and stream incrementally
                      const mdId = `md-${currentToolCallId || Date.now()}`;
                      const parts = messageParts[assistantIndex] || [];
                      const mdIdx = parts.findIndex(
                        (p: ContentPart) => p.type === 'markdown' && p.id === mdId
                      );
                      if (mdIdx >= 0) {
                        // Extract content from accumulated JSON
                        const contentMatch = currentToolInputJson.match(
                          /"content"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/
                        );
                        if (contentMatch) {
                          const rawMd = contentMatch[1]
                            .replace(/\\n/g, '\n')
                            .replace(/\\t/g, '\t')
                            .replace(/\\"/g, '"')
                            .replace(/\\\\/g, '\\');
                          parts[mdIdx] = {
                            ...parts[mdIdx],
                            content: rawMd,
                            lines: rawMd.split('\n').length
                          } as ContentPart;
                          messageParts[assistantIndex] = [...parts];
                          // Stream to Document panel in real-time and auto-show
                          if (rawMd.trim()) {
                            documentMarkdownStore.set(rawMd);
                            import('$lib/stores/panels.svelte').then(({ panels }) => {
                              if (!panels.panels.document.visible) {
                                panels.show('document');
                              }
                            });
                          }
                        }
                        scrollToBottom();
                      }
                    } else if (
                      currentToolName === 'diagramWrite' ||
                      currentToolName === 'diagramPatch' ||
                      currentToolName === 'codeWrite' ||
                      currentToolName === 'codePatch'
                    ) {
                      const artifactId = getArtifactIdForToolCall(
                        currentToolName,
                        currentToolCallId
                      );
                      const contentMatch = currentToolInputJson.match(
                        /"content"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|$)/
                      );
                      const languageMatch = currentToolInputJson.match(
                        /"language"\s*:\s*"((?:[^"\\]|\\.)*)"/
                      );
                      if (contentMatch) {
                        const rawCode = contentMatch[1]
                          .replace(/\\n/g, '\n')
                          .replace(/\\t/g, '\t')
                          .replace(/\\"/g, '"')
                          .replace(/\\\\/g, '\\');

                        if (rawCode.trim() && artifactMap[artifactId]) {
                          artifactMap[artifactId] = {
                            ...artifactMap[artifactId],
                            code: rawCode,
                            language:
                              languageMatch?.[1] ||
                              artifactMap[artifactId].language ||
                              (currentToolName.startsWith('code') ? 'text' : 'mermaid')
                          };
                          artifactMap = { ...artifactMap };
                          // Live canvas preview: diagramWrite streams full source; diagramPatch streams
                          // replacement lines, so preview it against the original active diagram.
                          if (
                            currentToolName === 'diagramWrite' ||
                            currentToolName === 'diagramPatch'
                          ) {
                            if (streamCanvasTimer) clearTimeout(streamCanvasTimer);
                            streamCanvasTimer = setTimeout(() => {
                              if (
                                previewDiagramToolInput(
                                  currentToolName,
                                  currentToolInputJson,
                                  rawCode,
                                  artifactId
                                )
                              ) {
                                diagramPreviewApplied = true;
                              }
                            }, 120);
                          }
                          scrollToBottom();
                        }
                      }
                    } else {
                      // Generic live updates for all other tools with a tool-status card
                      const statusId = `status-${currentToolCallId}`;
                      const parts = messageParts[assistantIndex] || [];
                      const idx = parts.findIndex(
                        (p: ContentPart) => p.type === 'tool-status' && p.id === statusId
                      );
                      if (idx >= 0) {
                        // Try to extract meaningful info from streaming JSON
                        let liveMsg = '';
                        if (currentToolName === 'autoStyler' || currentToolName === 'styleSearch') {
                          const palMatch = currentToolInputJson.match(
                            /"palette"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          liveMsg = palMatch
                            ? `Searching ${palMatch[1]} styles…`
                            : 'Searching styles…';
                        } else if (
                          currentToolName === 'iconifier' ||
                          currentToolName === 'iconSearch'
                        ) {
                          const queryMatch = currentToolInputJson.match(
                            /"query"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          liveMsg = queryMatch
                            ? `Searching icons: ${queryMatch[1].replace(/\\"/g, '"')}…`
                            : 'Searching icons…';
                        } else if (currentToolName === 'planner') {
                          const taskMatch = currentToolInputJson.match(
                            /"task"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          if (taskMatch)
                            liveMsg = `Planning: ${taskMatch[1].replace(/\\"/g, '"').slice(0, 60)}…`;
                        } else if (currentToolName === 'thinking') {
                          const focusMatch = currentToolInputJson.match(
                            /"focus"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          const summaryMatch = currentToolInputJson.match(
                            /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          if (summaryMatch)
                            liveMsg = `Thinking: ${summaryMatch[1].replace(/\\"/g, '"').slice(0, 60)}…`;
                          else if (focusMatch)
                            liveMsg = `Thinking about ${focusMatch[1].replace(/\\"/g, '"').slice(0, 50)}…`;
                        } else if (currentToolName === 'selfCritique') {
                          const targetMatch = currentToolInputJson.match(
                            /"target"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          if (targetMatch)
                            liveMsg = `Reviewing: ${targetMatch[1].replace(/\\"/g, '"').slice(0, 50)}…`;
                        } else if (currentToolName === 'errorChecker') {
                          liveMsg = 'Checking diagram syntax…';
                        } else if (currentToolName === 'longTermMemory') {
                          const opMatch = currentToolInputJson.match(
                            /"operation"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          if (opMatch) liveMsg = `Memory: ${opMatch[1]}`;
                        } else if (currentToolName === 'fileManager') {
                          const opMatch = currentToolInputJson.match(
                            /"operation"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          if (opMatch) liveMsg = `File: ${opMatch[1]}`;
                        } else if (currentToolName === 'planWithProgress') {
                          const opMatch = currentToolInputJson.match(
                            /"operation"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          const titleMatch = currentToolInputJson.match(
                            /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          if (titleMatch)
                            liveMsg = `${titleMatch[1].replace(/\\"/g, '"').slice(0, 50)}`;
                          else if (opMatch) liveMsg = `Plan: ${opMatch[1]}`;
                        } else if (currentToolName === 'sequentialThinking') {
                          const thoughtMatch = currentToolInputJson.match(
                            /"thoughtNumber"\s*:\s*(\d+)/
                          );
                          const totalMatch = currentToolInputJson.match(
                            /"totalThoughts"\s*:\s*(\d+)/
                          );
                          if (thoughtMatch && totalMatch)
                            liveMsg = `Thinking step ${thoughtMatch[1]}/${totalMatch[1]}…`;
                        } else if (currentToolName === 'subagentFanout') {
                          const parsed = parseSubagentInput(currentToolInputJson);
                          if (parsed.agents?.length) {
                            liveMsg = `Preparing ${parsed.agents.length} subagent${parsed.agents.length !== 1 ? 's' : ''}…`;
                            const details = [
                              ...(parsed.task ? [`Task: ${parsed.task}`] : []),
                              ...parsed.agents.map((agent) => `${agent.role}: ${agent.objective}`)
                            ];
                            parts[idx] = {
                              ...parts[idx],
                              details,
                              message: liveMsg,
                              subagents: parsed.agents
                            } as ContentPart;
                            messageParts[assistantIndex] = [...parts];
                            scrollToBottom();
                            liveMsg = '';
                          }
                        }
                        if (liveMsg) {
                          parts[idx] = { ...parts[idx], message: liveMsg } as ContentPart;
                          messageParts[assistantIndex] = [...parts];
                        }
                      }
                    }
                  } else if (data.type === 'tool-output-available') {
                    const output = data.output;
                    const toolName = data.toolName || currentToolName;

                    if (toolName === 'diagramRead' && output) {
                      const readCode = output.content || '';
                      const readFrom = output.readFrom || 1;
                      const readTo = output.readTo || 0;
                      const totalLines = output.totalLines || 0;
                      const aid = getArtifactIdForToolCall(toolName, data.toolCallId);

                      // Client-side validation using real mermaid parser
                      let readErrors: string[] = [];
                      let readHasErrors = false;
                      if (readCode.trim().length > 0 && !output.isPartial) {
                        try {
                          await mermaidParse(readCode);
                        } catch (parseErr: unknown) {
                          readHasErrors = true;
                          readErrors = [
                            (parseErr instanceof Error ? parseErr.message : String(parseErr)) ||
                              'Invalid Mermaid syntax'
                          ];
                        }
                      }

                      artifactMap[aid] = {
                        code: readCode,
                        errors: readErrors,
                        hasErrors: readHasErrors,
                        id: aid,
                        isStreaming: false,
                        operation: 'read',
                        previousCode: '',
                        readFrom,
                        readTo,
                        title: 'Diagram Read',
                        totalLines
                      };
                      artifactMap = { ...artifactMap };
                      const parts = messageParts[assistantIndex] || [];
                      if (!parts.some((p) => p.type === 'artifact' && p.artifactId === aid)) {
                        parts.push({ type: 'artifact', artifactId: aid });
                        messageParts[assistantIndex] = [...parts];
                      }
                      lastPartWasText = false;
                      scrollToBottom();
                    } else if (
                      output &&
                      typeof output.content === 'string' &&
                      (toolName === 'codeRead' ||
                        toolName === 'codeWrite' ||
                        toolName === 'codePatch')
                    ) {
                      const aid = getArtifactIdForToolCall(toolName, data.toolCallId);
                      const codeContent = output.content || '';
                      artifactMap[aid] = {
                        code: codeContent,
                        id: aid,
                        isStreaming: false,
                        language: output.language || artifactMap[aid]?.language || 'text',
                        operation:
                          toolName === 'codeRead'
                            ? 'read'
                            : toolName === 'codePatch'
                              ? 'patch'
                              : 'create',
                        previousCode: artifactMap[aid]?.previousCode || '',
                        readFrom: output.readFrom,
                        readTo: output.readTo,
                        title:
                          toolName === 'codeRead'
                            ? 'Code Read'
                            : toolName === 'codePatch'
                              ? 'Code Patch'
                              : 'Code Write',
                        totalLines: output.totalLines || output.lines
                      };
                      artifactMap = { ...artifactMap };
                      const parts = messageParts[assistantIndex] || [];
                      if (!parts.some((p) => p.type === 'artifact' && p.artifactId === aid)) {
                        parts.push({ type: 'artifact', artifactId: aid });
                        messageParts[assistantIndex] = [...parts];
                      }
                      if (
                        output.success === true &&
                        typeof output.content === 'string' &&
                        (toolName === 'codeWrite' || toolName === 'codePatch')
                      ) {
                        applyToolSourceToActiveTab(output.content, output);
                      }
                      scrollToBottom();
                    } else if (
                      output &&
                      output.success === true &&
                      typeof output.content === 'string' &&
                      (toolName === 'diagramWrite' ||
                        toolName === 'diagramPatch' ||
                        toolName === 'diagramDelete')
                    ) {
                      diagramMutationSucceeded = true;
                      const diagramCode = output.content;
                      const aid = getArtifactIdForToolCall(toolName, data.toolCallId);
                      const titleStr =
                        toolName === 'diagramWrite'
                          ? 'Diagram Write'
                          : toolName === 'diagramPatch'
                            ? 'Diagram Patch'
                            : 'Diagram Delete';
                      artifactMap[aid] = {
                        code: diagramCode,
                        id: aid,
                        isStreaming: false,
                        language: artifactMap[aid]?.language || 'mermaid',
                        operation:
                          toolName === 'diagramWrite'
                            ? 'create'
                            : toolName === 'diagramPatch'
                              ? 'patch'
                              : 'update',
                        previousCode: artifactMap[aid]?.previousCode || $stateStore.code || '',
                        title: titleStr
                      };
                      artifactMap = { ...artifactMap };
                      const parts = messageParts[assistantIndex] || [];
                      if (!parts.some((p) => p.type === 'artifact' && p.artifactId === aid)) {
                        parts.push({ type: 'artifact', artifactId: aid });
                        messageParts[assistantIndex] = [...parts];
                      }
                      applyToolSourceToActiveTab(diagramCode, output);
                      scrollToBottom();

                      // Post-write validation: check if the written code has errors
                      if (
                        diagramCode.trim().length > 0 &&
                        (toolName === 'diagramWrite' || toolName === 'diagramPatch')
                      ) {
                        try {
                          await mermaidParse(diagramCode);
                        } catch (parseErr: unknown) {
                          const errMsg =
                            (parseErr instanceof Error ? parseErr.message : String(parseErr)) ||
                            'Invalid Mermaid syntax';
                          // Update artifact to show error
                          if (artifactMap[aid]) {
                            artifactMap[aid] = {
                              ...artifactMap[aid],
                              hasErrors: true,
                              errors: [errMsg],
                              title: 'Errors Found'
                            };
                            artifactMap = { ...artifactMap };
                          }
                          // Auto-send fix message after stream completes
                          if (autoFixTimeout) clearTimeout(autoFixTimeout);
                          autoFixTimeout = setTimeout(() => {
                            autoFixTimeout = null;
                            // Only auto-fix if not already loading (stream finished)
                            if (!isLoading) {
                              const fixPrompt = `The diagram you just wrote has a syntax error: "${errMsg}". Please fix it.`;
                              handleSubmit({ text: fixPrompt });
                            }
                          }, 1000);
                        }
                      }
                    }

                    // Handle iconifier output — update status part with icon results
                    if (toolName === 'iconifier' && output) {
                      const statusId = `status-${data.toolCallId || currentToolCallId}`;
                      const parts = messageParts[assistantIndex] || [];
                      const idx = parts.findIndex(
                        (p: ContentPart) => p.type === 'tool-status' && p.id === statusId
                      );
                      const statusPart: ContentPart = {
                        iconMode: output.mode,
                        iconResults: output.results || [],
                        id: statusId,
                        message: output.summary || 'Iconifier complete',
                        status: 'done',
                        toolName: 'iconifier',
                        type: 'tool-status'
                      };
                      if (idx >= 0) {
                        parts[idx] = statusPart;
                      } else {
                        parts.push(statusPart);
                      }
                      messageParts[assistantIndex] = [...parts];
                      if (output.content && typeof output.content === 'string') {
                        applyToolSourceToActiveTab(output.content, output);
                      }
                      scrollToBottom();
                    }

                    // Handle autoStyler output — update status and apply styled diagram
                    if (toolName === 'autoStyler' && output) {
                      const statusId = `status-${data.toolCallId || currentToolCallId}`;
                      const parts = messageParts[assistantIndex] || [];
                      const idx = parts.findIndex(
                        (p: ContentPart) => p.type === 'tool-status' && p.id === statusId
                      );
                      const stylerDetails: string[] = [];
                      if (output.palette) stylerDetails.push(`Palette: ${output.palette}`);
                      if (output.nodesStyled !== undefined)
                        stylerDetails.push(`${output.nodesStyled} node(s) styled`);
                      if (output.subgraphsStyled !== undefined)
                        stylerDetails.push(`${output.subgraphsStyled} subgraph(s) styled`);
                      const statusPart: ContentPart = {
                        details: stylerDetails.length > 0 ? stylerDetails : undefined,
                        id: statusId,
                        message: output.summary || 'Styling complete',
                        status: 'done',
                        toolName: 'autoStyler',
                        type: 'tool-status'
                      };
                      if (idx >= 0) {
                        parts[idx] = statusPart;
                      } else {
                        parts.push(statusPart);
                      }
                      messageParts[assistantIndex] = [...parts];
                      if (output.content && typeof output.content === 'string') {
                        applyToolSourceToActiveTab(output.content, output);
                      }
                      scrollToBottom();
                    }

                    // Handle webSearch output — update status part with rich search data
                    if (toolName === 'webSearch' && output) {
                      const statusId = `status-${data.toolCallId || currentToolCallId}`;
                      const parts = messageParts[assistantIndex] || [];
                      const idx = parts.findIndex(
                        (p: ContentPart) => p.type === 'tool-status' && p.id === statusId
                      );
                      const statusPart: ContentPart = {
                        id: statusId,
                        message: output.summary || `Searched for "${output.query}"`,
                        searchQuery: output.query,
                        searchReason: output.reason,
                        searchResults: output.results || [],
                        status: 'done',
                        toolName: 'webSearch',
                        type: 'tool-status'
                      };
                      if (idx >= 0) {
                        parts[idx] = statusPart;
                      } else {
                        parts.push(statusPart);
                      }
                      messageParts[assistantIndex] = [...parts];
                      scrollToBottom();
                    }

                    // Handle fileManager output — update status part with file operation results
                    if (toolName === 'fileManager' && output) {
                      const statusId = `status-${data.toolCallId || currentToolCallId}`;
                      const parts = messageParts[assistantIndex] || [];
                      const idx = parts.findIndex(
                        (p: ContentPart) => p.type === 'tool-status' && p.id === statusId
                      );
                      let msg = 'File operation complete';
                      if (output.fileCount !== undefined)
                        msg = `${output.fileCount} file${output.fileCount !== 1 ? 's' : ''} found`;
                      else if (output.filename) msg = `Read: ${output.filename}`;
                      else if (output.totalMatches !== undefined)
                        msg = `${output.totalMatches} match${output.totalMatches !== 1 ? 'es' : ''} found`;
                      else if (output.message) msg = output.message;
                      const statusPart: ContentPart = {
                        id: statusId,
                        message: msg,
                        status: 'done',
                        toolName: 'fileManager',
                        type: 'tool-status'
                      };
                      if (idx >= 0) {
                        parts[idx] = statusPart;
                      } else {
                        parts.push(statusPart);
                      }
                      messageParts[assistantIndex] = [...parts];
                      scrollToBottom();
                    }

                    // Generic tool-status completion for tools without specific handlers
                    if (
                      output &&
                      toolName !== 'iconifier' &&
                      toolName !== 'autoStyler' &&
                      toolName !== 'webSearch' &&
                      toolName !== 'fileManager' &&
                      toolName !== 'diagramWrite' &&
                      toolName !== 'diagramPatch' &&
                      toolName !== 'diagramRead' &&
                      toolName !== 'diagramDelete' &&
                      toolName !== 'markdownRead' &&
                      toolName !== 'markdownWrite'
                    ) {
                      const statusId = `status-${data.toolCallId || currentToolCallId}`;
                      const parts = messageParts[assistantIndex] || [];
                      const idx = parts.findIndex(
                        (p: ContentPart) => p.type === 'tool-status' && p.id === statusId
                      );
                      if (idx >= 0) {
                        // For errorChecker: run real mermaid.parse() on client like canvas does
                        let checkerErrors: { line: number; message: string }[] =
                          output.errors || [];
                        let checkerValid = output.valid !== false;
                        if (toolName === 'errorChecker' && output.content) {
                          try {
                            await mermaidParse(output.content);
                            checkerValid = true;
                            checkerErrors = [];
                          } catch (parseErr: unknown) {
                            checkerValid = false;
                            const errMsg =
                              (parseErr instanceof Error ? parseErr.message : String(parseErr)) ||
                              'Invalid Mermaid syntax';
                            checkerErrors = [{ line: 0, message: errMsg }];
                          }
                          // If parser passed but the live canvas is failing to render,
                          // surface that as the real error (parse passes != render passes).
                          if (checkerValid && canvasStatus.renderError) {
                            checkerValid = false;
                            checkerErrors = [
                              { line: 0, message: `Render error: ${canvasStatus.renderError}` }
                            ];
                          }
                        }

                        const doneLabel: Record<string, string> = {
                          actionItemExtractor: output.actionItems
                            ? `Extracted ${output.actionItems.length} item(s)`
                            : 'Extraction complete',
                          dataAnalyzer: output.summary || 'Analysis complete',
                          errorChecker: !checkerValid
                            ? checkerErrors[0]
                              ? checkerErrors[0].line > 0
                                ? `Line ${checkerErrors[0].line}: ${checkerErrors[0].message}`
                                : checkerErrors[0].message
                              : `Found ${checkerErrors.length} error(s)`
                            : 'No errors found ✓',
                          gitGuard: output.clean
                            ? 'Git safety check passed'
                            : `${output.changedPaths?.length || 0} changed path(s) detected`,
                          iconSearch: output.summary || 'Icon suggestions ready',
                          longTermMemory: output.message || 'Memory accessed',
                          planWithProgress: output.progress || output.message || 'Plan updated',
                          planner: output.task
                            ? `Plan ready for: ${output.task.slice(0, 50)}${output.task.length > 50 ? '…' : ''}`
                            : 'Plan created',
                          selfCritique: output.summary || 'Review complete',
                          sequentialThinking: output.isComplete
                            ? `Thinking complete (${output.totalThoughts} steps)`
                            : `Thought ${output.thoughtNumber}/${output.totalThoughts}`,
                          styleSearch: output.summary || 'Style suggestions ready',
                          subagentAssemble: output.integrationPlan
                            ? `Assembled ${output.integrationPlan.length} agent output(s)`
                            : 'Agent work assembled',
                          subagentFanout: output.assignments
                            ? `Ran ${output.assignments.length} subagent(s)`
                            : 'Subagents spawned',
                          tableAnalytics: output.summary || 'Analysis complete',
                          thinking: output.summary
                            ? `Thinking: ${output.summary.slice(0, 70)}${output.summary.length > 70 ? '…' : ''}`
                            : 'Thinking checkpoint ready'
                        };
                        // Build details array for dropdown
                        let toolDetails: string[] = [];
                        if (toolName === 'errorChecker') {
                          if (!checkerValid) {
                            toolDetails = checkerErrors.map(
                              (e: { line: number; message: string }) =>
                                e.line > 0 ? `Line ${e.line}: ${e.message}` : e.message
                            );
                          } else {
                            toolDetails = ['All syntax checks passed'];
                          }
                        } else if (toolName === 'planner') {
                          if (output.task) toolDetails.push(`Task: ${output.task}`);
                          if (output.currentState) {
                            if (output.currentState.hasDiagram)
                              toolDetails.push(
                                `Diagram: ${output.currentState.diagramLines} lines`
                              );
                            if (output.currentState.hasDocument)
                              toolDetails.push(
                                `Document: ${output.currentState.documentLines} lines`
                              );
                          }
                          if (output.instruction) toolDetails.push(output.instruction);
                        } else if (toolName === 'selfCritique') {
                          if (output.improvements)
                            toolDetails = output.improvements.map(
                              (imp: string | Record<string, unknown>) =>
                                typeof imp === 'string'
                                  ? imp
                                  : (imp.description as string) ||
                                    (imp.title as string) ||
                                    JSON.stringify(imp)
                            );
                        } else if (toolName === 'thinking') {
                          if (output.focus) toolDetails.push(`Focus: ${output.focus}`);
                          if (output.summary) toolDetails.push(output.summary);
                          if (output.toolsConsidered?.length) {
                            toolDetails.push(`Tools: ${output.toolsConsidered.join(', ')}`);
                          }
                          if (output.nextAction) toolDetails.push(`Next: ${output.nextAction}`);
                          if (output.confidence)
                            toolDetails.push(`Confidence: ${output.confidence}`);
                        } else if (toolName === 'styleSearch') {
                          if (output.palette) toolDetails.push(`Palette: ${output.palette}`);
                          if (output.suggestedPatch) {
                            toolDetails.push(
                              `Patch: lines ${output.suggestedPatch.startLine}-${output.suggestedPatch.endLine}`
                            );
                          }
                          if (output.styleLines?.length) {
                            toolDetails.push(
                              ...output.styleLines.slice(0, 8).map((line: string) => line.trim())
                            );
                          }
                        } else if (toolName === 'iconSearch') {
                          if (output.suggestions?.length) {
                            toolDetails.push(
                              ...output.suggestions
                                .slice(0, 8)
                                .map(
                                  (item: {
                                    colorMode?: string;
                                    confidence?: number;
                                    iconId?: string;
                                    nodeId: string;
                                    source?: string;
                                    status: string;
                                  }) =>
                                    item.status === 'matched'
                                      ? `${item.nodeId}: ${item.iconId} (${item.colorMode || 'any'}, ${item.source || 'local'}, ${Math.round((item.confidence || 0) * 100)}%)`
                                      : `${item.nodeId}: no match`
                                )
                            );
                          }
                        } else if (toolName === 'gitGuard') {
                          if (output.requestedPaths?.length) {
                            toolDetails.push(`Requested: ${output.requestedPaths.join(', ')}`);
                          }
                          if (output.changedPaths?.length) {
                            toolDetails.push(`Changed: ${output.changedPaths.join(', ')}`);
                          }
                          if (output.protectedPaths?.length) {
                            toolDetails.push(`Protected: ${output.protectedPaths.join(', ')}`);
                          }
                          if (output.requiresUserConfirmation) {
                            toolDetails.push(
                              'User confirmation required before overwriting dirty paths'
                            );
                          }
                        } else if (toolName === 'subagentFanout') {
                          if (output.task) toolDetails.push(`Task: ${output.task}`);
                          if (output.runId) toolDetails.push(`Run: ${output.runId}`);
                          if (output.durationMs)
                            toolDetails.push(`Duration: ${(output.durationMs / 1000).toFixed(1)}s`);
                          if (output.assignments?.length) {
                            toolDetails.push(
                              ...output.assignments.map(
                                (agent: {
                                  id: string;
                                  role: string;
                                  objective: string;
                                  ownedPaths?: string[];
                                }) =>
                                  `${agent.id} (${agent.role}): ${agent.objective}${
                                    agent.ownedPaths?.length
                                      ? ` [${agent.ownedPaths.join(', ')}]`
                                      : ''
                                  }`
                              )
                            );
                          }
                          if (output.outputs?.length) {
                            toolDetails.push(
                              `Outputs: ${output.outputs.length} specialist result(s)`
                            );
                          }
                          if (output.nextRequiredAction)
                            toolDetails.push(output.nextRequiredAction);
                        } else if (toolName === 'subagentAssemble') {
                          if (output.runId) toolDetails.push(`Run: ${output.runId}`);
                          if (output.integrationPlan?.length) {
                            toolDetails.push(
                              ...output.integrationPlan.map(
                                (item: {
                                  agentId: string;
                                  changedPaths?: string[];
                                  order: number;
                                  summary: string;
                                }) =>
                                  `${item.order}. ${item.agentId}: ${item.summary}${
                                    item.changedPaths?.length
                                      ? ` [${item.changedPaths.join(', ')}]`
                                      : ''
                                  }`
                              )
                            );
                          }
                          if (output.nextRequiredAction)
                            toolDetails.push(output.nextRequiredAction);
                        }
                        parts[idx] = {
                          ...parts[idx],
                          details: toolDetails.length > 0 ? toolDetails : undefined,
                          message:
                            doneLabel[toolName] ||
                            output.summary ||
                            output.message ||
                            `${toolName} complete`,
                          status: 'done',
                          subagents:
                            toolName === 'subagentFanout' &&
                            (output.assignments?.length || output.outputs?.length)
                              ? (output.assignments || []).map(
                                  (agent: SubagentAssignment): SubagentAssignment => {
                                    const agentOutput = output.outputs?.find(
                                      (item: SubagentAssignment & { agentId?: string }) =>
                                        item.agentId === agent.id
                                    );
                                    return {
                                      ...agent,
                                      ...agentOutput,
                                      id: agent.id,
                                      role: agent.role
                                    };
                                  }
                                )
                              : parts[idx].type === 'tool-status'
                                ? parts[idx].subagents
                                : undefined
                        } as ContentPart;
                        messageParts[assistantIndex] = [...parts];
                        scrollToBottom();
                      }
                    }

                    // Handle markdownRead/markdownWrite output — finalize streaming card & update Document panel
                    if ((toolName === 'markdownRead' || toolName === 'markdownWrite') && output) {
                      const mdId = `md-${data.toolCallId || currentToolCallId || Date.now()}`;
                      const mdContent = output.content || '';
                      const mdLines = output.lines || mdContent.split('\n').length;
                      const isAppend = toolName === 'markdownWrite' && output.append === true;
                      const mdPart: ContentPart = {
                        content: mdContent,
                        id: mdId,
                        isStreaming: false,
                        lines: mdLines,
                        operation:
                          toolName === 'markdownRead' ? 'read' : isAppend ? 'append' : 'write',
                        type: 'markdown'
                      };
                      const parts = messageParts[assistantIndex] || [];
                      // Update existing streaming card or add new one
                      const existingIdx = parts.findIndex(
                        (p: ContentPart) => p.type === 'markdown' && p.id === mdId
                      );
                      if (existingIdx >= 0) {
                        parts[existingIdx] = mdPart;
                      } else {
                        parts.push(mdPart);
                      }
                      messageParts[assistantIndex] = [...parts];
                      // Push final content to Document panel and auto-show it
                      if (toolName === 'markdownWrite' && mdContent) {
                        documentMarkdownStore.set(mdContent);
                        // Auto-open Document panel if hidden
                        import('$lib/stores/panels.svelte').then(({ panels }) => {
                          if (!panels.panels.document.visible) {
                            panels.show('document');
                          }
                        });
                      }
                      scrollToBottom();
                    }

                    currentToolCallId = null;
                    currentToolName = '';
                    currentToolInputJson = '';
                    currentArtifactId = null;
                  } else if (data.type === 'tool-call' && data.toolName === 'askQuestions') {
                    messageParts[assistantIndex] = removeThinkingPart(
                      messageParts[assistantIndex] || []
                    );
                    // askQuestions has no execute — finalize the streaming questionnaire
                    try {
                      const args =
                        typeof data.args === 'string' ? JSON.parse(data.args) : data.args;
                      const qId = `q-${data.toolCallId || currentToolCallId || Date.now()}`;
                      const parts = messageParts[assistantIndex] || [];
                      const existingIdx = parts.findIndex(
                        (p: ContentPart) => p.type === 'questionnaire' && p.id === qId
                      );
                      const finalPart: ContentPart = {
                        context: args.context || '',
                        id: qId,
                        isStreaming: false,
                        questions: args.questions || [],
                        type: 'questionnaire'
                      };
                      if (existingIdx >= 0) {
                        parts[existingIdx] = finalPart;
                      } else {
                        parts.push(finalPart);
                      }
                      messageParts[assistantIndex] = [...parts];
                      questionnaireResponses[qId] = {};
                      isLoading = false;
                      scrollToBottom();
                    } catch {
                      /* ignore parse errors */
                    }
                  } else if (data.type === 'done' || data.type === 'finish') {
                    streamFinished = true;
                    messageParts[assistantIndex] = removeThinkingPart(
                      messageParts[assistantIndex] || []
                    );
                    // Clear any pending canvas streaming timer
                    if (streamCanvasTimer) {
                      clearTimeout(streamCanvasTimer);
                      streamCanvasTimer = null;
                    }
                    // Finalize any still-streaming artifacts
                    for (const key of Object.keys(artifactMap)) {
                      if (artifactMap[key].isStreaming) {
                        artifactMap[key] = {
                          ...artifactMap[key],
                          isStreaming: false,
                          title: artifactMap[key].title
                            .replace('Writing', 'Created')
                            .replace('Patching', 'Patched')
                            .replace('Reading', 'Read')
                        };
                      }
                    }
                    artifactMap = { ...artifactMap };
                    currentArtifactId = null;
                    currentReasoningId = null;
                    // Finalize any still-streaming questionnaires
                    const currentDoneParts = messageParts[assistantIndex] || [];
                    const doneParts = finalizeReasoningParts(currentDoneParts);
                    let partsChanged = doneParts !== currentDoneParts;
                    for (let pi = 0; pi < doneParts.length; pi++) {
                      if (
                        doneParts[pi].type === 'questionnaire' &&
                        (doneParts[pi] as ContentPart & { isStreaming?: boolean }).isStreaming
                      ) {
                        doneParts[pi] = { ...doneParts[pi], isStreaming: false } as ContentPart;
                        partsChanged = true;
                      }
                    }
                    if (partsChanged) messageParts[assistantIndex] = [...doneParts];
                    isLoading = false;
                    scrollToBottom();
                    return;
                  } else if (data.type === 'error') {
                    restoreUncommittedDiagramPreview();
                    const parts = finalizeReasoningParts(
                      removeThinkingPart(messageParts[assistantIndex] || [])
                    );
                    parts.push({ type: 'error', error: data.error, userMessage: text });
                    messageParts[assistantIndex] = [...parts];
                    isLoading = false;
                    abortController = null;
                    currentReasoningId = null;
                    scrollToBottom();
                    return;
                  }
                } catch (e) {
                  console.error('Failed to parse SSE data:', e);
                }
              }
            }
          }
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') {
          // User cancelled - just stop
          restoreUncommittedDiagramPreview();
          messageParts[assistantIndex] = finalizeReasoningParts(
            removeThinkingPart(messageParts[assistantIndex] || [])
          );
          isLoading = false;
          abortController = null;
          currentReasoningId = null;
          debouncedSaveChatState();
          return;
        }
        restoreUncommittedDiagramPreview();
        const parts = finalizeReasoningParts(
          removeThinkingPart(messageParts[assistantIndex] || [])
        );
        parts.push({ type: 'error', error: err.message, userMessage: text });
        messageParts[assistantIndex] = [...parts];
        isLoading = false;
        abortController = null;
        currentReasoningId = null;
        debouncedSaveChatState();
      })
      .finally(() => {
        if (!streamFinished) {
          restoreUncommittedDiagramPreview();
        }
        messageParts[assistantIndex] = finalizeReasoningParts(
          removeThinkingPart(messageParts[assistantIndex] || [])
        );
        for (const key of Object.keys(artifactMap)) {
          if (artifactMap[key].isStreaming) {
            artifactMap[key] = {
              ...artifactMap[key],
              isStreaming: false,
              title: artifactMap[key].title
                .replace('Writing', 'Created')
                .replace('Patching', 'Patched')
                .replace('Reading', 'Read')
            };
          }
        }
        artifactMap = { ...artifactMap };
        currentArtifactId = null;
        currentReasoningId = null;
        isLoading = false;
        abortController = null;
        scrollToBottom();
        // Refresh gems/credits balance after message
        if (authStore.isLoggedIn) {
          authStore.refreshCredits();
        }
        // Persist chat state (debounced to avoid heavy serialization)
        debouncedSaveChatState();
      });
  }
</script>

<div class="flex h-full flex-col">
  <!-- Messages Area -->
  <div
    bind:this={messagesContainer}
    onscroll={handleMessagesScroll}
    class="scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent relative flex-1 overflow-y-auto scroll-smooth">
    {#if !isDataReady}
      <div
        class="flex h-full items-center justify-center px-6 py-8 text-xs text-muted-foreground"
        aria-live="polite">
        Restoring session…
      </div>
    {:else if !hasMessages}
      <div class="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-8 px-4 py-10">
        <h2
          class="text-center text-[28px] font-medium tracking-normal text-foreground sm:text-[32px]">
          Where should we begin?
        </h2>
        <div class="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
          {#each suggestions as suggestion (suggestion.label)}
            <button
              type="button"
              onclick={() => {
                handleSubmit({ text: suggestion.prompt });
              }}
              class="group flex h-11 min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none"
              aria-label={suggestion.label}>
              <suggestion.icon
                class="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              <span class="min-w-0 truncate">{suggestion.label}</span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <!-- All Messages -->
      <div class="mx-auto max-w-3xl space-y-5 px-4 pt-4 pb-12 sm:px-6 sm:pt-5 sm:pb-14">
        {#each messages as message, i (messageKey(message, i))}
          {#if message.role === 'user'}
            <!-- User Bubble (right-aligned) with checkpoint undo -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="group/msg flex items-center justify-end gap-3"
              onmouseenter={() => (hoveredMessageIndex = i)}
              onmouseleave={() => (hoveredMessageIndex = null)}>
              {#if hoveredMessageIndex === i && checkpoints.some((c) => c.messageIndex === i)}
                <button
                  type="button"
                  class="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground opacity-0 transition-all group-hover/msg:opacity-100 hover:bg-accent hover:text-foreground"
                  title="Undo to this point"
                  onclick={() => restoreCheckpoint(i)}>
                  <Undo2 class="size-4" />
                </button>
              {/if}
              <div class="flex max-w-[92%] flex-col items-end gap-1.5">
                {#if message.attachments?.length > 0}
                  <div class="flex flex-wrap justify-end gap-1.5">
                    {#each message.attachments as att, attIdx (attachmentKey(att, attIdx))}
                      {#if att.mediaType?.startsWith('image/') && att.url}
                        <div
                          class="h-12 w-12 overflow-hidden rounded-md border border-border"
                          title={att.filename || 'Image'}>
                          <img
                            src={att.url}
                            alt={att.filename || 'Image'}
                            class="h-full w-full object-cover" />
                        </div>
                      {:else}
                        <div
                          class="flex h-8 max-w-[220px] min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[11px] text-muted-foreground"
                          title={att.filename}>
                          <FileText class="size-3.5 shrink-0" />
                          <span class="min-w-0 truncate text-foreground/80"
                            >{att.filename || 'File'}</span>
                          <span
                            class="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground"
                            >{(att.ext || '?').toUpperCase()}</span>
                        </div>
                      {/if}
                    {/each}
                  </div>
                {/if}
                {#if message.content}
                  <div
                    class="inline-block rounded-lg rounded-tr-sm bg-muted px-3 py-2 text-[13px] leading-relaxed text-foreground">
                    {message.content}
                  </div>
                {/if}
              </div>
            </div>
          {:else if message.role === 'assistant'}
            <!-- Assistant Response (left-aligned) -->
            <div>
              <div class="max-w-[95%] space-y-3">
                {#if messageParts[i] && messageParts[i].length > 0}
                  {#each chainDisplayParts(messageParts[i]) as part, pi (contentPartKey(part, pi))}
                    {#if part.type === 'text' && part.text}
                      <div class="pl-3 text-[13px] leading-relaxed text-foreground/90">
                        <Response content={part.text} />
                      </div>
                    {:else if part.type === 'thinking'}
                      <div class="flex items-center py-2 pl-3" aria-live="polite">
                        <span
                          class="thinking-shimmer text-[12px] font-medium text-muted-foreground/60">
                          Thinking…
                        </span>
                      </div>
                    {:else if part.type === 'reasoning'}
                      {@const reasoningIsStreaming =
                        part.status === 'running' || (isLoading && i === messages.length - 1)}
                      <div
                        class="group overflow-hidden rounded-lg border border-border bg-muted/20 transition-all duration-200 hover:border-foreground/10">
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30"
                          onclick={(e) => {
                            const body = (e.currentTarget as HTMLElement).nextElementSibling;
                            if (body) body.classList.toggle('hidden');
                            const chev = (e.currentTarget as HTMLElement).querySelector(
                              '.reasoning-chevron'
                            );
                            if (chev) chev.classList.toggle('rotate-90');
                          }}>
                          <div
                            class="flex size-5 shrink-0 items-center justify-center rounded-md bg-yellow-500/10 text-yellow-500">
                            <Brain class="size-3 {reasoningIsStreaming ? 'animate-pulse' : ''}" />
                          </div>
                          <span class="flex-1 text-xs font-medium text-foreground/80">
                            Model thinking
                            <span class="ml-1 text-[10px] text-muted-foreground">
                              · {reasoningIsStreaming ? 'streaming' : 'complete'}
                            </span>
                          </span>
                          <div
                            class="reasoning-chevron text-muted-foreground/40 transition-transform {reasoningIsStreaming
                              ? 'rotate-90'
                              : ''}">
                            <ChevronRight class="size-3.5" />
                          </div>
                        </button>
                        <div
                          class="{reasoningIsStreaming
                            ? ''
                            : 'hidden'} border-t border-border px-3 py-2.5"
                          style="max-height: 220px; overflow-y: auto;">
                          <p
                            class="text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/70">
                            {part.text ||
                              (reasoningIsStreaming
                                ? 'Preparing reasoning summary…'
                                : 'No reasoning summary returned.')}
                          </p>
                        </div>
                      </div>
                    {:else if part.type === 'tool-chain'}
                      {@const runningCount = part.parts.filter(
                        (toolPart) => toolPartStatus(toolPart) === 'running'
                      ).length}
                      <div
                        class="group overflow-hidden rounded-lg border transition-all duration-200
                        {part.status === 'running'
                          ? 'border-border bg-muted/30'
                          : 'border-border bg-muted/20 hover:border-foreground/10'}">
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30"
                          onclick={(e) => {
                            const body = (e.currentTarget as HTMLElement).nextElementSibling;
                            if (body) body.classList.toggle('hidden');
                            const chev = (e.currentTarget as HTMLElement).querySelector(
                              '.tool-chain-chevron'
                            );
                            if (chev) chev.classList.toggle('rotate-90');
                          }}>
                          <div
                            class="flex size-5 shrink-0 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-500">
                            <GitBranch
                              class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                          </div>
                          <span class="flex-1 text-xs font-medium text-foreground/80">
                            Patch chain
                            <span class="ml-1 text-[10px] text-muted-foreground">
                              · {part.parts.length} patch{part.parts.length !== 1 ? 'es' : ''}
                              {#if runningCount > 0}
                                · {runningCount} running
                              {:else}
                                · complete
                              {/if}
                            </span>
                          </span>
                          {#if part.status === 'running'}
                            {@const dotColor = 'bg-muted-foreground/40'}
                            <div class="flex items-center gap-0.5">
                              <span
                                class="inline-block size-1 animate-pulse rounded-full {dotColor} [animation-delay:0ms]"
                              ></span>
                              <span
                                class="inline-block size-1 animate-pulse rounded-full {dotColor} [animation-delay:150ms]"
                              ></span>
                              <span
                                class="inline-block size-1 animate-pulse rounded-full {dotColor} [animation-delay:300ms]"
                              ></span>
                            </div>
                          {/if}
                          <div
                            class="tool-chain-chevron text-muted-foreground/40 transition-transform {part.status ===
                            'running'
                              ? 'rotate-90'
                              : ''}">
                            <ChevronRight class="size-3.5" />
                          </div>
                        </button>
                        <div
                          class="{part.status === 'running'
                            ? ''
                            : 'hidden'} border-t border-border px-3 py-2.5"
                          style="max-height: 280px; overflow-y: auto;">
                          <div class="space-y-0">
                            {#each part.parts as toolPart, chainIdx (contentPartKey(toolPart, chainIdx))}
                              {@const details = toolPartDetails(toolPart)}
                              <div class="relative flex gap-2 pb-2 last:pb-0">
                                <div class="relative flex w-5 shrink-0 justify-center">
                                  {#if chainIdx < part.parts.length - 1}
                                    <div class="absolute top-5 bottom-[-0.5rem] w-px bg-border">
                                    </div>
                                  {/if}
                                  <div
                                    class="relative z-10 flex size-5 items-center justify-center rounded-full border bg-background text-[10px] font-medium
                                    {toolPartStatus(toolPart) === 'running'
                                      ? 'border-primary text-primary'
                                      : 'border-border text-muted-foreground'}">
                                    {#if toolPartStatus(toolPart) === 'running'}
                                      <span class="size-1.5 animate-pulse rounded-full bg-primary"
                                      ></span>
                                    {:else}
                                      {chainIdx + 1}
                                    {/if}
                                  </div>
                                </div>
                                <div class="min-w-0 flex-1 rounded-md bg-background/45 px-2 py-1.5">
                                  <div class="flex min-w-0 items-center gap-2 text-[11px]">
                                    <span
                                      class="min-w-0 flex-1 truncate font-medium text-foreground/75">
                                      {toolPartLabel(toolPart)}
                                    </span>
                                    <span class="shrink-0 text-[10px] text-muted-foreground/60">
                                      {toolPartSummary(toolPart)}
                                    </span>
                                  </div>
                                  {#if details.length > 0}
                                    <details class="mt-1.5">
                                      <summary
                                        class="cursor-pointer text-[10px] font-medium text-muted-foreground/70">
                                        Preview
                                      </summary>
                                      <div class="mt-1 space-y-0.5">
                                        {#each details as detail, detailIdx (`${detail}:${detailIdx}`)}
                                          <div
                                            class="truncate text-[10px] leading-relaxed text-muted-foreground/75">
                                            {detail}
                                          </div>
                                        {/each}
                                      </div>
                                    </details>
                                  {/if}
                                </div>
                              </div>
                            {/each}
                          </div>
                        </div>
                      </div>
                    {:else if part.type === 'artifact' && artifactMap[part.artifactId]}
                      {@const artifact = artifactMap[part.artifactId]}
                      <CodeArtifact
                        code={artifact.code}
                        previousCode={artifact.previousCode}
                        language={artifact.language || 'mermaid'}
                        title={artifact.title}
                        isStreaming={artifact.isStreaming}
                        operation={artifact.operation}
                        hasErrors={artifact.hasErrors}
                        errors={artifact.errors}
                        readFrom={artifact.readFrom}
                        readTo={artifact.readTo}
                        totalLines={artifact.totalLines}
                        onApply={artifact.operation !== 'read'
                          ? (code) => inputStateStore.update((s) => ({ ...s, code }))
                          : undefined}
                        onOpenEditor={artifact.operation !== 'read'
                          ? () => {
                              updateCodeStore({ code: artifact.code, editorMode: 'code' });
                            }
                          : undefined} />
                    {:else if part.type === 'error'}
                      <!-- Error with retry -->
                      <div
                        class="flex items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5">
                        <AlertCircle class="size-4 shrink-0 text-red-500" />
                        <p class="flex-1 text-xs font-medium text-destructive">
                          Some error occurred
                        </p>
                        <button
                          type="button"
                          class="flex shrink-0 items-center gap-1 rounded-md bg-destructive/10 px-2.5 py-1 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/20"
                          onclick={() =>
                            retryMessage(
                              part.userMessage ||
                                (messages
                                  .filter((m: Record<string, unknown>) => m.role === 'user')
                                  .pop()?.content as string) ||
                                ''
                            )}>
                          <RotateCcw class="size-3" />
                          Retry
                        </button>
                      </div>
                    {:else if part.type === 'tool-status'}
                      <!-- Tool status — per-tool colors -->
                      {@const hasDetails =
                        (part.toolName === 'iconifier' &&
                          part.iconResults &&
                          part.iconResults.length > 0) ||
                        (part.toolName === 'webSearch' &&
                          part.searchResults &&
                          part.searchResults.length > 0) ||
                        (part.subagents && part.subagents.length > 0) ||
                        (part.details && part.details.length > 0)}
                      {@const addedCount =
                        part.iconResults?.filter((ic) => ic.status === 'added').length || 0}
                      {@const skippedCount =
                        part.iconResults?.filter((ic) => ic.status === 'skipped').length || 0}
                      {@const removedCount =
                        part.iconResults?.filter((ic) => ic.status === 'removed').length || 0}
                      {@const isIconifier =
                        part.toolName === 'iconifier' || part.toolName === 'iconSearch'}
                      {@const isStyleTool =
                        part.toolName === 'autoStyler' || part.toolName === 'styleSearch'}
                      {@const isSearch = part.toolName === 'webSearch'}
                      {@const isFileManager = part.toolName === 'fileManager'}
                      {@const isDiagramRead = part.toolName === 'diagramRead'}
                      {@const isSubagent =
                        part.toolName === 'subagentFanout' || part.toolName === 'subagentAssemble'}
                      {@const isChecker =
                        part.toolName === 'errorChecker' || part.toolName === 'selfCritique'}
                      {@const isAnalytics = part.toolName === 'tableAnalytics'}
                      {@const isThinking =
                        part.toolName === 'thinking' || part.toolName === 'sequentialThinking'}
                      {@const toolDisplayName = getToolDisplayName(part.toolName)}
                      {@const toolIconColor = isDiagramRead
                        ? 'bg-blue-500/10 text-blue-500'
                        : isIconifier || isStyleTool
                          ? 'bg-indigo-500/10 text-indigo-500'
                          : part.toolName === 'askQuestions'
                            ? 'bg-indigo-500/10 text-indigo-500'
                            : isSearch
                              ? 'bg-sky-500/10 text-sky-500'
                              : isFileManager
                                ? 'bg-amber-500/10 text-amber-500'
                                : part.toolName === 'selfCritique'
                                  ? 'bg-rose-500/10 text-rose-500'
                                  : isChecker
                                    ? 'bg-red-500/10 text-red-400'
                                    : part.toolName === 'planner'
                                      ? 'bg-emerald-500/10 text-emerald-500'
                                      : part.toolName === 'actionItemExtractor'
                                        ? 'bg-orange-500/10 text-orange-500'
                                        : isAnalytics
                                          ? 'bg-indigo-500/10 text-indigo-500'
                                          : part.toolName === 'longTermMemory'
                                            ? 'bg-teal-500/10 text-teal-500'
                                            : part.toolName === 'planWithProgress'
                                              ? 'bg-emerald-500/10 text-emerald-500'
                                              : isSubagent
                                                ? 'bg-cyan-500/10 text-cyan-500'
                                                : isThinking
                                                  ? 'bg-yellow-500/10 text-yellow-500'
                                                  : 'bg-muted text-muted-foreground'}
                      <div
                        class="group overflow-hidden rounded-lg border transition-all duration-200
                        {part.status === 'running'
                          ? 'border-border bg-muted/30'
                          : 'border-border bg-muted/20 hover:border-foreground/10'}">
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30"
                          onclick={(e) => {
                            const body = (e.currentTarget as HTMLElement).nextElementSibling;
                            if (body) body.classList.toggle('hidden');
                            const chev = (e.currentTarget as HTMLElement).querySelector(
                              '.tool-chevron'
                            );
                            if (chev) chev.classList.toggle('rotate-90');
                          }}>
                          <div
                            class="flex size-5 shrink-0 items-center justify-center rounded-md {toolIconColor}">
                            {#if isDiagramRead}
                              <Network
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if isIconifier}
                              <Palette
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if isStyleTool}
                              <Paintbrush
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if part.toolName === 'askQuestions'}
                              <MessageCircleQuestion
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if isSearch}
                              <Globe
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if isFileManager}
                              <FileText
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if part.toolName === 'selfCritique'}
                              <Brain
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if isChecker}
                              <ShieldCheck
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if part.toolName === 'planner'}
                              <ClipboardCheck
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if part.toolName === 'actionItemExtractor'}
                              <ListChecks
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if isAnalytics}
                              <ChartBar
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if part.toolName === 'longTermMemory'}
                              <BookOpen
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if part.toolName === 'planWithProgress'}
                              <Target
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if isSubagent}
                              <Network
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else if isThinking}
                              <Lightbulb
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {:else}
                              <Wrench
                                class="size-3 {part.status === 'running' ? 'animate-pulse' : ''}" />
                            {/if}
                          </div>
                          <span
                            class="flex-1 text-xs font-medium
                            {part.status === 'running'
                              ? 'text-foreground'
                              : 'text-muted-foreground'}">
                            <span>{toolDisplayName}</span>
                            <span class="ml-1 text-muted-foreground/70">
                              {#if part.status === 'running'}
                                · {part.message && part.message !== part.toolName
                                  ? part.message
                                  : 'running'}
                              {:else if isIconifier}
                                · {part.iconMode === 'remove'
                                  ? `removed ${removedCount} icon${removedCount !== 1 ? 's' : ''}`
                                  : `${addedCount} icon${addedCount !== 1 ? 's' : ''} added${skippedCount > 0 ? `, ${skippedCount} skipped` : ''}`}
                              {:else if isSearch}
                                · {part.searchResults?.length || 0} result{(part.searchResults
                                  ?.length || 0) !== 1
                                  ? 's'
                                  : ''}
                                {#if part.searchQuery}
                                  · "{part.searchQuery}"{/if}
                              {:else if part.message && part.message !== part.toolName}
                                · {part.message}
                              {/if}
                            </span>
                          </span>
                          {#if part.status === 'running'}
                            {@const dotColor = 'bg-muted-foreground/40'}
                            <div class="flex items-center gap-0.5">
                              <span
                                class="inline-block size-1 animate-pulse rounded-full {dotColor} [animation-delay:0ms]"
                              ></span>
                              <span
                                class="inline-block size-1 animate-pulse rounded-full {dotColor} [animation-delay:150ms]"
                              ></span>
                              <span
                                class="inline-block size-1 animate-pulse rounded-full {dotColor} [animation-delay:300ms]"
                              ></span>
                            </div>
                          {/if}
                          {#if hasDetails && (part.status === 'done' || !isSubagent)}
                            <div class="tool-chevron text-muted-foreground/40 transition-transform">
                              <ChevronRight class="size-3.5" />
                            </div>
                          {/if}
                        </button>
                        {#if hasDetails}
                          <div
                            class="{isSubagent && part.status === 'running'
                              ? ''
                              : 'hidden'} border-t border-border px-3 py-2.5"
                            style="max-height: 250px; overflow-y: auto;">
                            {#if isSubagent && part.subagents?.length}
                              <div class="space-y-1.5">
                                {#each part.subagents as agent (agent.id)}
                                  <div class="rounded-md bg-muted/35 px-2 py-1.5 text-[11px]">
                                    <div class="flex items-center gap-1.5">
                                      <span class="font-medium text-foreground/70"
                                        >{agent.role}</span>
                                      <span class="truncate text-muted-foreground/70"
                                        >{agent.id}</span>
                                      {#if agent.status}
                                        <span
                                          class="ml-auto rounded bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                          {agent.status}
                                        </span>
                                      {/if}
                                    </div>
                                    <p class="mt-0.5 leading-relaxed text-foreground/70">
                                      {agent.objective}
                                    </p>
                                    <div
                                      class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground/60">
                                      {#if agent.modelId}
                                        <span>model: {agent.modelId}</span>
                                      {/if}
                                      {#if agent.durationMs !== undefined}
                                        <span>{(agent.durationMs / 1000).toFixed(1)}s</span>
                                      {/if}
                                      {#if agent.allowedTools?.length}
                                        <span>tools: {agent.allowedTools.join(', ')}</span>
                                      {/if}
                                    </div>
                                    {#if agent.ownedPaths?.length}
                                      <p
                                        class="mt-0.5 truncate text-[10px] text-muted-foreground/50">
                                        {agent.ownedPaths.join(', ')}
                                      </p>
                                    {/if}
                                    {#if agent.events?.length}
                                      <div
                                        class="mt-1.5 space-y-0.5 border-l border-border/70 pl-2">
                                        {#each agent.events as event (`${event.at}:${event.label}`)}
                                          <div class="text-[10px] text-muted-foreground/70">
                                            {event.label}
                                          </div>
                                        {/each}
                                      </div>
                                    {/if}
                                    {#if agent.prompt}
                                      <details class="mt-1.5">
                                        <summary
                                          class="cursor-pointer text-[10px] font-medium text-muted-foreground/70">
                                          Prompt
                                        </summary>
                                        <pre
                                          class="mt-1 rounded bg-background/70 p-2 text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">{agent.prompt}</pre>
                                      </details>
                                    {/if}
                                    {#if agent.output}
                                      <details class="mt-1.5" open={part.status === 'done'}>
                                        <summary
                                          class="cursor-pointer text-[10px] font-medium text-muted-foreground/70">
                                          Output
                                        </summary>
                                        <pre
                                          class="mt-1 rounded bg-background/70 p-2 text-[10px] leading-relaxed whitespace-pre-wrap text-foreground/75">{agent.output}</pre>
                                      </details>
                                    {/if}
                                  </div>
                                {/each}
                              </div>
                              {#if part.details && part.status === 'done'}
                                <div class="mt-2 border-t border-border/70 pt-2">
                                  <div class="space-y-1">
                                    {#each part.details as detail, dIdx (`${detail}:${dIdx}`)}
                                      <div class="flex items-start gap-1.5 text-[11px]">
                                        <span class="mt-0.5 shrink-0 text-muted-foreground/50"
                                          >·</span>
                                        <span class="leading-relaxed text-foreground/70"
                                          >{detail}</span>
                                      </div>
                                    {/each}
                                  </div>
                                </div>
                              {/if}
                            {:else if isIconifier && part.iconResults}
                              <div class="space-y-1">
                                {#each part.iconResults as icon (icon.nodeId)}
                                  <div class="flex items-center gap-2 text-[11px]">
                                    <span
                                      class="shrink-0 {icon.status === 'added'
                                        ? 'text-indigo-500'
                                        : icon.status === 'removed'
                                          ? 'text-red-400'
                                          : 'text-muted-foreground/40'}">
                                      {icon.status === 'added'
                                        ? '✓'
                                        : icon.status === 'removed'
                                          ? '✗'
                                          : '–'}
                                    </span>
                                    <span class="font-medium text-foreground/70"
                                      >{icon.nodeId}</span>
                                    {#if icon.iconId}
                                      <span class="truncate text-muted-foreground/70"
                                        >{icon.iconId}</span>
                                      {#if icon.confidence !== undefined}
                                        <span
                                          class="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">
                                          {Math.round(icon.confidence * 100)}%
                                        </span>
                                      {/if}
                                    {:else if icon.status === 'skipped'}
                                      <span class="truncate text-muted-foreground/40"
                                        >no match</span>
                                    {/if}
                                  </div>
                                {/each}
                              </div>
                            {:else if isSearch && part.searchResults}
                              {#if part.searchReason}
                                <p
                                  class="mb-1.5 text-[11px] leading-relaxed text-muted-foreground/70">
                                  {part.searchReason}
                                </p>
                              {/if}
                              <div class="space-y-1">
                                {#each part.searchResults as result, rIdx (`${result.url ?? result.title}:${rIdx}`)}
                                  <div class="text-[11px]">
                                    <span class="font-medium text-foreground/70"
                                      >{result.title}</span>
                                    {#if result.source}
                                      <span class="ml-1 text-[10px] text-muted-foreground/60"
                                        >{result.source}</span>
                                    {/if}
                                  </div>
                                {/each}
                              </div>
                            {:else if part.details && part.details.length > 0}
                              <div class="space-y-1">
                                {#each part.details as detail, dIdx (`${detail}:${dIdx}`)}
                                  <div class="flex items-start gap-1.5 text-[11px]">
                                    <span class="mt-0.5 shrink-0 text-muted-foreground/50">·</span>
                                    <span class="leading-relaxed text-foreground/70">{detail}</span>
                                  </div>
                                {/each}
                              </div>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    {:else if part.type === 'markdown'}
                      <!-- Markdown content card — teal accent, streaming support -->
                      <div
                        class="group overflow-hidden rounded-lg border transition-all duration-200
                        {part.isStreaming
                          ? 'border-border bg-muted/30'
                          : 'border-border bg-card hover:border-foreground/10'}">
                        <button
                          type="button"
                          class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30"
                          onclick={(e) => {
                            const body = (e.currentTarget as HTMLElement).nextElementSibling;
                            if (body) body.classList.toggle('hidden');
                            const chev = (e.currentTarget as HTMLElement).querySelector(
                              '.md-chevron'
                            );
                            if (chev) chev.classList.toggle('rotate-90');
                          }}>
                          <div
                            class="flex size-5 shrink-0 items-center justify-center rounded-md bg-teal-500/10 text-teal-500">
                            {#if part.isStreaming}
                              <FileText class="size-3 animate-pulse" />
                            {:else}
                              <FileText class="size-3" />
                            {/if}
                          </div>
                          <span class="flex-1 text-xs font-medium text-foreground/80">
                            {#if part.isStreaming}
                              {part.operation === 'read'
                                ? 'Reading Document…'
                                : 'Writing Document…'}
                            {:else}
                              {part.operation === 'read'
                                ? 'Document Read'
                                : part.operation === 'append'
                                  ? 'Content Appended'
                                  : 'Document Written'}
                            {/if}
                            <span class="ml-1 text-[10px] text-muted-foreground">
                              · {part.lines} line{part.lines !== 1 ? 's' : ''}
                            </span>
                          </span>
                          <div
                            class="md-chevron text-muted-foreground/40 transition-transform {part.isStreaming
                              ? 'rotate-90'
                              : ''}">
                            <ChevronRight class="size-3.5" />
                          </div>
                        </button>
                        <div
                          class="{part.isStreaming
                            ? ''
                            : 'hidden'} border-t border-border px-3 py-2.5"
                          style="max-height: 300px; overflow-y: auto;">
                          <pre
                            class="text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/70">{part.content ||
                              '(empty)'}</pre>
                        </div>
                      </div>
                    {:else if part.type === 'questionnaire'}
                      <!-- Questionnaire — indigo accent, streaming support -->
                      <div
                        class="overflow-hidden rounded-lg border transition-all duration-200
                        {part.isStreaming
                          ? 'border-border bg-muted/30'
                          : part.submitted
                            ? 'border-border bg-muted/20'
                            : 'border-border bg-card'}">
                        <!-- Header -->
                        <div
                          class="flex items-center gap-2 border-b border-border px-3
                          py-2">
                          <div
                            class="flex size-5 shrink-0 items-center justify-center rounded-md
                            {part.submitted
                              ? 'bg-emerald-500/10 text-emerald-500'
                              : 'bg-indigo-500/10 text-indigo-500'}">
                            {#if part.isStreaming}
                              <MessageCircleQuestion class="size-3 animate-pulse" />
                            {:else if part.submitted}
                              <Check class="size-3" />
                            {:else}
                              <MessageCircleQuestion class="size-3" />
                            {/if}
                          </div>
                          <span
                            class="flex-1 text-xs font-medium
                            {part.isStreaming
                              ? 'text-foreground'
                              : part.submitted
                                ? 'text-foreground'
                                : 'text-foreground/80'}">
                            {#if part.isStreaming}
                              Preparing questions…
                            {:else if part.submitted}
                              Answers submitted
                            {:else}
                              {part.questions.length} question{part.questions.length !== 1
                                ? 's'
                                : ''}
                            {/if}
                          </span>
                          {#if part.isStreaming}
                            <div class="flex items-center gap-0.5">
                              <span
                                class="inline-block size-1 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:0ms]"
                              ></span>
                              <span
                                class="inline-block size-1 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:150ms]"
                              ></span>
                              <span
                                class="inline-block size-1 animate-pulse rounded-full bg-muted-foreground/40 [animation-delay:300ms]"
                              ></span>
                            </div>
                          {/if}
                        </div>

                        <!-- Body -->
                        <div class="px-3 py-3">
                          {#if part.context}
                            <p class="mb-3 text-[11px] leading-relaxed text-muted-foreground/70">
                              {part.context}
                            </p>
                          {/if}

                          {#if part.isStreaming && part.questions.length === 0}
                            <!-- Skeleton loader while streaming -->
                            <div class="animate-pulse space-y-3">
                              <div class="space-y-1.5">
                                <div class="h-3 w-3/4 rounded bg-muted/40"></div>
                                <div class="h-8 w-full rounded-lg bg-muted/30"></div>
                                <div class="h-8 w-full rounded-lg bg-muted/30"></div>
                              </div>
                              <div class="space-y-1.5">
                                <div class="h-3 w-2/3 rounded bg-muted/40"></div>
                                <div class="h-8 w-full rounded-lg bg-muted/30"></div>
                                <div class="h-8 w-full rounded-lg bg-muted/30"></div>
                                <div class="h-8 w-full rounded-lg bg-muted/30"></div>
                              </div>
                            </div>
                          {:else}
                            <div class="space-y-3">
                              {#each part.questions as q, qi (q.id)}
                                <div>
                                  <p class="mb-1.5 text-[11px] font-semibold text-foreground/80">
                                    {qi + 1}. {q.text}
                                  </p>
                                  {#if q.options.length > 0}
                                    <div class="space-y-1">
                                      {#each q.options as opt (opt.id)}
                                        <label
                                          class="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[11px] transition-all duration-150
                                          {part.submitted
                                            ? 'pointer-events-none border-border opacity-60'
                                            : 'border-border hover:border-foreground/20 hover:bg-accent'}
                                          has-[:checked]:border-foreground/20 has-[:checked]:bg-accent">
                                          {#if q.type === 'multi'}
                                            <input
                                              type="checkbox"
                                              name="{part.id}-{q.id}-{opt.id}"
                                              class="size-3.5 rounded border-border accent-indigo-500"
                                              disabled={part.submitted}
                                              onchange={(e) => {
                                                const resp = questionnaireResponses[part.id] || {};
                                                const current = Array.isArray(resp[q.id])
                                                  ? [...(resp[q.id] as string[])]
                                                  : [];
                                                if ((e.currentTarget as HTMLInputElement).checked) {
                                                  current.push(opt.label);
                                                } else {
                                                  const idx = current.indexOf(opt.label);
                                                  if (idx >= 0) current.splice(idx, 1);
                                                }
                                                questionnaireResponses[part.id] = {
                                                  ...resp,
                                                  [q.id]: current
                                                };
                                                questionnaireResponses = {
                                                  ...questionnaireResponses
                                                };
                                              }} />
                                          {:else}
                                            <input
                                              type="radio"
                                              name="{part.id}-{q.id}"
                                              class="size-3.5 border-border accent-indigo-500"
                                              disabled={part.submitted}
                                              onchange={() => {
                                                const resp = questionnaireResponses[part.id] || {};
                                                questionnaireResponses[part.id] = {
                                                  ...resp,
                                                  [q.id]: opt.label
                                                };
                                                questionnaireResponses = {
                                                  ...questionnaireResponses
                                                };
                                              }} />
                                          {/if}
                                          <span class="text-foreground/80">{opt.label}</span>
                                        </label>
                                      {/each}
                                    </div>
                                  {:else if part.isStreaming}
                                    <!-- Options still loading -->
                                    <div class="animate-pulse space-y-1">
                                      <div class="h-8 w-full rounded-lg bg-muted/30"></div>
                                      <div class="h-8 w-full rounded-lg bg-muted/30"></div>
                                    </div>
                                  {/if}
                                </div>
                              {/each}
                            </div>

                            {#if !part.isStreaming && !part.submitted}
                              <button
                                type="button"
                                class="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90"
                                onclick={() =>
                                  handleQuestionnaireSubmit(
                                    part.id,
                                    part.questions,
                                    part.context,
                                    i
                                  )}>
                                Submit Answers
                              </button>
                            {/if}
                          {/if}
                        </div>
                      </div>
                    {/if}
                  {/each}
                {:else if isLoading && i === messages.length - 1}
                  <div class="flex items-center py-2" aria-live="polite">
                    <span class="thinking-shimmer text-[12px] font-medium text-muted-foreground/60">
                      Thinking…
                    </span>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
  <!-- Scroll to bottom button -->
  {#if showScrollButton && hasMessages}
    <div class="relative">
      <button
        type="button"
        onclick={scrollToBottom}
        aria-label="Scroll to latest message"
        class="absolute -top-10 right-3 z-10 flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-all duration-150 hover:bg-accent hover:text-foreground">
        <ArrowDown class="size-3.5" />
      </button>
    </div>
  {/if}

  <!-- File error toast -->
  {#if fileError}
    <div class="mx-auto flex w-full max-w-3xl items-center gap-2 px-3 sm:px-4">
      <div
        class="flex w-full items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-1.5 text-[11px] font-medium text-destructive">
        <AlertCircle class="size-3.5 shrink-0" />
        <span class="flex-1 truncate">{fileError}</span>
        <button
          type="button"
          aria-label="Dismiss file error"
          class="shrink-0 text-red-400 hover:text-red-300"
          onclick={() => {
            fileError = null;
          }}>✕</button>
      </div>
    </div>
  {/if}

  <!-- Input Area -->
  <div class="mx-auto w-full max-w-3xl shrink-0 px-3 pt-1.5 pb-2 sm:px-4 sm:pt-2 sm:pb-3">
    <PromptInput
      class="rounded-lg border border-border bg-muted text-foreground transition-colors duration-150 focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-ring/10"
      accept={attachmentAccept}
      multiple
      maxFileSize={20 * 1024 * 1024}
      onError={(err) => {
        fileError = err.message;
        if (fileErrorTimeout) clearTimeout(fileErrorTimeout);
        fileErrorTimeout = setTimeout(() => {
          fileErrorTimeout = null;
          fileError = null;
        }, 5000);
      }}
      onSubmit={(message) => handleSubmit(message)}>
      <!-- Attachment previews -->
      <PromptInputAttachments>
        {#snippet children(file)}
          <PromptInputAttachment data={file} />
        {/snippet}
      </PromptInputAttachments>
      <PromptInputBody>
        <Textarea
          class="field-sizing-content min-h-10 w-full resize-none rounded-none border-none bg-transparent px-3.5 py-2.5 text-[13px] text-foreground shadow-none ring-0 outline-none placeholder:text-muted-foreground/60 focus-visible:ring-0 sm:min-h-[44px] dark:bg-transparent"
          style="max-height: min(240px, 40vh);"
          name="message"
          aria-label="Message"
          placeholder={selectedContext.type
            ? `Ask about the selected ${selectedContext.type}…`
            : 'Describe your diagram…'}
          bind:value={inputText}
          disabled={isLoading}
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              const form = (e.currentTarget as HTMLTextAreaElement).form;
              if (form) form.requestSubmit();
            }
          }} />
      </PromptInputBody>
      <PromptInputToolbar class="px-2 pb-2">
        <PromptInputTools>
          <!-- Attachment button -->
          <button
            type="button"
            class="flex size-7 cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
            title={selectedModel?.imageSupport
              ? 'Attach images, PDFs, Markdown, or text files'
              : 'Attach PDFs, Markdown, or text files'}
            aria-label="Attach files"
            onclick={(e) => {
              e.preventDefault();
              const wrapper = (e.currentTarget as HTMLElement).closest('.mx-auto');
              const fileInput = wrapper?.querySelector('input[type="file"]') as HTMLInputElement;
              if (fileInput) fileInput.click();
            }}>
            <Paperclip class="size-3" />
          </button>
          <!-- Improve prompt button -->
          {#if inputText.trim().length > 0}
            <button
              type="button"
              class="flex size-7 cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground {isImprovingPrompt
                ? 'animate-pulse border-violet-500/40 bg-violet-500/10 text-violet-500'
                : ''}"
              title={isImprovingPrompt ? 'Improving…' : 'Improve prompt'}
              aria-label={isImprovingPrompt ? 'Improving prompt' : 'Improve prompt'}
              disabled={isImprovingPrompt || isLoading}
              onclick={improvePrompt}>
              {#if isImprovingPrompt}
                <div
                  class="size-3 animate-spin rounded-full border-2 border-violet-500 border-t-transparent">
                </div>
              {:else}
                <Sparkles class="size-3" />
              {/if}
            </button>
          {/if}
          <!-- Model picker -->
          <Popover.Root
            bind:open={modelPopoverOpen}
            onOpenChange={(open) => {
              if (open) {
                // Refresh on every open so admin changes show without reload
                modelsStore.fetch();
              } else {
                modelSearchQuery = '';
              }
            }}>
            <Popover.Trigger
              aria-label="Select model"
              class="flex h-7 max-w-[180px] cursor-pointer items-center gap-1 rounded-full border border-border bg-background px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent">
              <span class="truncate">
                {selectedModel ? selectedModel.name : 'Model'}
              </span>
              <ChevronsUpDown class="size-2.5 shrink-0 text-muted-foreground/60" />
            </Popover.Trigger>
            <Popover.Content
              class="w-[280px] overflow-hidden rounded-lg border border-border bg-popover p-0 shadow-lg"
              align="start"
              sideOffset={6}>
              <!-- Search -->
              <div class="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
                <Search class="size-3 shrink-0 text-muted-foreground/60" />
                <input
                  type="text"
                  name="model-search"
                  aria-label="Search models"
                  placeholder="Search…"
                  class="h-5 w-full bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50"
                  bind:value={modelSearchQuery} />
                <button
                  type="button"
                  class="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                  title="Refresh models"
                  aria-label="Refresh models"
                  disabled={modelsStore.isLoading}
                  onclick={() => modelsStore.fetch()}>
                  <RefreshCw class="size-3 {modelsStore.isLoading ? 'animate-spin' : ''}" />
                </button>
              </div>
              <!-- Model list -->
              <div class="max-h-[300px] overflow-y-auto overscroll-contain">
                {#if modelsStore.isLoading && modelsStore.models.length === 0}
                  <div class="flex items-center justify-center py-6">
                    <div class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <div
                        class="size-2.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground">
                      </div>
                      Loading…
                    </div>
                  </div>
                {:else if filteredModels.length === 0}
                  <div class="flex flex-col items-center justify-center gap-1.5 py-6">
                    <Search class="size-4 text-muted-foreground/20" />
                    <span class="text-[11px] text-muted-foreground/60">No models</span>
                  </div>
                {:else}
                  {#each groupedModels as [provider, providerModels] (provider)}
                    <div
                      class="sticky top-0 z-10 bg-popover/95 px-2 pt-1.5 pb-0.5 backdrop-blur-sm">
                      <span
                        class="text-[9px] font-semibold tracking-wider text-muted-foreground/70 uppercase"
                        >{providerLabel(provider)}</span>
                    </div>
                    {#each providerModels as model (model.id)}
                      {@const isSelected = selectedModelId === model.id}
                      <button
                        type="button"
                        class="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1 text-left transition-colors hover:bg-accent {isSelected
                          ? 'bg-accent'
                          : ''}"
                        onclick={() => {
                          modelsStore.select(model.id);
                          modelPopoverOpen = false;
                          modelSearchQuery = '';
                        }}>
                        <span
                          class="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground"
                          >{model.name}</span>
                        {#if model.isFree}
                          <span
                            class="rounded bg-emerald-500/10 px-1 font-mono text-[9px] font-medium tracking-wide text-emerald-500/80 uppercase">
                            Free
                          </span>
                        {/if}
                        {#if isSelected}
                          <Check class="size-3 shrink-0 text-foreground" />
                        {:else}
                          <span class="size-3 shrink-0"></span>
                        {/if}
                      </button>
                    {/each}
                  {/each}
                {/if}
              </div>
            </Popover.Content>
          </Popover.Root>
          <!-- Context usage -->
          <div
            class="flex size-7 items-center justify-center"
            title={contextTitle}
            aria-label={contextTitle}>
            <svg class="size-5" viewBox="0 0 36 36">
              <circle
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                class="text-border" />
              <circle
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke-width="3"
                stroke-linecap="round"
                class="stroke-black transition-all duration-500 dark:stroke-white"
                stroke-dasharray="{contextPercent * 0.8796} 87.96"
                transform="rotate(-90 18 18)" />
            </svg>
          </div>
        </PromptInputTools>
        <div class="flex items-center gap-1.5">
          <!-- Mic button -->
          <button
            type="button"
            class="flex size-7 cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground transition-colors duration-150 {isRecording
              ? 'border-destructive/50 bg-destructive/10 text-destructive'
              : isTranscribing
                ? 'border-foreground/20 bg-accent text-foreground'
                : 'hover:bg-accent hover:text-foreground'}"
            title={isRecording
              ? 'Stop recording'
              : isTranscribing
                ? 'Transcribing…'
                : 'Voice input'}
            disabled={isTranscribing}
            aria-label={isRecording ? 'Stop recording' : 'Voice input'}
            onclick={() => {
              if (isRecording) stopRecording();
              else startRecording();
            }}>
            {#if isTranscribing}
              <div
                class="size-3 animate-spin rounded-full border-2 border-foreground border-t-transparent">
              </div>
            {:else}
              <svg
                class="size-3"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
                ><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" /><path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line
                  x1="8"
                  y1="23"
                  x2="16"
                  y2="23" /></svg>
            {/if}
          </button>
          <!-- Send / Stop / Processing -->
          {#if isProcessingFiles}
            <div
              class="flex size-7 items-center justify-center rounded-full"
              title="Processing files…"
              role="status"
              aria-label="Processing files">
              <div
                class="size-3 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-500">
              </div>
            </div>
          {:else if isLoading}
            <button
              type="button"
              onclick={stopStream}
              aria-label="Stop response"
              class="flex size-7 items-center justify-center rounded-full border border-border text-foreground transition-colors duration-150 hover:bg-accent">
              <Square class="size-2.5" fill="currentColor" />
            </button>
          {:else}
            <PromptInputSubmit
              status={chatStatus}
              aria-label="Send message"
              class="size-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90" />
          {/if}
        </div>
      </PromptInputToolbar>
    </PromptInput>
  </div>
</div>

<style>
  .thinking-shimmer {
    background: linear-gradient(90deg, currentColor 0%, var(--foreground) 42%, currentColor 82%);
    background-size: 220% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer-slide 1.8s ease-in-out infinite;
  }

  @keyframes shimmer-slide {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .thinking-shimmer {
      animation: none;
      background: none;
      -webkit-text-fill-color: currentColor;
    }
  }
</style>
