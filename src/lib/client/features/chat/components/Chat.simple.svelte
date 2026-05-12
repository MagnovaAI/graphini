<script lang="ts">
  import * as Popover from '$lib/client/ui/popover';
  import { Textarea } from '$lib/client/ui/textarea';
  import {
    PromptInput,
    PromptInputAttachment,
    PromptInputAttachments,
    PromptInputBody,
    PromptInputSubmit,
    PromptInputToolbar,
    PromptInputTools
  } from '$lib/client/features/chat/components/ai-elements';
  import { CodeArtifact } from '$lib/client/features/chat/components/ai-elements/code-artifact';
  import type {
    AttachmentsContext,
    PromptInputMessage
  } from '$lib/client/features/chat/components/ai-elements/prompt-input';
  import { Response } from '$lib/client/features/chat/components/ai-elements/response';
  import type {
    Artifact,
    Checkpoint,
    ContentPart,
    DisplayContentPart,
    QuestionnaireQuestion
  } from '$lib/client/features/chat/content-parts/types';
  import { toolVerbs } from '$lib/client/features/chat/content-parts/tool-display';
  import { toolIcon } from '$lib/client/features/chat/content-parts/tool-icons';
  import {
    buildDiagramLineEditPreview,
    buildLineEditPreview,
    mermaidDeclarationPattern
  } from '$lib/client/features/chat/stream/preview';
  import {
    deriveToolInputDisplay,
    parsePartialQuestionnaire,
    parsePartialThoughts,
    parseStreamingContent
  } from '$lib/client/features/chat/stream/tool-input-summary';
  import {
    deriveErrorCheckerSubtitle,
    deriveSearchResults,
    deriveToolDetails,
    deriveToolSubtitle
  } from '$lib/client/features/chat/stream/tool-output-summary';
  import {
    createConversation,
    fetchConversationMessages,
    isGuestLimitError,
    postConversationMessages,
    type GuestLimitError
  } from '$lib/client/features/chat/persistence/db-api';
  import {
    bestVisibleContent,
    messagesFromDbRows,
    partsFromDbRows
  } from '$lib/client/features/chat/persistence/db-mappers';
  import type { DbMessageRow } from '$lib/client/features/chat/persistence/db-types';
  import { parse as mermaidParse } from '$lib/client/features/diagram/mermaid';
  import { canvasStatus } from '$lib/client/stores/canvasStatus.svelte';
  import { authStore } from '$lib/client/stores/auth.svelte';
  import { documentMarkdownStore } from '$lib/client/stores/documentStore.svelte';
  import { filesStore } from '$lib/client/stores/files.svelte';
  import { workspaceStore } from '$lib/client/stores/workspace.svelte';
  import { kv } from '$lib/client/stores/kvStore.svelte';
  import { modelsStore } from '$lib/client/stores/models.svelte';
  import {
    aiSettings,
    personalizationSettings,
    uiSettings
  } from '$lib/client/stores/settings.svelte';
  import { providerKeyHeaders } from '$lib/client/util/provider-keys';
  import ProviderIcon from '$lib/client/features/chat/components/ProviderIcon.svelte';
  import ToolSimpleChip from '$lib/client/features/chat/components/ToolSimpleChip.svelte';
  import {
    ChainOfTools,
    ChainOfToolsContent,
    ChainOfToolsHeader,
    ChainOfToolsStep
  } from '$lib/client/ui/ai-elements/chain-of-tools';
  import {
    ChainOfThought,
    ChainOfThoughtContent,
    ChainOfThoughtHeader,
    ChainOfThoughtStep
  } from '$lib/client/ui/ai-elements/chain-of-thought';
  import TooltipWrap from '$lib/client/ui/tooltip/TooltipWrap.svelte';
  // sessionFilesStore removed — workspace handles state
  import { toolsStore } from '$lib/client/stores/toolsStore.svelte';
  import { svgIdToNodeName } from '$lib/client/util/diagram/diagramMapper';
  import { inputStateStore, stateStore, updateCodeStore } from '$lib/client/util/state/state';
  import {
    AlertCircle,
    ArrowDown,
    Brain,
    Building2,
    Check,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    Database,
    FileText,
    MessageCircleQuestion,
    Mic,
    Palette,
    Plus,
    RefreshCw,
    RotateCcw,
    Search,
    Smartphone,
    Sparkles,
    Square,
    Undo2,
    Wrench,
    X,
    Zap
  } from 'lucide-svelte';
  import { onMount, tick } from 'svelte';
  // get from svelte/store not needed — removed
  import { v4 as uuidv4 } from 'uuid';

  // Per-file chat state: each file gets its own conversation
  const GUEST_MAX_UPLOAD_SIZE = 2 * 1024 * 1024;
  const USER_MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

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

  function previewDiagramToolInput(
    mode: 'full' | 'line-edit',
    inputJson: string,
    content: string,
    artifactId: string
  ) {
    if (!content.trim() || !currentInputTargetsActiveTab(inputJson)) return false;
    if (mode === 'full' && !mermaidDeclarationPattern.test(content.trim())) {
      return false;
    }

    const nextCode =
      mode === 'line-edit'
        ? buildDiagramLineEditPreview(
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
  // When the page-level loadConversation() is driving a chat switch, it owns
  // the message restore. Skip the legacy file-change restore path to avoid
  // the upfront `messages = []` blank that flashes the empty landing.
  let skipNextFileRestore = false;

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
      if (skipNextFileRestore) {
        skipNextFileRestore = false;
        return;
      }
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
  let guestLimitNotice = $state<GuestLimitError | null>(null);
  let dbSyncTimeout: ReturnType<typeof setTimeout> | null = null;

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

  function applyDbMessages(convId: string, rows: DbMessageRow[]) {
    messages = messagesFromDbRows(rows);
    const restored = partsFromDbRows(rows);
    messageParts = restored.parts;
    if (Object.keys(restored.artifacts).length > 0) {
      // Merge over any KV-restored artifactMap. DB is authoritative for the
      // bodies we explicitly inlined; KV-only artifacts (older messages whose
      // sync predates inlining) are preserved.
      artifactMap = { ...artifactMap, ...restored.artifacts };
    }
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

  function visibleMessageContent(message: Record<string, unknown>, index: number): string {
    return bestVisibleContent({
      content: message.content,
      parts: messageParts[index],
      role: message.role
    });
  }

  function modelContextContent(message: Record<string, unknown>, index: number): string {
    if (
      message.role === 'user' &&
      typeof message.contextContent === 'string' &&
      message.contextContent.trim()
    ) {
      return message.contextContent;
    }
    return visibleMessageContent(message, index);
  }

  function localChatLooksRicherThanDb(rows: DbMessageRow[]): boolean {
    if (messages.length > rows.length) return true;
    if (messages.length < rows.length) return false;

    const dbMessages = messagesFromDbRows(rows);
    for (let i = 0; i < messages.length; i++) {
      const localText = visibleMessageContent(messages[i], i).trim();
      const dbText = String(dbMessages[i]?.content ?? '').trim();
      if (localText.length > dbText.length) return true;
    }
    return false;
  }

  async function ensureDbConversation(): Promise<string | null> {
    // Both logged-in users and guests can persist conversations. Only fully
    // anonymous (no auth user object at all) callers are skipped.
    if (!authStore.user) return null;
    if (dbConversationId) return dbConversationId;
    const saved = getDbConversationId();
    if (saved) {
      dbConversationId = saved;
      return saved;
    }
    const created = await createConversation({
      fileId: getCurrentFileId(),
      title: conversationTitle || 'New Chat'
    });
    if (isGuestLimitError(created)) {
      guestLimitNotice = created;
      return null;
    }
    if (!created) return null;
    const newConvId = created.id;
    setDbConversationId(newConvId);
    if (newConvId) {
      try {
        kv.set('chat', chatKey('activeConversationId'), newConvId);
      } catch {
        /* ignore */
      }
      // Refresh conversations list so history panel shows the new conversation
      import('$lib/client/stores/conversations.svelte')
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

  async function syncMessagesToDb() {
    if (!authStore.hasIdentity || messages.length === 0 || !conversationStarted) return;
    const convId = await ensureDbConversation();
    if (!convId) return;
    // Re-sync the trailing window so messages whose state finalized after
    // the first sync (artifact bodies, reasoning text, tool-simple done state)
    // get persisted. The server upserts on conflict by clientId.
    const RESYNC_TAIL = 3;
    const start = Math.max(0, Math.min(dbSyncedMessageCount, messages.length - RESYNC_TAIL));
    const newMessages = messages.slice(start);
    if (newMessages.length === 0) return;
    const payload = newMessages.map((m: Record<string, unknown>, i: number) => {
      const globalIdx = start + i;
      let safeParts: unknown = null;
      try {
        const raw = messageParts[globalIdx];
        if (raw) {
          // Inline artifact bodies so DB-only restores (different machine,
          // cleared KV, conversation switch across files) don't lose them.
          // Streaming artifacts are skipped — they'll inline on the next sync.
          const enriched = (raw as ContentPart[]).map((part: ContentPart) => {
            if (part.type === 'artifact') {
              const art = artifactMap[part.artifactId];
              if (art && !art.isStreaming) {
                return { ...part, artifact: { ...art, isStreaming: false } };
              }
            }
            return part;
          });
          safeParts = JSON.parse(JSON.stringify(enriched));
        }
      } catch {
        /* ignore */
      }
      // DB has content_not_empty constraint — never send empty string. Prefer
      // rendered assistant text from parts when the content column is a
      // placeholder or stale partial stream.
      const rawContent = visibleMessageContent(m, globalIdx);
      const content = rawContent && rawContent.trim() ? rawContent : '[tool call]';
      const contextContent =
        m.role === 'user' &&
        typeof m.contextContent === 'string' &&
        m.contextContent.trim() &&
        m.contextContent !== m.content
          ? m.contextContent
          : undefined;
      return {
        content,
        metadata: {
          attachments: m.attachments,
          clientId: typeof m.id === 'string' ? m.id : undefined,
          contextContent,
          timestamp: m.timestamp
        },
        model_used:
          m.role === 'assistant'
            ? ((m.model_used as string | undefined) ?? (selectedModelId as string | undefined))
            : undefined,
        parts: safeParts,
        role: m.role as string
      };
    });
    const ok = await postConversationMessages(convId, payload);
    if (ok) {
      dbSyncedMessageCount = messages.length;
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
    if (!authStore.hasIdentity) return false;
    const convId = getDbConversationId();
    if (!convId) return false;
    const result = await fetchConversationMessages(convId);
    if (result.status === 'gone') {
      clearCurrentFileChatCache();
      setDbConversationId(null);
      applyDbMessages('', []);
      return true;
    }
    if (result.status === 'error' || !result.rows) return false;
    if (messages.length > 0 && localChatLooksRicherThanDb(result.rows)) {
      dbConversationId = convId;
      conversationStarted = true;
      debouncedDbSync();
      return true;
    }
    applyDbMessages(convId, result.rows);
    saveChatState();
    return true;
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
        await kv.init({ force: authStore.hasIdentity });
        toolsStore.syncFromKv();
        // Restore from KV cache (instant after init)
        restoreChatState();

        // Wait up to 3s for auth to initialize, then try DB restore to merge/override
        for (let i = 0; i < 30; i++) {
          if (authStore.isInitialized) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        if (authStore.hasIdentity) {
          // Check if there's a saved active conversation ID (from switching conversations)
          const savedActiveConvId = kv.get<string | null>('chat', chatKey('activeConversationId'));
          if (savedActiveConvId) {
            // Load the specific conversation the user was viewing
            setDbConversationId(savedActiveConvId);
            const restored = await restoreChatFromDb();
            if (restored) {
              conversationStarted = messages.length > 0;
              // Update conversationsStore active ID to match
              const { conversationsStore } = await import(
                '$lib/client/stores/conversations.svelte'
              );
              await conversationsStore.fetch();
              conversationsStore.setActive(savedActiveConvId);
            }
          } else {
            const restored = await restoreChatFromDb();
            if (restored) {
              conversationStarted = messages.length > 0;
            }
          }
        } else if (authStore.isInitialized && !authStore.hasIdentity) {
          // Genuinely anonymous (no auth user, no guest cookie). Reset chat to
          // a clean slate; nothing to restore from server.
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
      if (authStore.hasIdentity && conversationStarted && messages.length > 0) {
        syncMessagesToDb();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Periodic DB sync every 60s to avoid data loss
    const periodicSyncInterval = setInterval(() => {
      if (authStore.hasIdentity && conversationStarted && messages.length > 0) {
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
    // Then try DB restore if we have any identity (logged-in OR guest)
    if (authStore.hasIdentity && dbConversationId) {
      restoreChatFromDb().then((restored) => {
        if (restored) conversationStarted = messages.length > 0;
      });
    }
  }

  let isDataReady = $state(false);
  let messages: Record<string, unknown>[] = $state([]);
  let inputText = $state('');
  let inputExpanded = $state(false);
  let inputOverflow = $state(false);
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let composerAttachments = $state<AttachmentsContext | null>(null);

  const PASTE_AS_FILE_CHAR_THRESHOLD = 5000;
  let pastedFileCount = 0;

  function handleInputPaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    const combinedLen = inputText.length + text.length;
    if (text.length < PASTE_AS_FILE_CHAR_THRESHOLD && combinedLen < PASTE_AS_FILE_CHAR_THRESHOLD) {
      return;
    }
    if (!composerAttachments) return;
    e.preventDefault();
    pastedFileCount += 1;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const filename = `pasted-${stamp}${pastedFileCount > 1 ? `-${pastedFileCount}` : ''}.txt`;
    const file = new File([text], filename, { type: 'text/plain' });
    composerAttachments.add([file]);
  }

  let fileError = $state<string | null>(null);
  let isLoading = $state(false);
  let conversationStarted = $state(false);
  let conversationTitle = $state<string | null>(null);

  const INPUT_COLLAPSED_MAX = 144;

  $effect(() => {
    void inputText;
    if (!inputEl) return;
    queueMicrotask(() => {
      if (!inputEl) return;
      const prevExpanded = inputExpanded;
      if (!prevExpanded) {
        inputOverflow = inputEl.scrollHeight - 1 > INPUT_COLLAPSED_MAX;
      } else {
        inputOverflow = true;
      }
      if (!inputText) {
        inputExpanded = false;
        inputOverflow = false;
      }
    });
  });

  // Checkpoint system: save diagram state before each user message
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
  let expandedUserMessages = $state<Record<number, boolean>>({});

  const USER_MSG_COLLAPSE_THRESHOLD = 600;

  function toggleUserMessageExpanded(idx: number) {
    expandedUserMessages = {
      ...expandedUserMessages,
      [idx]: !expandedUserMessages[idx]
    };
  }

  // Per-message artifact tracking with unique IDs
  // Artifacts stored by ID for quick lookup
  let artifactMap = $state<Record<string, Artifact>>({});
  let artifactIdsByToolCall = $state<Record<string, string>>({});
  let reasoningExpanded = $state<Record<string, boolean>>({});
  let toolSimpleExpanded = $state<Record<string, boolean>>({});

  function updateToolSimple(
    assistantIdx: number,
    toolCallId: string | undefined,
    update: {
      subtitle?: string;
      details?: string[];
      status?: 'running' | 'done';
      toolInput?: { path?: unknown; from?: unknown; operation?: unknown };
      titlePending?: string;
      titleDone?: string;
    }
  ): void {
    const simpleId = `tool-simple-${toolCallId ?? currentToolCallId}`;
    const parts = messageParts[assistantIdx] || [];
    const idx = parts.findIndex((p) => p.type === 'tool-simple' && p.id === simpleId);
    if (idx >= 0 && parts[idx].type === 'tool-simple') {
      parts[idx] = {
        ...parts[idx],
        ...(update.subtitle !== undefined ? { subtitle: update.subtitle } : {}),
        ...(update.details !== undefined ? { details: update.details } : {}),
        ...(update.status !== undefined ? { status: update.status } : {}),
        ...(update.toolInput !== undefined ? { toolInput: update.toolInput } : {}),
        ...(update.titlePending !== undefined ? { titlePending: update.titlePending } : {}),
        ...(update.titleDone !== undefined ? { titleDone: update.titleDone } : {})
      };
      messageParts[assistantIdx] = [...parts];
    }
  }

  function ensureToolSimple(
    assistantIdx: number,
    toolCallId: string | undefined,
    toolName: string,
    verbs = toolVerbs(toolName)
  ): void {
    const simpleId = `tool-simple-${toolCallId ?? currentToolCallId}`;
    const parts = messageParts[assistantIdx] || [];
    if (parts.some((p) => p.type === 'tool-simple' && p.id === simpleId)) return;
    parts.push({
      id: simpleId,
      status: 'running',
      titleDone: verbs.done,
      titlePending: verbs.pending,
      toolName,
      type: 'tool-simple'
    });
    messageParts[assistantIdx] = [...parts];
  }

  /** Try to parse the streaming tool-input JSON to extract `operation`/`path`
   *  for tool-icons to use. JSON may be incomplete; tolerate failures. */
  function normalizeFileSystemOperation(operation: unknown): string | undefined {
    if (operation === 'update' || operation === 'patch') return 'edit';
    return typeof operation === 'string' ? operation : undefined;
  }

  function parsePartialToolInput(
    raw: string
  ): { operation?: string; path?: string; from?: string } | undefined {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as {
        content?: unknown;
        operation?: string;
        path?: string;
        startLine?: unknown;
      };
      return {
        ...parsed,
        operation:
          normalizeFileSystemOperation(parsed.operation) ??
          (typeof parsed.content === 'string' &&
          typeof parsed.path === 'string' &&
          parsed.startLine !== undefined
            ? 'edit'
            : typeof parsed.content === 'string' && typeof parsed.path === 'string'
              ? 'create'
              : typeof parsed.path === 'string'
                ? 'read'
                : undefined)
      };
    } catch {
      // Best-effort: extract just operation/path via simple regex on the
      // partial JSON so the icon can update before the call completes.
      const op = raw.match(/"operation"\s*:\s*"([^"]+)"/);
      const p = raw.match(/"path"\s*:\s*"([^"]+)"/);
      const f = raw.match(/"from"\s*:\s*"([^"]+)"/);
      const hasContent = /"content"\s*:/.test(raw);
      const hasStartLine = /"startLine"\s*:/.test(raw);
      const inferredOperation =
        normalizeFileSystemOperation(op?.[1]) ??
        (hasContent && p?.[1] && hasStartLine
          ? 'edit'
          : hasContent && p?.[1]
            ? 'create'
            : p?.[1]
              ? 'read'
              : undefined);
      if (!inferredOperation && !p && !f) return undefined;
      return { operation: inferredOperation, path: p?.[1], from: f?.[1] };
    }
  }
  let reasoningStarted = $state<Record<string, number>>({});
  let reasoningDuration = $state<Record<string, number>>({});
  let reasoningNow = $state(Date.now());

  $effect(() => {
    const interval = setInterval(() => {
      reasoningNow = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  });

  $effect(() => {
    const now = Date.now();
    const indices = Object.keys(messageParts)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    for (const mIdx of indices) {
      const parts = messageParts[mIdx];
      if (!parts) continue;
      for (const part of parts) {
        if (part.type !== 'reasoning') continue;
        const streaming = part.status === 'running';
        if (streaming && reasoningStarted[part.id] === undefined) {
          reasoningStarted[part.id] = now;
        }
        if (
          !streaming &&
          reasoningStarted[part.id] !== undefined &&
          reasoningDuration[part.id] === undefined
        ) {
          reasoningDuration[part.id] = now - reasoningStarted[part.id];
          const k = `reasoning-expanded:${part.id}`;
          if (reasoningExpanded[k] !== undefined) {
            const next = { ...reasoningExpanded };
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete next[k];
            reasoningExpanded = next;
          }
        }
      }
    }
  });

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

  function languageForWorkspacePath(path: string): string {
    const lower = path.toLowerCase();
    if (lower.endsWith('.mermaid') || lower.endsWith('.mmd')) return 'mermaid';
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
    if (lower.endsWith('.md')) return 'markdown';
    if (lower.endsWith('.svelte')) return 'svelte';
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
    if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
    if (lower.endsWith('.html')) return 'html';
    if (lower.endsWith('.css')) return 'css';
    return 'text';
  }

  function artifactTitleForWorkspaceWrite(op: string, path: string): string {
    const fileName = path.split('/').pop() || path || 'file';
    const verb = op === 'create' ? 'Create' : 'Edit';
    return `${fileName} ${verb}`;
  }

  function artifactOperationForFileSystem(op: string): Artifact['operation'] {
    return op === 'create' ? 'create' : 'edit';
  }

  function messageKey(message: Record<string, unknown>, index: number) {
    // Include `index` as a tiebreaker so duplicate ids (which can briefly
    // happen when an optimistic message coexists with the persisted one) don't
    // crash the runtime with each_key_duplicate. Chat is append-only so the
    // index is stable for a given message.
    const base = message.id ?? `${message.role ?? 'message'}:${message.timestamp ?? 'no-ts'}`;
    return `${String(base)}:${index}`;
  }

  function attachmentKey(attachment: Record<string, unknown>, index: number) {
    return String(
      attachment.fileId ??
        attachment.url ??
        `${attachment.filename ?? 'file'}:${attachment.size ?? ''}:${index}`
    );
  }

  function contentPartKey(part: DisplayContentPart, index: number) {
    if (part.type === 'artifact') return part.artifactId;
    if ('id' in part) return part.id;
    if (part.type === 'text') return `text:${part.text.slice(0, 40)}:${index}`;
    if (part.type === 'error') return `error:${part.error}:${index}`;
    return `part:${index}`;
  }

  function chainDisplayParts(parts: ContentPart[]): DisplayContentPart[] {
    return parts;
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

  function appendReasoningText(currentText: string, delta: string): string {
    const nextText = `${currentText}${delta}`;
    return currentText.length === 0 ? nextText.replace(/^\s+/, '') : nextText;
  }

  function uniqueToolDetails(details: string[]): string[] {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const seen = new Set<string>();
    return details.filter((detail) => {
      const key = detail.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizeQuestionnaireQuestions(value: unknown): QuestionnaireQuestion[] {
    let raw = value;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        return [
          {
            id: 'q1',
            text: 'How would you like to proceed?',
            type: 'single',
            options: [
              { id: 'a', label: 'Continue with best judgment' },
              { id: 'b', label: 'Ask me in chat' }
            ]
          }
        ];
      }
    }
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((q): q is Record<string, unknown> => q !== null && typeof q === 'object')
      .map((q, index) => ({
        id: typeof q.id === 'string' && q.id ? q.id : `q${index + 1}`,
        options: Array.isArray(q.options)
          ? q.options
              .filter(
                (opt): opt is Record<string, unknown> =>
                  opt !== null && typeof opt === 'object' && typeof opt.label === 'string'
              )
              .map((opt, optIndex) => ({
                id:
                  typeof opt.id === 'string' && opt.id
                    ? opt.id
                    : String.fromCharCode(97 + optIndex),
                label: opt.label
              }))
          : [],
        text: typeof q.text === 'string' && q.text ? q.text : 'Please choose an option',
        type: q.type === 'multi' ? 'multi' : 'single'
      }));
  }

  let questionnaireResponses = $state<Record<string, Record<string, string | string[]>>>({});
  let messageParts = $state<Record<number, ContentPart[]>>({});

  // Active pending questionnaire (rendered in place of the chat input).
  // Only the *last* message can carry one — anything earlier has already been
  // answered (the user reply that followed isn't always re-synced to the DB,
  // so we infer "answered" from conversation position rather than the
  // submitted flag alone).
  let pendingQuestionnaire = $derived.by(() => {
    if (!messages.length) return null;
    const lastIdx = messages.length - 1;
    if ((messages[lastIdx] as { role?: string }).role !== 'assistant') return null;
    const parts = messageParts[lastIdx];
    if (!parts) return null;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.type !== 'questionnaire') continue;
      if (p.submitted) continue;
      if (!p.questions || p.questions.length === 0) continue;
      return { part: p, assistantIdx: lastIdx };
    }
    return null;
  });

  // Tool streaming state
  let currentToolCallId = $state<string | null>(null);
  let currentToolName = $state('');
  let currentToolInputJson = $state('');
  let currentReasoningId = $state<string | null>(null);
  let streamCanvasTimer: ReturnType<typeof setTimeout> | null = null;
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
  let attachmentAccept = '.pdf,.txt,.md,.markdown,text/plain,text/markdown,application/pdf';
  let hasMessages = $derived(messages.length > 0);
  let hasDiagram = $derived(($stateStore.code || '').trim().length > 20);

  // Contextual suggestions based on current state
  let suggestions = $derived.by(() => {
    if (hasDiagram) {
      return [
        {
          icon: Palette,
          label: 'Style it',
          hint: 'Add colors, icons, and layout polish',
          prompt: 'Make the diagram visually stunning with colors, icons, and professional styling'
        },
        {
          icon: Plus,
          label: 'Expand',
          hint: 'Add nodes, edges, and missing detail',
          prompt: 'Add more nodes, connections, and detail to make the diagram more comprehensive'
        },
        {
          icon: FileText,
          label: 'Document',
          hint: 'Write notes for the document panel',
          prompt: 'Write detailed documentation explaining this diagram in the document panel'
        },
        {
          icon: Search,
          label: 'Review',
          hint: 'Check completeness and best practices',
          prompt: 'Review this diagram for completeness, best practices, and suggest improvements'
        },
        {
          icon: RefreshCw,
          label: 'Convert',
          hint: 'Change diagram type, keep the meaning',
          prompt: 'Convert this diagram to a different type while preserving the information'
        },
        {
          icon: Wrench,
          label: 'Fix errors',
          hint: 'Repair syntax and rendering issues',
          prompt: 'Check this diagram for syntax errors and fix any issues found'
        }
      ];
    }
    return [
      {
        icon: Building2,
        label: 'System Architecture',
        hint: 'Services, databases, queues, and traffic',
        prompt:
          'Design a cloud architecture diagram with microservices, databases, load balancers, and message queues'
      },
      {
        icon: RefreshCw,
        label: 'User Flow',
        hint: 'Login, signup, reset, and OAuth',
        prompt:
          'Create a user authentication flow with login, signup, password reset, and OAuth options'
      },
      {
        icon: Database,
        label: 'Database Schema',
        hint: 'Entities, relationships, and keys',
        prompt:
          'Design an ER diagram for an e-commerce platform with users, products, orders, and payments'
      },
      {
        icon: Brain,
        label: 'Mind Map',
        hint: 'Explore ideas and structure branches',
        prompt: 'Create a mind map brainstorming ideas for a startup product launch strategy'
      },
      {
        icon: Zap,
        label: 'CI/CD Pipeline',
        hint: 'Commit, test, deploy, and release',
        prompt:
          'Build a CI/CD pipeline diagram showing code commit to production deployment with testing stages'
      },
      {
        icon: Smartphone,
        label: 'App Screens',
        hint: 'Mobile app, API, and integrations',
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
      const res = await fetch('/api/audio', {
        method: 'POST',
        body: formData,
        headers: providerKeyHeaders(aiSettings.value)
      });
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
  interface ServerContextUsage {
    breakdown?: Record<string, number>;
    budgetTokens?: number;
    compacted?: boolean;
    contextWindow?: number;
    contextWindowPercent?: number;
    estimated?: boolean;
    estimatedUsedTokens?: number;
    historyBudgetTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    percent?: number;
    totalTokens?: number;
    type: 'context-usage' | 'context-usage-final';
    usedTokens?: number;
  }

  let serverContextUsage = $state<ServerContextUsage | null>(null);
  let contextWindow = $derived(
    serverContextUsage?.contextWindow ||
      selectedModel?.contextWindow ||
      selectedModel?.maxTokens ||
      FALLBACK_CONTEXT_WINDOW
  );
  let maxUploadSize = $derived(authStore.isGuest ? GUEST_MAX_UPLOAD_SIZE : USER_MAX_UPLOAD_SIZE);
  let contextBudget = $derived(serverContextUsage?.budgetTokens || contextWindow);
  function estimateContextTokens(value: string): number {
    return Math.ceil(value.length / 4);
  }

  let estimatedTokens = $derived.by(() => {
    if (typeof serverContextUsage?.usedTokens === 'number') return serverContextUsage.usedTokens;
    let total = 0;
    for (const msg of messages) {
      const content = String(msg.contextContent || msg.content || '');
      total += estimateContextTokens(`${String(msg.role ?? '')}: ${content}`) + 8;
    }
    const diagramCode = $stateStore.code || '';
    if (diagramCode) total += estimateContextTokens(diagramCode);
    if (inputText.trim()) total += estimateContextTokens(`user: ${inputText}`) + 8;
    return total;
  });
  let contextPercent = $derived(
    typeof serverContextUsage?.percent === 'number'
      ? serverContextUsage.percent
      : contextBudget > 0
        ? Math.min(100, Math.round((estimatedTokens / contextBudget) * 100))
        : 0
  );
  let contextTitle = $derived.by(() => {
    const budgetLabel = serverContextUsage?.budgetTokens ? 'usable input budget' : 'context window';
    const parts = [
      `${estimatedTokens.toLocaleString()} / ${contextBudget.toLocaleString()} ${budgetLabel} (${contextPercent}% used)`
    ];
    if (serverContextUsage?.budgetTokens && contextWindow !== contextBudget) {
      parts.push(`${contextWindow.toLocaleString()} context window`);
    }
    if (typeof serverContextUsage?.contextWindowPercent === 'number') {
      parts.push(`${serverContextUsage.contextWindowPercent}% of window`);
    }
    if (serverContextUsage?.historyBudgetTokens) {
      parts.push(`${serverContextUsage.historyBudgetTokens.toLocaleString()} chat-history budget`);
    }
    if (serverContextUsage?.compacted) parts.push('older history compacted');
    if (serverContextUsage?.type === 'context-usage-final') {
      parts.push('provider actual');
    } else if (serverContextUsage) {
      parts.push('server estimate');
    }
    if (selectedModel?.name) parts.push(selectedModel.name);
    return parts.join(' · ');
  });

  $effect(() => {
    if (!isLoading && inputText.trim()) serverContextUsage = null;
  });

  // Save chat state to localStorage (full state including artifacts) — per-file
  function saveChatState(fileId = currentFileId) {
    try {
      // Save messages (include attachments for user messages)
      const simpleMessages = messages.map((m: Record<string, unknown>, index: number) => {
        const msg: Record<string, unknown> = {
          id: m.id,
          role: m.role,
          content: visibleMessageContent(m, index)
        };
        if (m.role === 'user' && typeof m.contextContent === 'string' && m.contextContent.trim()) {
          msg.contextContent = m.contextContent;
        }
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
              url: (a.mediaType as string)?.startsWith('image/') ? a.url : null,
              workspacePath: a.workspacePath
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
      // Save message parts. Reasoning text is preserved (so refresh shows
      // that the model thought + what it thought) but its in-flight 'running'
      // state is normalized to 'done' on persist.
      const allParts: Record<number, ContentPart[]> = {};
      for (const [idx, parts] of Object.entries(messageParts)) {
        allParts[Number(idx)] = (parts as ContentPart[]).map((p: ContentPart) => {
          if (p.type === 'text') return { type: 'text', text: p.text };
          if (p.type === 'artifact') return { type: 'artifact', artifactId: p.artifactId };
          if (p.type === 'error') return { type: 'error', error: p.error };
          if (p.type === 'reasoning') {
            return { type: 'reasoning', id: p.id, text: p.text, status: 'done' };
          }
          if (p.type === 'tool-simple') {
            return { ...p, status: 'done' };
          }
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
          messageParts = savedParts;
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
      if (authStore.hasIdentity) {
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
    // We're about to drive the swap ourselves, so disarm the workspace-change
    // restore path. Otherwise it fires when workspaceStore.load() switches the
    // file id and blanks messages mid-fetch.
    skipNextFileRestore = true;
    // Save current state first
    if (conversationStarted && messages.length > 0) {
      saveChatState();
      kv.flush();
      if (authStore.hasIdentity) {
        await syncMessagesToDb();
      }
    }
    // Persist the new conversation id and session id BEFORE clearing UI state
    // so a refresh during the swap restores the right chat.
    setDbConversationId(convId);
    const newSessionId = uuidv4();
    try {
      kv.set('chat', chatKey('activeConversationId'), convId);
      kv.set('chat', chatKey('sessionId'), newSessionId);
    } catch {
      /* ignore */
    }

    // Fetch the new chat's messages BEFORE blanking the UI. Old messages stay
    // visible during the await — no empty-state flicker between chats.
    let dbMessages: DbMessageRow[] = [];
    try {
      const res = await fetch(`/api/conversations/messages?conversation_id=${convId}`, {
        credentials: 'include'
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.messages)) dbMessages = data.messages as DbMessageRow[];
      }
    } catch {
      /* ignore */
    }

    // Reset only the secondary state that isn't covered by applyDbMessages.
    // We deliberately don't touch `messages`/`messageParts` here — that would
    // briefly drop us into the "Where should we begin?" empty state between
    // the reset and the apply. Letting applyDbMessages overwrite them in one
    // assignment avoids that transient render.
    artifactMap = {};
    checkpoints = [];
    inputText = '';
    isLoading = false;
    abortController = null;
    conversationTitle = null;
    sessionId = newSessionId;

    // applyDbMessages writes: messages, messageParts, dbConversationId,
    // dbSyncedMessageCount, conversationStarted. With an empty array it
    // correctly clears those — which is the right behavior for a fresh chat.
    applyDbMessages(convId, dbMessages);
    saveChatState();
    if (dbMessages.length > 0) {
      await tick();
      scrollToBottom();
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
        headers: { 'Content-Type': 'application/json', ...providerKeyHeaders(aiSettings.value) },
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

  async function generateConversationTitle(firstMessage: string): Promise<string | null> {
    const trimmed = firstMessage.trim();
    if (!trimmed) return null;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...providerKeyHeaders(aiSettings.value) },
        body: JSON.stringify({
          currentDiagram: '',
          currentMarkdown: '',
          enabledTools: [],
          isRepair: false,
          message: `Generate a short, specific title (3-6 words, Title Case, no quotes, no trailing punctuation) for a chat that begins with this user message. Return ONLY the title.\n\nMessage: ${trimmed.slice(0, 600)}`,
          messages: [],
          model: promptEnhancerModel,
          sessionId: `title-${Date.now()}`
        })
      });
      if (!res.ok) return null;
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let title = '';
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
                title += data.content || data.delta || data.textDelta || '';
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
      const cleaned = title
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/[.!?]+$/, '')
        .slice(0, 60);
      return cleaned || null;
    } catch (e) {
      console.error('Generate title failed:', e);
      return null;
    }
  }

  function retryMessage(userText: string) {
    inputText = userText;
    tick().then(() => {
      handleSubmit({ text: userText });
    });
  }

  function isMissingProviderKeyError(message: string): boolean {
    return /API key is not set\.\s*Add your key in Settings > Models & Keys/i.test(message);
  }

  function missingProviderLabel(message: string): string {
    return message.match(/^(.+?)\s+API key is not set/i)?.[1] ?? 'Provider';
  }

  function normalizeErrorMessage(message: string): string {
    return message.replace(/\s+/g, ' ').trim();
  }

  function modelErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) return normalizeErrorMessage(error.message);
    if (typeof error === 'string' && error.trim()) return normalizeErrorMessage(error);
    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>;
      for (const key of ['errorText', 'summary', 'message', 'error']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return normalizeErrorMessage(value);
        if (value && typeof value === 'object') {
          const nested = (value as Record<string, unknown>).message;
          if (typeof nested === 'string' && nested.trim()) return normalizeErrorMessage(nested);
        }
      }
    }
    return 'The model run failed. Check the server logs for details.';
  }

  function openSettingsModal() {
    window.dispatchEvent(new CustomEvent('open-settings-modal'));
  }

  function escapeRegexLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function textMentionsSkill(userText: string, skillName: string): boolean {
    const normalizedText = userText.toLowerCase();
    const name = skillName.trim().toLowerCase();
    if (!name) return false;

    const spacedName = name.replace(/[-_]+/g, ' ');
    if (
      normalizedText.includes(name) ||
      normalizedText.includes(spacedName) ||
      normalizedText.includes(`use ${name}`) ||
      normalizedText.includes(`call ${name}`) ||
      normalizedText.includes(`apply ${name}`) ||
      normalizedText.includes(`use ${spacedName}`) ||
      normalizedText.includes(`call ${spacedName}`) ||
      normalizedText.includes(`apply ${spacedName}`)
    ) {
      return true;
    }

    const tokens = name
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4 && token !== 'expert' && token !== 'skill');

    return tokens.some((token) =>
      new RegExp(`\\b${escapeRegexLiteral(token)}\\b`, 'i').test(userText)
    );
  }

  function parsePersonalizationTemplate(value: string): {
    content: string;
    description: string;
    name: string;
  } | null {
    const match = value.trim().match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return null;
    const meta = match[1];
    const name = meta.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = meta.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (!name || !description) return null;
    return {
      content: value.trim().slice(match[0].length).trim(),
      description,
      name
    };
  }

  function activePersonalization(userText: string) {
    const availableSkills = personalizationSettings.value.skills
      .filter((skill) => skill.enabled && skill.name.trim() && skill.description.trim())
      .map((skill) => {
        const parsed = parsePersonalizationTemplate(skill.description);
        return {
          description: parsed?.content || parsed?.description || skill.description.trim(),
          name: parsed?.name || skill.name.trim()
        };
      });
    const calledSkills = personalizationSettings.value.skills.filter((skill) => {
      if (!skill.enabled || !skill.name.trim() || !skill.description.trim()) return false;
      const parsed = parsePersonalizationTemplate(skill.description);
      return textMentionsSkill(userText, parsed?.name || skill.name);
    });

    return {
      personas: personalizationSettings.value.personas
        .filter((persona) => persona.enabled && persona.name.trim() && persona.body.trim())
        .map((persona) => {
          const parsed = parsePersonalizationTemplate(persona.body);
          return {
            body: parsed?.content || persona.body.trim(),
            name: parsed?.name || persona.name.trim()
          };
        }),
      rules: personalizationSettings.value.rules
        .filter((rule) => rule.enabled && rule.name.trim() && rule.body.trim())
        .map((rule) => {
          const parsed = parsePersonalizationTemplate(rule.body);
          return {
            body: parsed?.content || rule.body.trim(),
            name: parsed?.name || rule.name.trim()
          };
        }),
      availableSkills,
      skills: calledSkills.map((skill) => ({
        description:
          parsePersonalizationTemplate(skill.description)?.content ||
          parsePersonalizationTemplate(skill.description)?.description ||
          skill.description.trim(),
        name: parsePersonalizationTemplate(skill.description)?.name || skill.name.trim()
      }))
    };
  }

  // Throttled scroll using rAF to avoid excessive calls during streaming
  let scrollRafId: number | null = null;
  let showScrollButton = $state(false);

  function scrollToBottom() {
    if (!uiSettings.value.autoScroll) return;
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

  // Pin the inner scroll container to the bottom while content streams in.
  // Re-runs on every text update; stops once streaming flips to false so the
  // user can scroll back to read earlier reasoning without being yanked down.
  function autoScroll(node: HTMLElement, params: { isStreaming: boolean; text: string }) {
    function pinToBottom() {
      if (params.isStreaming) {
        node.scrollTop = node.scrollHeight;
      }
    }
    pinToBottom();
    return {
      update(next: { isStreaming: boolean; text: string }) {
        params = next;
        pinToBottom();
      }
    };
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
    }, 400);
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
    // Send a clean Q/A pair list. The model has the context from its own
    // earlier askQuestions tool call, so we don't need to echo it back.
    const lines: string[] = [];
    for (const q of questions) {
      const answer = responses[q.id];
      const answerText = Array.isArray(answer) ? answer.join(', ') : answer || '(no answer)';
      lines.push(`Q: ${q.text}\nA: ${answerText}`);
    }
    const responseText = lines.join('\n\n');
    handleSubmit({ text: responseText });
  }

  function questionnaireIsComplete(
    questions: QuestionnaireQuestion[],
    responses: Record<string, string | string[]>
  ): boolean {
    return questions.every((question) => {
      const answer = responses[question.id];
      return Array.isArray(answer) ? answer.length > 0 : Boolean(answer);
    });
  }

  function questionnaireAnsweredCount(
    questions: QuestionnaireQuestion[],
    responses: Record<string, string | string[]>
  ): number {
    return questions.filter((question) => {
      const answer = responses[question.id];
      return Array.isArray(answer) ? answer.length > 0 : Boolean(answer);
    }).length;
  }

  function toolCallArgs(data: Record<string, unknown>): Record<string, unknown> {
    const raw = data.args ?? data.input ?? data.toolInput ?? data.inputText;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }

  function toolInputSseChunk(data: Record<string, unknown>): string {
    for (const key of ['inputTextDelta', 'delta', 'textDelta', 'argsTextDelta']) {
      const value = data[key];
      if (typeof value === 'string') return value;
    }

    const input = data.input ?? data.args ?? data.toolInput;
    if (typeof input === 'string') return input;
    if (input && typeof input === 'object') return JSON.stringify(input);

    return '';
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
    shouldInlineContent?: boolean;
    tokenEstimate?: number;
    workspaceFile?: {
      content: string;
      created_at: string;
      id: string;
      kind: string;
      path: string;
      updated_at: string;
    };
    workspaceFileId?: string;
    workspacePath?: string;
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
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      if (!res.ok) {
        const responseText = await res.text().catch(() => '');
        let message = responseText;
        try {
          const body = JSON.parse(responseText) as { error?: unknown };
          if (body?.error) message = String(body.error);
        } catch {
          /* keep plain response text */
        }
        console.error('Upload failed:', res.status, message);
        if (message) {
          fileError = message;
        }
        return null;
      }
      const result = await res.json();
      if (result?.workspaceFile) await filesStore.refreshAll();
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

    // Soft auth check — both guests and logged-in users can chat. Only fully
    // anonymous (no auth user object at all) callers are prompted to sign in.
    if (!authStore.hasIdentity) {
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
          'One or more attachments could not be processed. Use Markdown, text, or PDF.';
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
          fileId: uploaded?.workspaceFileId || uploaded?.fileId || null,
          filename: f.filename || 'file',
          mediaType: f.mediaType || '',
          pageCount: uploaded?.pageCount || null,
          size: uploaded?.size || 0,
          type: uploaded?.type || 'unknown',
          url: null,
          workspacePath: uploaded?.workspacePath || null
        };
      });
    }

    // Build the message content with attachment context before it is persisted.
    let fullMessage = contextPrefix + (text || '');
    for (const fc of fileContents) {
      if (fc.workspacePath) {
        const workspaceFile = fc.workspaceFile as { content?: unknown } | undefined;
        const inlineContent =
          fc.shouldInlineContent === true && typeof workspaceFile?.content === 'string'
            ? workspaceFile.content
            : '';
        if (inlineContent) {
          fullMessage += `\n\n--- Uploaded file content ---\nOriginal filename: ${fc.filename}\nWorkspace path: ${fc.workspacePath}\nWorkspace file id: ${fc.workspaceFileId || fc.fileId || 'unknown'}\nEstimated tokens after conversion: ${fc.tokenEstimate || 'unknown'}\nContent:\n${inlineContent}\n--- End uploaded file content ---`;
        } else {
          fullMessage += `\n\n--- Uploaded file saved to workspace ---\nOriginal filename: ${fc.filename}\nWorkspace path: ${fc.workspacePath}\nWorkspace file id: ${fc.workspaceFileId || fc.fileId || 'unknown'}\nEstimated tokens after conversion: ${fc.tokenEstimate || 'over 50000'}\nThis converted file is too large to inline in the chat prompt. Use fileSystem with operation "read" on this path when you need the contents. For large files, prefer startLine/endLine ranges.\n--- End uploaded file metadata ---`;
        }
      }
    }
    userMessage.contextContent = fullMessage;

    messages = [...messages, userMessage];
    inputText = '';
    serverContextUsage = null;
    isLoading = true;

    // Auto-create conversation on first message
    if (!conversationStarted) {
      conversationStarted = true;
      const attachmentTitle =
        fileContents.length > 0
          ? `Attachment: ${fileContents.map((file) => file.filename).join(', ')}`
          : 'New chat';
      const provisionalTitle = text
        ? text.length > 50
          ? `${text.slice(0, 50)}…`
          : text
        : attachmentTitle;
      conversationTitle = provisionalTitle;
      window.dispatchEvent(
        new CustomEvent('conversation-created', {
          detail: { sessionId, title: conversationTitle }
        })
      );
      // First-message naming: ensure the DB row reflects the user's text
      // immediately, then ask the model to generate a tighter title in the
      // background. The model rename only runs when the row currently has a
      // placeholder title ("New chat", "Untitled", or empty).
      void (async () => {
        const convId = await ensureDbConversation();
        if (!convId) return;
        const { conversationsStore } = await import('$lib/client/stores/conversations.svelte');
        const currentRow = conversationsStore.list.find((c) => c.id === convId);
        const placeholder = ['', 'New chat', 'New Chat', 'Untitled'];
        const needsAiTitle = !currentRow?.title || placeholder.includes(currentRow.title.trim());
        await conversationsStore.rename(convId, provisionalTitle);
        if (needsAiTitle && text.trim()) {
          const aiTitle = await generateConversationTitle(text);
          if (aiTitle) {
            conversationTitle = aiTitle;
            void conversationsStore.rename(convId, aiTitle);
          }
        }
      })();
    }
    currentToolCallId = null;
    currentToolName = '';
    currentToolInputJson = '';
    currentReasoningId = null;
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
    const personalization = activePersonalization(fullMessage);
    const personalizationCount = personalization.rules.length;
    messageParts[assistantIndex] = [
      ...(personalizationCount > 0
        ? [
            {
              details: personalization.rules.map((rule) => rule.name),
              id: `tool-simple-personalization-${assistantMessage.id}`,
              status: 'done' as const,
              subtitle: `${personalization.rules.length} rule${personalization.rules.length === 1 ? '' : 's'}`,
              titleDone: 'Rules active',
              titlePending: 'Applying rules',
              toolName: 'personalization',
              type: 'tool-simple' as const
            }
          ]
        : []),
      { type: 'thinking', id: `thinking-${assistantMessage.id}` }
    ];

    abortController = new AbortController();

    const sendRequest = () => {
      const activeDbConversationId = dbConversationId;
      const activeTab = getActiveWorkspaceTab();
      const activeEngine = getActiveWorkspaceEngine();
      return fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...providerKeyHeaders(aiSettings.value) },
        body: JSON.stringify({
          activeFileId: filesStore.activeId,
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
            .reduce(
              (
                history: { content: string; role: unknown }[],
                m: Record<string, unknown>,
                index: number
              ) => {
                const content = modelContextContent(m, index);
                if (m.role === 'user' || (m.role === 'assistant' && content.trim())) {
                  history.push({ role: m.role, content });
                }
                return history;
              },
              []
            ),
          model: selectedModel.id,
          personalization,
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .then((convId) => {
        if (guestLimitNotice) {
          // Guest hit the 15-conversation cap before the request even fired.
          // Roll back the optimistic user/assistant pair we just appended so
          // the user only sees the banner, not a stranded turn.
          isLoading = false;
          messages = messages.slice(0, -2);
          return null;
        }
        return sendRequest();
      })
      .then(async (res) => {
        if (!res) return;
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

                  if (data.type === 'context-usage' || data.type === 'context-usage-final') {
                    serverContextUsage = data as ServerContextUsage;
                    continue;
                  }

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
                        text: appendReasoningText(currentText, delta)
                      };
                    } else {
                      parts.push({
                        id: reasoningId,
                        status: 'running',
                        text: appendReasoningText('', delta),
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

                    if (currentToolName === 'askQuestions') {
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
                    } else if (currentToolName === 'thinking') {
                      const cotId = `chain-of-thought-${currentToolCallId}`;
                      const parts = messageParts[assistantIndex] || [];
                      if (!parts.some((p) => p.type === 'chain-of-thought' && p.id === cotId)) {
                        parts.push({
                          id: cotId,
                          status: 'running',
                          thoughts: [],
                          type: 'chain-of-thought'
                        });
                        messageParts[assistantIndex] = [...parts];
                        scrollToBottom();
                      }
                    } else if (currentToolName !== 'fileSystem') {
                      const simpleId = `tool-simple-${currentToolCallId}`;
                      const parts = messageParts[assistantIndex] || [];
                      if (!parts.some((p) => p.type === 'tool-simple' && p.id === simpleId)) {
                        const verbs = toolVerbs(currentToolName);
                        parts.push({
                          id: simpleId,
                          status: 'running',
                          titleDone: verbs.done,
                          titlePending: verbs.pending,
                          toolName: currentToolName,
                          type: 'tool-simple'
                        });
                        messageParts[assistantIndex] = [...parts];
                        scrollToBottom();
                      }
                    }
                  } else if (
                    data.type === 'tool-input-delta' ||
                    data.type === 'tool-input-available'
                  ) {
                    if (typeof data.toolName === 'string' && data.toolName) {
                      currentToolName = data.toolName;
                    }
                    if (typeof data.toolCallId === 'string' && data.toolCallId) {
                      currentToolCallId = data.toolCallId;
                    }
                    const inputChunk = toolInputSseChunk(data as Record<string, unknown>);
                    if (data.type === 'tool-input-available') {
                      currentToolInputJson = inputChunk || currentToolInputJson;
                    } else {
                      currentToolInputJson += inputChunk;
                    }

                    if (currentToolName === 'askQuestions') {
                      const qId = `q-${currentToolCallId || Date.now()}`;
                      const parts = messageParts[assistantIndex] || [];
                      const qIdx = parts.findIndex(
                        (p: ContentPart) => p.type === 'questionnaire' && p.id === qId
                      );
                      if (qIdx >= 0) {
                        const partial = parsePartialQuestionnaire(currentToolInputJson);
                        parts[qIdx] = {
                          ...parts[qIdx],
                          context: partial.context,
                          questions: partial.questions,
                          isStreaming: true
                        } as ContentPart;
                        messageParts[assistantIndex] = [...parts];
                        scrollToBottom();
                      }
                    } else if (currentToolName === 'fileSystem') {
                      const partial = parsePartialToolInput(currentToolInputJson);
                      const op = typeof partial?.operation === 'string' ? partial.operation : '';
                      const path = typeof partial?.path === 'string' ? partial.path : '';
                      const language = languageForWorkspacePath(path);
                      const isWrite = op === 'edit' || op === 'create';

                      if (isWrite && path) {
                        const artifactId = getArtifactIdForToolCall(
                          `fileSystem-${op}`,
                          currentToolCallId
                        );
                        const parts = messageParts[assistantIndex] || [];
                        const simpleId = `tool-simple-${currentToolCallId}`;
                        const sIdx = parts.findIndex(
                          (p) => p.type === 'tool-simple' && p.id === simpleId
                        );
                        let dirty = false;
                        if (sIdx >= 0) {
                          parts.splice(sIdx, 1);
                          dirty = true;
                        }
                        if (
                          !parts.some((p) => p.type === 'artifact' && p.artifactId === artifactId)
                        ) {
                          parts.push({ type: 'artifact', artifactId });
                          dirty = true;
                        }
                        if (dirty) messageParts[assistantIndex] = [...parts];

                        if (!artifactMap[artifactId]) {
                          const prevCode = $stateStore.code || '';
                          artifactMap[artifactId] = {
                            code: '',
                            errors: undefined,
                            hasErrors: false,
                            id: artifactId,
                            isStreaming: true,
                            language,
                            operation: artifactOperationForFileSystem(op),
                            previousCode: prevCode,
                            title: artifactTitleForWorkspaceWrite(op, path)
                          };
                          artifactMap = { ...artifactMap };
                        }

                        const rawCode = parseStreamingContent(currentToolInputJson);
                        if (rawCode !== null && artifactMap[artifactId]) {
                          const isLineEdit = currentToolInputJson.includes('"startLine"');
                          const streamedCode =
                            isLineEdit && artifactMap[artifactId]?.previousCode
                              ? (buildLineEditPreview(
                                  currentToolInputJson,
                                  rawCode,
                                  artifactMap[artifactId].previousCode
                                ) ?? rawCode)
                              : rawCode;
                          artifactMap[artifactId] = {
                            ...artifactMap[artifactId],
                            code: streamedCode
                          };
                          artifactMap = { ...artifactMap };
                          if (language === 'mermaid') {
                            if (streamCanvasTimer) clearTimeout(streamCanvasTimer);
                            streamCanvasTimer = setTimeout(() => {
                              if (isLineEdit) {
                                diagramPreviewApplied =
                                  previewDiagramToolInput(
                                    'line-edit',
                                    currentToolInputJson,
                                    rawCode,
                                    artifactId
                                  ) || diagramPreviewApplied;
                              } else if (mermaidDeclarationPattern.test(rawCode.trim())) {
                                updateCodeStore({
                                  code: rawCode,
                                  updateDiagram: getActiveWorkspaceEngine() === 'mermaid',
                                  pan: undefined,
                                  zoom: undefined
                                });
                                diagramPreviewApplied = true;
                              }
                            }, 120);
                          }
                          if (language === 'markdown' && streamedCode.trim()) {
                            documentMarkdownStore.set(streamedCode);
                          }
                          scrollToBottom();
                        }
                      } else {
                        // Non-write op or non-renderable path — fall through
                        // to the generic tool-simple subtitle/title update.
                        const display = deriveToolInputDisplay(
                          currentToolName,
                          currentToolInputJson
                        );
                        const toolInput = partial;
                        const operationVerbs = toolInput?.operation
                          ? toolVerbs(currentToolName, { operation: toolInput.operation })
                          : null;
                        ensureToolSimple(
                          assistantIndex,
                          currentToolCallId,
                          currentToolName,
                          operationVerbs ?? undefined
                        );
                        const pathSubtitle =
                          typeof toolInput?.path === 'string' && toolInput.path
                            ? toolInput.path
                            : undefined;
                        updateToolSimple(assistantIndex, currentToolCallId, {
                          ...display,
                          ...(pathSubtitle !== undefined && display.subtitle === undefined
                            ? { subtitle: pathSubtitle }
                            : {}),
                          ...(toolInput ? { toolInput } : {}),
                          ...(operationVerbs
                            ? {
                                titlePending: operationVerbs.pending,
                                titleDone: operationVerbs.done
                              }
                            : {})
                        });
                      }
                    } else if (currentToolName === 'thinking') {
                      // Stream the Chain of Thought as input deltas arrive so
                      // each thought appears live, not only after the call
                      // completes. We tolerate partial / unterminated JSON.
                      const partial = parsePartialThoughts(currentToolInputJson);
                      if (partial.thoughts.length > 0 || partial.conclusion) {
                        const cotId = `chain-of-thought-${currentToolCallId || Date.now()}`;
                        const parts = messageParts[assistantIndex] || [];
                        const idx = parts.findIndex(
                          (p) => p.type === 'chain-of-thought' && p.id === cotId
                        );
                        if (idx >= 0 && parts[idx].type === 'chain-of-thought') {
                          parts[idx] = {
                            ...parts[idx],
                            thoughts: partial.thoughts,
                            conclusion: partial.conclusion
                          } as ContentPart;
                          messageParts[assistantIndex] = [...parts];
                          scrollToBottom();
                        }
                      }
                    } else {
                      // Live subtitle/details for tool-simple. For fileSystem
                      // calls also refresh titlePending/titleDone once we can
                      // parse the operation out of the partial input — that
                      // way the chip shows "Editing foo.mermaid" instead of
                      // the generic "Editing file".
                      const display = deriveToolInputDisplay(currentToolName, currentToolInputJson);
                      const toolInput = parsePartialToolInput(currentToolInputJson);
                      const operationVerbs =
                        currentToolName === 'fileSystem' && toolInput?.operation
                          ? toolVerbs(currentToolName, { operation: toolInput.operation })
                          : null;
                      const pathSubtitle =
                        currentToolName === 'fileSystem' &&
                        typeof toolInput?.path === 'string' &&
                        toolInput.path
                          ? toolInput.path
                          : undefined;
                      const subtitle = display.subtitle ?? pathSubtitle;
                      if (
                        subtitle !== undefined ||
                        display.details !== undefined ||
                        toolInput ||
                        operationVerbs
                      ) {
                        updateToolSimple(assistantIndex, currentToolCallId, {
                          ...display,
                          ...(subtitle !== undefined ? { subtitle } : {}),
                          ...(toolInput ? { toolInput } : {}),
                          ...(operationVerbs
                            ? {
                                titlePending: operationVerbs.pending,
                                titleDone: operationVerbs.done
                              }
                            : {})
                        });
                      }
                    }
                  } else if (data.type === 'tool-output-available') {
                    const output = data.output;
                    const toolName = data.toolName || currentToolName;

                    // fileSystem tool: when create/edit succeeds, switch the
                    // workspace to the touched file so Canvas/Code/Document panels
                    // immediately reflect the new content. Also refresh the files
                    // list so the sidebar shows the new file. Final output
                    // stays on the same Code Artifact surface used for streaming.
                    // Any successful fileSystem call mutates the workspace tree
                    // (delete / moveFolder / deleteFolder change paths but
                    // don't carry a file in the result, so the rich
                    // create/edit handler below skips them). Always
                    // refetch the list so the sidebar tree reflects reality.
                    if (toolName === 'fileSystem' && output && output.success === true) {
                      const fileSystemMode = normalizeFileSystemOperation(output.mode);
                      if (fileSystemMode !== 'create' && fileSystemMode !== 'edit') {
                        void filesStore.refreshAll();
                      }
                      // If the deleted file was the active one, drop the
                      // selection so the workspace falls back to chat-only.
                      if (
                        output.deleted !== undefined &&
                        typeof output.path === 'string' &&
                        filesStore.activeFile?.path === output.path
                      ) {
                        filesStore.setActive(null);
                      }
                    }

                    if (
                      toolName === 'fileSystem' &&
                      output &&
                      output.success === true &&
                      output.file &&
                      typeof output.file.content === 'string' &&
                      typeof output.file.path === 'string' &&
                      typeof output.file.kind === 'string' &&
                      (output.mode === 'create' ||
                        output.mode === 'edit' ||
                        output.mode === 'update' ||
                        output.mode === 'patch')
                    ) {
                      const touched = output.file as {
                        id: string;
                        path: string;
                        kind: 'md' | 'json' | 'yaml' | 'mermaid';
                        content: string;
                      };
                      const op =
                        normalizeFileSystemOperation(output.mode) === 'create' ? 'create' : 'edit';

                      // Refresh the sidebar list so a newly-created file shows up,
                      // and edited files reflect their new updated_at.
                      filesStore.refreshAll().then(() => {
                        filesStore.setActive(touched.id);
                      });
                      // Push content into the shared code store so the Code panel
                      // and Canvas pipeline render the new source. Skip the
                      // diagram-update path for .md files (Canvas is hidden anyway).
                      // Reset pan/zoom so the canvas fits the new diagram —
                      // otherwise a large generated diagram inherits the
                      // previous zoom and overflows the viewport.
                      const isLineEdit =
                        output.startLine !== undefined || output.replacedLineCount !== undefined;
                      const shouldFit = !isLineEdit;
                      updateCodeStore({
                        code: touched.content,
                        updateDiagram: touched.kind !== 'md',
                        ...(shouldFit ? { pan: undefined, zoom: undefined } : {})
                      });
                      workspaceStore.markDirty();
                      const { panels } = await import('$lib/client/stores/panels.svelte');
                      // Two-window rule: chat stays as-is, viewer is a
                      // single-select group. Default to the rendered preview
                      // (Document for .md, Canvas otherwise). The user can
                      // flip to Code via the sidebar's viewer switcher.
                      if (touched.kind === 'md') {
                        documentMarkdownStore.set(touched.content);
                        panels.showViewer('document');
                      } else {
                        panels.showViewer('canvas');
                      }
                      diagramMutationSucceeded = true;

                      const aid = getArtifactIdForToolCall(`fileSystem-${op}`, data.toolCallId);
                      const language = languageForWorkspacePath(touched.path);
                      artifactMap[aid] = {
                        ...(artifactMap[aid] ?? {
                          id: aid,
                          previousCode: $stateStore.code || '',
                          language
                        }),
                        code: touched.content,
                        isStreaming: false,
                        language,
                        operation: op,
                        title: artifactTitleForWorkspaceWrite(op, touched.path)
                      };
                      artifactMap = { ...artifactMap };
                      const parts = messageParts[assistantIndex] || [];
                      if (!parts.some((p) => p.type === 'artifact' && p.artifactId === aid)) {
                        const simpleId = `tool-simple-${data.toolCallId || currentToolCallId}`;
                        const sIdx = parts.findIndex(
                          (p) => p.type === 'tool-simple' && p.id === simpleId
                        );
                        if (sIdx >= 0) parts.splice(sIdx, 1);
                        parts.push({ type: 'artifact', artifactId: aid });
                        messageParts[assistantIndex] = [...parts];
                      }

                      if (touched.kind === 'mermaid' && touched.content.trim().length > 0) {
                        try {
                          await mermaidParse(touched.content);
                        } catch (parseErr: unknown) {
                          const errMsg =
                            (parseErr instanceof Error ? parseErr.message : String(parseErr)) ||
                            'Invalid Mermaid syntax';
                          artifactMap[aid] = {
                            ...artifactMap[aid],
                            hasErrors: true,
                            errors: [errMsg],
                            title: 'Errors Found'
                          };
                          artifactMap = { ...artifactMap };
                          if (autoFixTimeout) clearTimeout(autoFixTimeout);
                          autoFixTimeout = setTimeout(() => {
                            autoFixTimeout = null;
                            if (!isLoading) {
                              handleSubmit({
                                text: `The diagram you just wrote has a syntax error: "${errMsg}". Please fix it.`
                              });
                            }
                          }, 1000);
                        }
                      }
                    }

                    // Unified tool-simple completion for all generic tools
                    if (
                      output &&
                      toolName !== 'askQuestions' &&
                      !(
                        toolName === 'fileSystem' &&
                        output.success === true &&
                        output.file &&
                        (output.mode === 'create' ||
                          output.mode === 'edit' ||
                          output.mode === 'update' ||
                          output.mode === 'patch')
                      )
                    ) {
                      // For errorChecker: run real mermaid.parse() on client
                      let checkerErrors: { line: number; message: string }[] = output.errors || [];
                      const checkerWarnings: { line?: number; message?: string }[] =
                        output.warnings || [];
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
                        if (checkerValid && canvasStatus.renderError) {
                          checkerValid = false;
                          checkerErrors = [
                            { line: 0, message: `Render error: ${canvasStatus.renderError}` }
                          ];
                        }
                      }

                      // Compute subtitle and details (errorChecker special-cased to use client mermaidParse result)
                      const completedToolInput =
                        toolName === 'fileSystem'
                          ? parsePartialToolInput(currentToolInputJson)
                          : undefined;
                      const completedInputDisplay =
                        toolName === 'fileSystem'
                          ? deriveToolInputDisplay(toolName, currentToolInputJson)
                          : undefined;
                      const operationVerbs =
                        toolName === 'fileSystem' && completedToolInput?.operation
                          ? toolVerbs(toolName, { operation: completedToolInput.operation })
                          : null;
                      const subtitle =
                        toolName === 'errorChecker'
                          ? deriveErrorCheckerSubtitle({
                              valid: checkerValid,
                              errors: checkerErrors,
                              warnings: checkerWarnings.map((warning) => ({
                                line: warning.line ?? 0,
                                message: String(warning.message ?? 'Contrast warning')
                              }))
                            })
                          : completedInputDisplay?.subtitle || deriveToolSubtitle(toolName, output);
                      const toolDetails =
                        toolName === 'errorChecker'
                          ? [
                              ...(checkerValid
                                ? ['All syntax checks passed']
                                : checkerErrors.map((e) =>
                                    e.line > 0 ? `Line ${e.line}: ${e.message}` : e.message
                                  )),
                              ...checkerWarnings.map((warning) =>
                                warning.line && warning.line > 0
                                  ? `Warning line ${warning.line}: ${warning.message}`
                                  : `Warning: ${warning.message}`
                              )
                            ]
                          : uniqueToolDetails([
                              ...(completedInputDisplay?.details ?? []),
                              ...deriveToolDetails(toolName, output)
                            ]);
                      const searchResults = deriveSearchResults(toolName, output);
                      const toolDoneTitle =
                        toolName === 'errorChecker' && !checkerValid
                          ? 'Errors Found'
                          : toolName === 'errorChecker' && checkerWarnings.length > 0
                            ? 'Warnings Found'
                            : operationVerbs?.done
                              ? operationVerbs.done
                              : undefined;

                      const parts = messageParts[assistantIndex] || [];
                      if (toolName === 'thinking') {
                        // Finalize / upsert the Chain of Thought part — never
                        // produce a tool-simple chip for thinking.
                        const cotId = `chain-of-thought-${data.toolCallId || currentToolCallId}`;
                        const idx = parts.findIndex(
                          (p) => p.type === 'chain-of-thought' && p.id === cotId
                        );
                        const thoughts = Array.isArray(output?.thoughts)
                          ? (output.thoughts as { label: string; detail?: string }[])
                          : [];
                        const conclusion =
                          typeof output?.conclusion === 'string'
                            ? (output.conclusion as string)
                            : undefined;
                        if (idx >= 0 && parts[idx].type === 'chain-of-thought') {
                          parts[idx] = {
                            ...parts[idx],
                            status: 'done',
                            thoughts,
                            conclusion
                          } as ContentPart;
                        } else {
                          parts.push({
                            conclusion,
                            id: cotId,
                            status: 'done',
                            thoughts,
                            type: 'chain-of-thought'
                          });
                        }
                      } else {
                        // Upsert tool-simple part for everything else
                        const simpleId = `tool-simple-${data.toolCallId || currentToolCallId}`;
                        const idx = parts.findIndex(
                          (p) => p.type === 'tool-simple' && p.id === simpleId
                        );
                        if (idx >= 0 && parts[idx].type === 'tool-simple') {
                          parts[idx] = {
                            ...parts[idx],
                            details: toolDetails.length > 0 ? toolDetails : undefined,
                            searchResults: searchResults.length > 0 ? searchResults : undefined,
                            status: 'done',
                            subtitle: subtitle || (parts[idx] as { subtitle?: string }).subtitle,
                            ...(toolDoneTitle ? { titleDone: toolDoneTitle } : {})
                          };
                        } else {
                          const verbs = operationVerbs ?? toolVerbs(toolName);
                          parts.push({
                            details: toolDetails.length > 0 ? toolDetails : undefined,
                            id: simpleId,
                            searchResults: searchResults.length > 0 ? searchResults : undefined,
                            status: 'done',
                            subtitle,
                            titleDone: toolDoneTitle ?? verbs.done,
                            titlePending: verbs.pending,
                            toolName,
                            type: 'tool-simple'
                          });
                        }
                      }
                      messageParts[assistantIndex] = [...parts];

                      // Side effects: apply autoStyler output to the active diagram.
                      // (Icon application is no longer auto-applied — iconSearch
                      // returns candidates only and the model applies them with
                      // a fileSystem edit so the canvas updates through the normal flow.)
                      if (
                        toolName === 'autoStyler' &&
                        output.content &&
                        typeof output.content === 'string'
                      ) {
                        applyToolSourceToActiveTab(output.content, output);
                        // autoStyler writes through to the active workspace
                        // file via persistActiveFileContent on the server.
                        // Refresh the tree so updated_at / sort order reflect.
                        void filesStore.refreshAll();
                      }
                      scrollToBottom();
                    }

                    currentToolCallId = null;
                    currentToolName = '';
                    currentToolInputJson = '';
                  } else if (data.type === 'tool-call' && data.toolName === 'askQuestions') {
                    messageParts[assistantIndex] = removeThinkingPart(
                      messageParts[assistantIndex] || []
                    );
                    // askQuestions has no execute — finalize the streaming questionnaire
                    try {
                      const args = toolCallArgs(data as Record<string, unknown>);
                      const qId = `q-${data.toolCallId || currentToolCallId || Date.now()}`;
                      const parts = messageParts[assistantIndex] || [];
                      const existingIdx = parts.findIndex(
                        (p: ContentPart) => p.type === 'questionnaire' && p.id === qId
                      );
                      const finalPart: ContentPart = {
                        context: args.context || '',
                        id: qId,
                        isStreaming: false,
                        questions: normalizeQuestionnaireQuestions(args.questions),
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
                        const part = doneParts[pi] as Extract<
                          ContentPart,
                          { type: 'questionnaire' }
                        >;
                        const partial =
                          part.questions.length === 0
                            ? parsePartialQuestionnaire(currentToolInputJson)
                            : null;
                        doneParts[pi] = {
                          ...part,
                          context: part.context || partial?.context || '',
                          isStreaming: false,
                          questions:
                            part.questions.length > 0
                              ? part.questions
                              : normalizeQuestionnaireQuestions(partial?.questions ?? [])
                        } as ContentPart;
                        partsChanged = true;
                      }
                    }
                    if (partsChanged) messageParts[assistantIndex] = [...doneParts];
                    isLoading = false;
                    scrollToBottom();
                    continue;
                  } else if (
                    data.type === 'error' ||
                    data.type === 'tool-error' ||
                    typeof data.errorText === 'string' ||
                    typeof data.error === 'string'
                  ) {
                    restoreUncommittedDiagramPreview();
                    // Extract the error message from any of the shapes the
                    // Vercel AI SDK and older custom streams have used:
                    //   v5+   → `{ type: 'error', errorText: string }`
                    //   older → `{ type: 'error', error: string }`
                    //   ...   → `{ type: 'error', error: { message } }`
                    // Log the raw payload when none of those produce text so
                    // we can see what the SDK actually sent us next time.
                    let errText = modelErrorMessage(data);
                    errText = normalizeErrorMessage(errText);
                    if (!errText) {
                      console.warn('[chat] error event with no message; raw payload:', data);
                      errText =
                        'The server sent an empty error. Check the dev console / server logs for details.';
                    }
                    const parts = finalizeReasoningParts(
                      removeThinkingPart(messageParts[assistantIndex] || [])
                    );
                    parts.push({ type: 'error', error: errText, userMessage: text });
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
        parts.push({ type: 'error', error: modelErrorMessage(err), userMessage: text });
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

<div class="flex h-full flex-col" style="background-color: var(--chat-background);">
  {#if guestLimitNotice}
    <div
      role="alert"
      class="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-100">
      <span class="flex-1">
        {guestLimitNotice.message}
      </span>
      <button
        type="button"
        class="rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-[12px] font-medium text-amber-50 hover:bg-amber-500/30"
        onclick={() => window.dispatchEvent(new CustomEvent('open-auth-modal'))}>
        Sign in
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        class="rounded-md p-1 text-amber-200/70 hover:text-amber-100"
        onclick={() => (guestLimitNotice = null)}>
        <X class="size-3.5" />
      </button>
    </div>
  {/if}

  <!-- Messages Area -->
  <div
    bind:this={messagesContainer}
    onscroll={handleMessagesScroll}
    class="scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent relative flex-1 overflow-y-auto scroll-smooth">
    {#if !isDataReady}
      <div
        class="flex h-full items-center justify-center px-6 py-8 text-[13px] text-muted-foreground"
        aria-live="polite">
        Restoring session…
      </div>
    {:else if !hasMessages}
      <div
        class="mx-auto flex h-full w-full max-w-3xl flex-col justify-center gap-6 px-4 py-10 sm:px-6">
        <div class="space-y-2 text-center">
          <h2 class="text-[30px] leading-tight font-medium tracking-normal text-foreground">
            Where should we begin?
          </h2>
          <p class="text-[13px] leading-relaxed text-muted-foreground">
            Choose a starting point or describe the diagram below.
          </p>
        </div>
        <div class="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          {#each suggestions as suggestion (suggestion.label)}
            <button
              type="button"
              onclick={() => {
                handleSubmit({ text: suggestion.prompt });
              }}
              class="group flex min-h-16 min-w-0 items-start gap-3 rounded-lg border border-border bg-background px-3 py-3 text-left transition-colors duration-150 hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none"
              aria-label={suggestion.label}>
              <suggestion.icon
                class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              <span class="min-w-0">
                <span class="block truncate text-[13px] font-medium text-foreground">
                  {suggestion.label}
                </span>
                <span class="mt-1 block text-[12px] leading-snug text-muted-foreground">
                  {suggestion.hint}
                </span>
              </span>
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
              class="group/msg cv-auto flex items-center justify-end gap-3"
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
              <div class="flex max-w-[92%] flex-col items-end gap-2">
                {#if message.attachments?.length > 0}
                  <div class="flex flex-wrap justify-end gap-2">
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
                          class="flex h-8 max-w-[220px] min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2 text-[13px] text-muted-foreground"
                          title={att.workspacePath || att.filename}>
                          <FileText class="size-3.5 shrink-0" />
                          <span class="min-w-0 truncate text-foreground/80"
                            >{att.filename || 'File'}</span>
                          <span
                            class="shrink-0 rounded bg-muted px-1 py-px text-[13px] font-medium text-muted-foreground"
                            >{(att.ext || '?').toUpperCase()}</span>
                        </div>
                      {/if}
                    {/each}
                  </div>
                {/if}
                {#if message.content}
                  {@const isQA =
                    typeof message.content === 'string' && /^Q:\s/.test(message.content)}
                  {#if isQA}
                    {@const qaPairs = (message.content as string)
                      .split(/\n\n+/)
                      .map((block) => {
                        const m = block.match(/^Q:\s*(.+?)\nA:\s*([\s\S]+)$/);
                        return m ? { q: m[1], a: m[2] } : null;
                      })
                      .filter(Boolean) as { q: string; a: string }[]}
                    <div
                      class="inline-block max-w-[420px] rounded-lg rounded-tr-sm bg-muted px-3 py-2 text-left text-[13px] leading-relaxed">
                      <div class="space-y-2">
                        {#each qaPairs as pair (pair.q)}
                          <div class="flex items-start gap-1">
                            <span
                              class="mt-[8px] size-1 shrink-0 rounded-full bg-muted-foreground/50"
                            ></span>
                            <span class="min-w-0">
                              <span class="text-muted-foreground/80">{pair.q}</span>
                              <span class="text-muted-foreground/40"> · </span>
                              <span class="font-medium text-foreground">{pair.a}</span>
                            </span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {:else}
                    {@const msgText = String(message.content ?? '')}
                    {@const isLongMsg = msgText.length > USER_MSG_COLLAPSE_THRESHOLD}
                    {@const isExpanded = !!expandedUserMessages[i]}
                    <div
                      class="relative inline-block max-w-full overflow-hidden rounded-lg rounded-tr-sm bg-muted text-[13px] leading-relaxed text-foreground">
                      <div
                        class="overflow-y-auto px-3 py-2 break-words whitespace-pre-wrap"
                        style={isLongMsg && !isExpanded
                          ? 'max-height: 144px;'
                          : isLongMsg
                            ? 'max-height: min(60vh, 480px);'
                            : ''}>
                        {msgText}
                      </div>
                      {#if isLongMsg}
                        <button
                          type="button"
                          onclick={() => toggleUserMessageExpanded(i)}
                          class="flex w-full items-center justify-center gap-1 border-t border-border/40 bg-muted py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                          aria-expanded={isExpanded}>
                          {#if isExpanded}
                            <ChevronUp class="size-3" />
                            Show less
                          {:else}
                            <ChevronDown class="size-3" />
                            Show full message
                          {/if}
                        </button>
                      {/if}
                    </div>
                  {/if}
                {/if}
              </div>
            </div>
          {:else if message.role === 'assistant'}
            <!-- Assistant Response (left-aligned) -->
            <div class="cv-auto min-w-0">
              <div class="max-w-[95%] min-w-0 space-y-1.5">
                {#if messageParts[i] && messageParts[i].length > 0}
                  {#each chainDisplayParts(messageParts[i]) as part, pi (contentPartKey(part, pi))}
                    {#if part.type === 'text' && part.text}
                      <div class="min-w-0 px-2 text-[13px] leading-relaxed text-foreground/90">
                        <Response class="min-w-0" content={part.text} />
                      </div>
                    {:else if part.type === 'thinking'}
                      <div class="flex items-center px-2 py-1 text-[13px]" aria-live="polite">
                        <span class="thinking-shimmer font-medium">Thinking</span>
                      </div>
                    {:else if part.type === 'reasoning' && uiSettings.value.showReasoning && (part.status === 'running' || part.text.trim())}
                      {@const reasoningIsStreaming = part.status === 'running'}
                      {@const reasoningKey = `reasoning-expanded:${part.id}`}
                      {@const isReasoningExpanded = reasoningExpanded[reasoningKey] ?? false}
                      {@const reasoningStartedAt = reasoningStarted[part.id] ?? 0}
                      {@const reasoningElapsedMs = reasoningIsStreaming
                        ? reasoningNow - reasoningStartedAt
                        : (reasoningDuration[part.id] ?? 0)}
                      {@const reasoningElapsedSec = Math.max(
                        0,
                        Math.floor(reasoningElapsedMs / 1000)
                      )}
                      <button
                        type="button"
                        class="group flex cursor-pointer items-center gap-1.5 px-2 py-px text-left text-[12px]"
                        aria-expanded={isReasoningExpanded}
                        onclick={() => {
                          reasoningExpanded = {
                            ...reasoningExpanded,
                            [reasoningKey]: !isReasoningExpanded
                          };
                        }}>
                        <span class="flex-shrink-0 font-medium whitespace-nowrap">
                          {#if reasoningIsStreaming}
                            <span
                              class="thinking-shimmer inline-flex h-4 items-center text-[12px] leading-none"
                              >Thinking{reasoningElapsedSec > 0
                                ? ` for ${reasoningElapsedSec}s`
                                : ''}</span>
                          {:else}
                            <span class="text-muted-foreground"
                              >Thought{reasoningElapsedSec > 0
                                ? ` for ${reasoningElapsedSec}s`
                                : ''}</span>
                          {/if}
                        </span>
                        <ChevronRight
                          class="size-3 flex-shrink-0 text-muted-foreground/50 transition-transform duration-200 ease-out {isReasoningExpanded
                            ? 'rotate-90'
                            : 'opacity-0 group-hover:opacity-100'}" />
                      </button>
                      {#if isReasoningExpanded && part.text}
                        <div
                          class="mt-0.5 ml-2 max-w-prose overflow-y-auto border-l border-border/50 py-1 pl-3"
                          style="max-height: 120px;"
                          use:autoScroll={{
                            isStreaming: reasoningIsStreaming,
                            text: part.text
                          }}>
                          <p
                            class="text-[12px] leading-5 whitespace-pre-wrap text-muted-foreground/80">
                            {part.text}
                          </p>
                        </div>
                      {/if}
                    {:else if part.type === 'tool-simple'}
                      <ToolSimpleChip
                        toolName={part.toolName}
                        titlePending={part.titlePending}
                        titleDone={part.titleDone}
                        subtitle={part.subtitle}
                        status={part.status}
                        details={part.details}
                        searchResults={part.searchResults}
                        toolInput={part.toolInput} />
                    {:else if part.type === 'chain-of-thought'}
                      <ChainOfThought defaultOpen={part.status === 'running'}>
                        <ChainOfThoughtHeader
                          class="text-[13px] font-medium text-foreground/80 hover:text-foreground">
                          <span class={part.status === 'running' ? 'thinking-shimmer' : ''}
                            >Chain of Thought</span>
                          {#if part.thoughts.length > 0}
                            <span class="ml-1 text-[13px] font-normal text-muted-foreground">
                              · {part.thoughts.length} thought{part.thoughts.length === 1
                                ? ''
                                : 's'}
                            </span>
                          {/if}
                        </ChainOfThoughtHeader>
                        <ChainOfThoughtContent>
                          {#each part.thoughts as thought, tIdx (`${thought.label}:${tIdx}`)}
                            <ChainOfThoughtStep
                              class="text-[12px]"
                              label={thought.label}
                              description={thought.detail}
                              status={part.status === 'running' && tIdx === part.thoughts.length - 1
                                ? 'active'
                                : 'complete'} />
                          {/each}
                        </ChainOfThoughtContent>
                      </ChainOfThought>
                      {#if part.conclusion}
                        <p class="mt-2 text-[12px] leading-relaxed font-medium text-foreground/80">
                          {part.conclusion}
                        </p>
                      {/if}
                    {:else if part.type === 'thought-chain'}
                      <ChainOfTools defaultOpen={part.status === 'running'}>
                        <ChainOfToolsHeader
                          class="text-[13px] font-medium text-foreground/80 hover:text-foreground">
                          <span class={part.status === 'running' ? 'thinking-shimmer' : ''}
                            >Chain of Tools</span>
                          <span class="ml-1 text-[13px] font-normal text-muted-foreground">
                            · {part.parts.length} step{part.parts.length === 1 ? '' : 's'}
                          </span>
                        </ChainOfToolsHeader>
                        <ChainOfToolsContent>
                          {#each part.parts as step (step.id)}
                            {@const hasOutput =
                              (step.searchResults && step.searchResults.length > 0) ||
                              (step.details && step.details.length > 0)}
                            <ChainOfToolsStep
                              class="text-[12px]"
                              icon={toolIcon(step.toolName, step.toolInput)}
                              label={step.status === 'running' ? step.titlePending : step.titleDone}
                              description={step.subtitle}
                              status={step.status === 'running' ? 'active' : 'complete'}
                              toggleable={hasOutput}>
                              {#if step.searchResults && step.searchResults.length > 0}
                                <div
                                  class="mt-1 overflow-hidden rounded-md border border-border/40 px-3 py-2"
                                  style="background-color: var(--tool-box-bg);">
                                  <ul class="space-y-2">
                                    {#each step.searchResults as result, rIdx (`${result.url ?? result.title}:${rIdx}`)}
                                      <li class="flex flex-col gap-0.5">
                                        {#if result.url}
                                          <a
                                            href={result.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            class="text-[12px] font-medium text-foreground/90 hover:text-foreground hover:underline">
                                            {result.title}
                                          </a>
                                        {:else}
                                          <span class="text-[12px] font-medium text-foreground/90"
                                            >{result.title}</span>
                                        {/if}
                                        {#if result.source || result.url}
                                          <span class="text-[11px] text-muted-foreground/60">
                                            {result.source ??
                                              new URL(result.url ?? 'http://x').hostname.replace(
                                                /^www\./,
                                                ''
                                              )}
                                          </span>
                                        {/if}
                                        {#if result.snippet}
                                          <span
                                            class="text-[11px] leading-relaxed text-muted-foreground/75">
                                            {result.snippet}
                                          </span>
                                        {/if}
                                      </li>
                                    {/each}
                                  </ul>
                                </div>
                              {:else if step.details && step.details.length > 0}
                                <div
                                  class="mt-1 overflow-hidden rounded-md border border-border/40 px-3 py-2"
                                  style="background-color: var(--tool-box-bg);">
                                  <div
                                    class="space-y-1 text-[12px] leading-relaxed text-muted-foreground/75">
                                    {#each step.details as detail, dIdx (`${detail}:${dIdx}`)}
                                      <div class="truncate">{detail}</div>
                                    {/each}
                                  </div>
                                </div>
                              {/if}
                            </ChainOfToolsStep>
                          {/each}
                        </ChainOfToolsContent>
                      </ChainOfTools>
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
                        totalLines={artifact.totalLines} />
                    {:else if part.type === 'error'}
                      <!--
                        Error block. The server's onError handler encodes the
                        upstream code as a `[CODE] message` prefix when known
                        (e.g. `[404] Hy3 preview is no longer available...`).
                        We split it out so the code renders as a distinct
                        badge instead of being lost in the message body.
                      -->
                      {@const rawError = normalizeErrorMessage(part.error ?? '')}
                      {@const codedMatch = rawError.match(/^\[([^\]]+)\]\s*([\s\S]*)$/)}
                      {@const errCode = codedMatch ? codedMatch[1] : ''}
                      {@const errMsg = codedMatch
                        ? normalizeErrorMessage(codedMatch[2])
                        : rawError || 'Something went wrong.'}
                      {@const isMissingKey = isMissingProviderKeyError(errMsg)}
                      {@const providerLabel = missingProviderLabel(errMsg)}
                      <div
                        class="flex min-h-11 items-center gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2">
                        <div
                          class="flex size-7 shrink-0 items-center justify-center rounded-md text-destructive ring-1 ring-destructive/20">
                          <AlertCircle class="size-4" />
                        </div>
                        <div class="flex min-w-0 flex-1 flex-col gap-1">
                          {#if isMissingKey}
                            <div class="text-[13px] font-medium text-foreground">
                              {providerLabel} key required
                            </div>
                            <div
                              class="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
                              Add your key in Settings, then retry this message.
                            </div>
                            <div class="mt-1 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                class="inline-flex h-7 items-center rounded-md bg-foreground px-2.5 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
                                onclick={openSettingsModal}>
                                Open Settings
                              </button>
                              <span class="text-[12px] text-muted-foreground"> Models & Keys </span>
                            </div>
                          {:else}
                            <div
                              class="min-w-0 truncate text-[13px] leading-5 text-destructive"
                              title={errMsg}>
                              {#if errCode}<span class="font-mono">[{errCode}]</span>
                              {/if}{errMsg}
                            </div>
                          {/if}
                        </div>
                        <button
                          type="button"
                          aria-label="Retry"
                          title="Retry"
                          class="ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          onclick={() =>
                            retryMessage(
                              part.userMessage ||
                                (messages
                                  .filter((m: Record<string, unknown>) => m.role === 'user')
                                  .pop()?.content as string) ||
                                ''
                            )}>
                          <RotateCcw class="size-3.5" />
                        </button>
                      </div>
                    {:else if part.type === 'markdown'}
                      {@const mdExpandKey = `md-expanded:${part.id}`}
                      {@const isMdExpanded =
                        toolSimpleExpanded[mdExpandKey] ?? Boolean(part.isStreaming)}
                      {@const mdHasContent = (part.content ?? '').length > 0}
                      {@const mdPendingTitle = part.operation === 'read' ? 'Reading' : 'Writing'}
                      {@const mdDoneTitle =
                        part.operation === 'read'
                          ? 'Read'
                          : part.operation === 'append'
                            ? 'Appended'
                            : 'Wrote'}
                      <button
                        type="button"
                        class="group flex w-full items-start gap-2 px-2 py-1 text-left {part.isStreaming
                          ? 'tool-active-shimmer'
                          : ''} {mdHasContent ? 'cursor-pointer' : ''}"
                        disabled={!mdHasContent}
                        aria-expanded={mdHasContent ? isMdExpanded : undefined}
                        onclick={() => {
                          if (!mdHasContent) return;
                          toolSimpleExpanded = {
                            ...toolSimpleExpanded,
                            [mdExpandKey]: !isMdExpanded
                          };
                        }}>
                        <span
                          class="flex size-4 flex-shrink-0 items-center justify-center {part.isStreaming
                            ? 'tool-active-icon-shimmer'
                            : 'text-muted-foreground/70'}">
                          <FileText class="size-4 flex-shrink-0" />
                        </span>
                        <div
                          class="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground">
                          <span class="flex-shrink-0 font-medium whitespace-nowrap">
                            {#if part.isStreaming}
                              <span
                                class="thinking-shimmer inline-flex h-4 items-center text-[13px] leading-none"
                                >{mdPendingTitle}</span>
                            {:else}
                              {mdDoneTitle}
                            {/if}
                          </span>
                          <span
                            class="min-w-0 truncate text-[12px] font-normal text-muted-foreground/60">
                            {part.lines} line{part.lines !== 1 ? 's' : ''}
                          </span>
                          {#if mdHasContent}
                            <ChevronRight
                              class="size-3.5 flex-shrink-0 text-muted-foreground/60 transition-transform duration-200 ease-out {isMdExpanded
                                ? 'rotate-90'
                                : 'opacity-0 group-hover:opacity-100'}" />
                          {/if}
                        </div>
                      </button>
                      {#if isMdExpanded && mdHasContent}
                        <div
                          class="mt-1 overflow-y-auto rounded-md border border-border/40 px-3 py-2"
                          style="max-height: 300px; background-color: var(--tool-box-bg);">
                          <pre
                            class="text-[12px] leading-relaxed whitespace-pre-wrap text-muted-foreground/85">{part.content}</pre>
                        </div>
                      {/if}
                    {:else if part.type === 'questionnaire'}
                      <!-- Compact summary; the actual answer UI is rendered in the input area below -->
                      {@const answeredCount = questionnaireAnsweredCount(
                        part.questions,
                        questionnaireResponses[part.id] || {}
                      )}
                      <div
                        class="flex items-center gap-2 px-2 py-1 {part.isStreaming
                          ? 'tool-active-shimmer'
                          : ''}">
                        <span
                          class="flex size-4 flex-shrink-0 items-center justify-center {part.isStreaming
                            ? 'tool-active-icon-shimmer'
                            : 'text-muted-foreground/70'}">
                          <MessageCircleQuestion class="size-4 flex-shrink-0" />
                        </span>
                        <div
                          class="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground">
                          <span class="flex-shrink-0 font-medium whitespace-nowrap">
                            {#if part.isStreaming}
                              <span
                                class="thinking-shimmer inline-flex h-4 items-center text-[13px] leading-none"
                                >Preparing questions</span>
                            {:else if part.submitted}
                              Answered
                            {:else}
                              Asking
                            {/if}
                          </span>
                          {#if !part.isStreaming && part.questions.length > 0}
                            <span
                              class="min-w-0 truncate text-[12px] font-normal text-muted-foreground/60">
                              {answeredCount}/{part.questions.length} answered
                            </span>
                          {/if}
                        </div>
                      </div>
                    {/if}
                  {/each}
                {:else if isLoading && i === messages.length - 1}
                  <div class="flex items-center py-2" aria-live="polite">
                    <span class="thinking-shimmer text-[13px] font-medium text-muted-foreground/60">
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
        class="flex w-full items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[13px] font-medium text-destructive">
        <AlertCircle class="size-3.5 shrink-0" />
        <span class="flex-1 truncate">{fileError}</span>
        <button
          type="button"
          aria-label="Dismiss file error"
          class="shrink-0 text-destructive hover:text-destructive"
          onclick={() => {
            fileError = null;
          }}>✕</button>
      </div>
    </div>
  {/if}

  <!-- Input Area -->
  <div class="mx-auto w-full max-w-3xl shrink-0 px-3 pt-2 pb-3 sm:px-4">
    {#if pendingQuestionnaire}
      {@const qPart = pendingQuestionnaire?.part}
      {@const qAssistantIdx = pendingQuestionnaire?.assistantIdx ?? -1}
      {#if qPart}
        {@const responses = questionnaireResponses[qPart.id] || {}}
        {@const canSubmitQuestions = questionnaireIsComplete(qPart.questions, responses)}
        {@const answeredCount = questionnaireAnsweredCount(qPart.questions, responses)}
        <div
          class="chat-composer overflow-hidden rounded-[28px] border border-border/70 text-foreground transition-colors duration-150"
          style="background-color: var(--chat-input-bg);">
          <div class="flex items-center gap-2 px-4 pt-4 pb-2">
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary/70 text-muted-foreground">
              <MessageCircleQuestion class="size-4 flex-shrink-0" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-[14px] leading-tight font-medium text-foreground">
                {qPart.questions.length} question{qPart.questions.length !== 1 ? 's' : ''}
              </div>
              <div class="text-[12px] leading-tight text-muted-foreground">
                {answeredCount}/{qPart.questions.length} answered
              </div>
            </div>
            <div class="ml-auto">
              <TooltipWrap text="Skip">
                <button
                  type="button"
                  class="composer-secondary-control flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Skip questions"
                  onclick={() => {
                    const parts = messageParts[qAssistantIdx] || [];
                    const idx = parts.findIndex(
                      (p: ContentPart) => p.type === 'questionnaire' && p.id === qPart.id
                    );
                    if (idx >= 0) {
                      parts[idx] = { ...parts[idx], submitted: true } as ContentPart;
                      messageParts[qAssistantIdx] = [...parts];
                    }
                  }}>
                  <X class="size-4" />
                </button>
              </TooltipWrap>
            </div>
          </div>
          <div class="max-h-[42vh] overflow-y-auto px-4 pt-2 pb-3">
            {#if qPart.context}
              <p class="mb-3 text-[13px] leading-relaxed text-muted-foreground">
                {qPart.context}
              </p>
            {/if}
            <div class="space-y-4">
              {#each qPart.questions as q, qi (q.id)}
                <div>
                  <p class="mb-2 text-[13px] leading-snug font-medium text-foreground">
                    {qi + 1}. {q.text}
                  </p>
                  {#if q.options.length > 0}
                    <div class="grid gap-2">
                      {#each q.options as opt (opt.id)}
                        {@const respVal = (questionnaireResponses[qPart.id] || {})[q.id]}
                        {@const isSelected =
                          q.type === 'multi'
                            ? Array.isArray(respVal) && respVal.includes(opt.label)
                            : respVal === opt.label}
                        <button
                          type="button"
                          class="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] transition-[border-color,background-color,color] {isSelected
                            ? 'border-foreground/25 bg-secondary text-foreground'
                            : 'border-border/70 bg-background/30 text-muted-foreground hover:border-foreground/20 hover:bg-secondary/70 hover:text-foreground'}"
                          onclick={() => {
                            const resp = questionnaireResponses[qPart.id] || {};
                            if (q.type === 'multi') {
                              const current = Array.isArray(resp[q.id])
                                ? [...(resp[q.id] as string[])]
                                : [];
                              const idx = current.indexOf(opt.label);
                              if (idx >= 0) current.splice(idx, 1);
                              else current.push(opt.label);
                              questionnaireResponses[qPart.id] = { ...resp, [q.id]: current };
                            } else {
                              questionnaireResponses[qPart.id] = { ...resp, [q.id]: opt.label };
                            }
                            questionnaireResponses = { ...questionnaireResponses };
                          }}>
                          <span
                            class="flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-[border-color,background-color,color] {isSelected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-current/25 text-muted-foreground'}">
                            {#if isSelected}
                              <Check class="size-3" />
                            {/if}
                          </span>
                          <span>{opt.label}</span>
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
          <div class="flex items-center justify-end gap-2 px-4 pt-1 pb-4">
            <button
              type="button"
              class="composer-secondary-control h-8 cursor-pointer rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              onclick={() => {
                const parts = messageParts[qAssistantIdx] || [];
                const idx = parts.findIndex(
                  (p: ContentPart) => p.type === 'questionnaire' && p.id === qPart.id
                );
                if (idx >= 0) {
                  parts[idx] = { ...parts[idx], submitted: true } as ContentPart;
                  messageParts[qAssistantIdx] = [...parts];
                }
              }}>
              Skip
            </button>
            <button
              type="button"
              disabled={!canSubmitQuestions}
              class="composer-accent-control h-8 cursor-pointer rounded-full px-4 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
              onclick={() =>
                handleQuestionnaireSubmit(qPart.id, qPart.questions, qPart.context, qAssistantIdx)}>
              Submit
            </button>
          </div>
        </div>
      {/if}
    {:else}
      <PromptInput
        bind:attachments={composerAttachments}
        class="chat-composer overflow-hidden rounded-[28px] border border-border/70 text-foreground transition-colors duration-150 focus-within:border-foreground/25"
        style="background-color: var(--chat-input-bg);"
        accept={attachmentAccept}
        multiple
        maxFileSize={maxUploadSize}
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
        <PromptInputBody class="relative">
          <Textarea
            bind:ref={inputEl}
            class="relative z-0 block field-sizing-content w-full resize-none rounded-none border-none bg-transparent pt-4 pb-2 text-[16px] leading-[1.5] text-foreground shadow-none ring-0 outline-none placeholder:text-muted-foreground/50 focus-visible:ring-0 sm:text-[14px] dark:bg-transparent"
            style="min-height: 56px; max-height: {inputExpanded
              ? 'min(60vh, 480px)'
              : `${INPUT_COLLAPSED_MAX}px`}; padding-left: 1rem; padding-right: {inputOverflow
              ? '2.5rem'
              : '1rem'};"
            name="message"
            aria-label="Message"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            data-1p-ignore
            data-lpignore="true"
            placeholder={selectedContext.type
              ? `Ask about the selected ${selectedContext.type}…`
              : 'Describe your diagram…'}
            bind:value={inputText}
            disabled={isLoading}
            onpaste={handleInputPaste}
            onkeydown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                const form = (e.currentTarget as HTMLTextAreaElement).form;
                if (form) form.requestSubmit();
              }
            }} />
          {#if inputOverflow}
            <button
              type="button"
              aria-label={inputExpanded ? 'Collapse input' : 'Expand input'}
              aria-pressed={inputExpanded}
              class="absolute top-2 right-2 z-10 inline-flex size-6 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:text-foreground"
              style="background-color: var(--chat-input-bg);"
              onclick={() => (inputExpanded = !inputExpanded)}>
              {#if inputExpanded}
                <ChevronDown class="size-3.5" />
              {:else}
                <ChevronUp class="size-3.5" />
              {/if}
            </button>
          {/if}
        </PromptInputBody>
        <PromptInputToolbar
          class="composer-toolbar relative z-20 min-w-0 gap-1 overflow-visible px-2 pt-0 pb-2">
          <PromptInputTools class="min-w-0 flex-1 gap-1 overflow-hidden">
            <!-- Attachment button -->
            <TooltipWrap text="Attach PDF, TXT, or Markdown">
              <button
                type="button"
                class="composer-secondary-control flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150"
                aria-label="Attach files"
                onclick={(e) => {
                  e.preventDefault();
                  const wrapper = (e.currentTarget as HTMLElement).closest('.mx-auto');
                  const fileInput = wrapper?.querySelector(
                    'input[type="file"]'
                  ) as HTMLInputElement;
                  if (fileInput) fileInput.click();
                }}>
                <Plus class="size-4" />
              </button>
            </TooltipWrap>
            <!-- Improve prompt button -->
            {#if inputText.trim().length > 0}
              <TooltipWrap text={isImprovingPrompt ? 'Improving…' : 'Improve prompt'}>
                <button
                  type="button"
                  class="composer-secondary-control flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 {isImprovingPrompt
                    ? 'bg-primary/10 text-primary'
                    : ''}"
                  aria-label={isImprovingPrompt ? 'Improving prompt' : 'Improve prompt'}
                  disabled={isImprovingPrompt || isLoading}
                  onclick={improvePrompt}>
                  {#if isImprovingPrompt}
                    <div
                      class="size-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent">
                    </div>
                  {:else}
                    <Sparkles class="size-3.5" />
                  {/if}
                </button>
              </TooltipWrap>
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
                class="composer-model-trigger composer-secondary-control flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground outline-offset-2 transition-[background-color,border-color,color] duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/60">
                <ProviderIcon
                  provider={selectedModel?.provider}
                  modelId={selectedModel?.id}
                  class="size-4 shrink-0" />
                <span class="min-w-0 truncate">
                  {selectedModel
                    ? selectedModel.name.includes(': ')
                      ? selectedModel.name.split(': ').slice(1).join(': ')
                      : selectedModel.name
                    : 'Model'}
                </span>
                <ChevronDown class="size-3 shrink-0 opacity-50" />
              </Popover.Trigger>
              <Popover.Content
                class="w-[min(340px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover p-0 shadow-lg"
                align="start"
                sideOffset={8}>
                <!-- Search -->
                <div class="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                  <Search class="size-4 shrink-0 text-muted-foreground/60" />
                  <input
                    type="text"
                    name="model-search"
                    aria-label="Search models"
                    placeholder="Search models…"
                    class="h-6 w-full bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground/50 sm:h-5 sm:text-[13px]"
                    bind:value={modelSearchQuery} />
                  <TooltipWrap text="Refresh models">
                    <button
                      type="button"
                      class="composer-secondary-control flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors disabled:pointer-events-none disabled:opacity-50"
                      aria-label="Refresh models"
                      disabled={modelsStore.isLoading}
                      onclick={() => modelsStore.fetch()}>
                      <RefreshCw class="size-4 {modelsStore.isLoading ? 'animate-spin' : ''}" />
                    </button>
                  </TooltipWrap>
                </div>
                <!-- Model list -->
                <div class="max-h-[360px] overflow-y-auto overscroll-contain p-1">
                  {#if modelsStore.isLoading && modelsStore.models.length === 0}
                    <div class="flex items-center justify-center py-8">
                      <div class="flex items-center gap-2 text-[13px] text-muted-foreground">
                        <div
                          class="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground">
                        </div>
                        Loading…
                      </div>
                    </div>
                  {:else if filteredModels.length === 0}
                    <div class="flex flex-col items-center justify-center gap-2 py-8">
                      <Search class="size-5 text-muted-foreground/20" />
                      <span class="text-[13px] text-muted-foreground/60">No models</span>
                    </div>
                  {:else}
                    {#each groupedModels as [provider, providerModels], gIdx (provider)}
                      {#if gIdx > 0}
                        <div class="my-1 h-px bg-border/40"></div>
                      {/if}
                      <div class="px-2 pt-2 pb-1">
                        <span class="text-[12px] font-medium text-muted-foreground/70"
                          >{providerLabel(provider)}</span>
                      </div>
                      {#each providerModels as model (model.id)}
                        {@const isSelected = selectedModelId === model.id}
                        <button
                          type="button"
                          class="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-foreground/10 {isSelected
                            ? 'bg-foreground/10'
                            : ''}"
                          onclick={() => {
                            modelsStore.select(model.id);
                            modelPopoverOpen = false;
                            modelSearchQuery = '';
                          }}>
                          <ProviderIcon
                            provider={model.provider}
                            modelId={model.id}
                            class="size-4.5 shrink-0" />
                          <span
                            class="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground"
                            >{model.name.includes(': ')
                              ? model.name.split(': ').slice(1).join(': ')
                              : model.name}</span>
                          {#if isSelected}
                            <Check class="size-4 shrink-0 text-foreground" />
                          {/if}
                        </button>
                      {/each}
                    {/each}
                  {/if}
                </div>
              </Popover.Content>
            </Popover.Root>
          </PromptInputTools>
          <div class="composer-actions relative z-30 ml-auto flex shrink-0 items-center gap-1">
            <!-- Context usage -->
            <TooltipWrap text={contextTitle}>
              <div
                class="composer-context-meter composer-secondary-control hidden size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 sm:flex"
                aria-label={contextTitle}>
                <svg class="size-4.5" viewBox="0 0 36 36">
                  <circle
                    cx="18"
                    cy="18"
                    r="13"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="4"
                    class="text-muted-foreground/30" />
                  <circle
                    cx="18"
                    cy="18"
                    r="13"
                    fill="none"
                    stroke-width="4"
                    stroke-linecap="round"
                    class="stroke-foreground/60 transition-all duration-500"
                    stroke-dasharray="{contextPercent * 0.8168} 81.68"
                    transform="rotate(-90 18 18)" />
                </svg>
              </div>
            </TooltipWrap>
            <!-- Mic button -->
            <TooltipWrap
              text={isRecording
                ? 'Stop recording'
                : isTranscribing
                  ? 'Transcribing…'
                  : 'Voice input'}>
              <button
                type="button"
                class="composer-mic composer-secondary-control flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 {isRecording
                  ? 'bg-destructive/10 text-destructive'
                  : isTranscribing
                    ? 'bg-foreground/10 text-foreground'
                    : 'hover:text-foreground'}"
                disabled={isTranscribing}
                aria-label={isRecording ? 'Stop recording' : 'Voice input'}
                onclick={() => {
                  if (isRecording) stopRecording();
                  else startRecording();
                }}>
                {#if isTranscribing}
                  <div
                    class="size-3.5 animate-spin rounded-full border-2 border-foreground border-t-transparent">
                  </div>
                {:else}
                  <Mic class="size-3.5" />
                {/if}
              </button>
            </TooltipWrap>
            <!-- Send / Stop / Processing -->
            {#if isProcessingFiles}
              <div
                class="flex size-8 items-center justify-center rounded-full bg-muted"
                title="Processing files…"
                role="status"
                aria-label="Processing files">
                <div
                  class="size-3.5 animate-spin rounded-full border-2 border-warning/20 border-t-amber-500">
                </div>
              </div>
            {:else if isLoading}
              <TooltipWrap text="Stop response">
                <button
                  type="button"
                  onclick={stopStream}
                  aria-label="Stop response"
                  class="composer-accent-control relative z-30 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150">
                  <Square class="size-3.5" fill="currentColor" />
                </button>
              </TooltipWrap>
            {:else}
              <PromptInputSubmit
                status={chatStatus}
                aria-label="Send message"
                class="composer-accent-control relative z-30 size-8 shrink-0 rounded-full transition-colors duration-150 disabled:opacity-40" />
            {/if}
          </div>
        </PromptInputToolbar>
      </PromptInput>
    {/if}
  </div>
</div>

<style>
  :global(.chat-composer) {
    container-type: inline-size;
  }

  :global(.composer-accent-control) {
    color: var(--primary-foreground);
    background: linear-gradient(
      135deg,
      color-mix(in srgb, #2000a7 78%, transparent) 0%,
      color-mix(in srgb, #6300ee 78%, transparent) 100%
    );
    border: 1px solid rgb(255 255 255 / 0.18);
    backdrop-filter: blur(14px) saturate(160%);
    -webkit-backdrop-filter: blur(14px) saturate(160%);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.22),
      inset 0 -1px 0 rgb(0 0 0 / 0.18);
    transition:
      background 150ms ease,
      box-shadow 150ms ease,
      transform 150ms ease;
  }

  :global(.composer-accent-control:hover:not(:disabled)) {
    background: linear-gradient(135deg, #3a14d4 0%, #8030ff 100%);
    border-color: rgb(255 255 255 / 0.28);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.36),
      inset 0 -1px 0 rgb(0 0 0 / 0.22);
  }

  :global(.composer-accent-control:active:not(:disabled)) {
    transform: scale(0.96);
    background: linear-gradient(135deg, #1a0095 0%, #5500cc 100%);
    box-shadow:
      inset 0 1px 2px rgb(0 0 0 / 0.3),
      inset 0 -1px 0 rgb(255 255 255 / 0.1);
  }

  :global(.composer-accent-control:focus-visible) {
    outline: none;
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.28),
      inset 0 -1px 0 rgb(0 0 0 / 0.2),
      0 0 0 2px color-mix(in srgb, #7320ff 55%, transparent);
  }

  :global(.composer-secondary-control) {
    border: 1px solid transparent;
    transition:
      background-color 120ms ease,
      color 120ms ease,
      transform 120ms ease;
  }

  /* Light mode — darken on hover (ink on paper), darken+press on active. */
  :global(.composer-secondary-control:hover:not(:disabled)),
  :global(.composer-secondary-control:focus-visible) {
    color: var(--foreground);
    background: color-mix(in srgb, var(--foreground) 12%, transparent);
  }

  :global(.composer-secondary-control:active:not(:disabled)) {
    transform: scale(0.96);
    background: color-mix(in srgb, var(--foreground) 18%, transparent);
  }

  /* Dark mode — lighten on hover (foreground over near-black), brighter press. */
  :global(.dark .composer-secondary-control:hover:not(:disabled)),
  :global(.dark .composer-secondary-control:focus-visible) {
    background: rgb(255 255 255 / 0.1);
  }

  :global(.dark .composer-secondary-control:active:not(:disabled)) {
    background: rgb(255 255 255 / 0.16);
  }

  :global(.composer-model-trigger) {
    width: fit-content;
    min-width: 132px;
    max-width: min(210px, calc(100cqw - 108px));
    flex: 0 1 auto;
  }

  @container (max-width: 430px) {
    :global(.composer-context-meter) {
      display: none;
    }

    :global(.composer-model-trigger) {
      max-width: min(200px, calc(100cqw - 92px));
    }
  }

  @container (max-width: 360px) {
    :global(.composer-toolbar) {
      gap: 0.25rem;
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }

    :global(.composer-mic) {
      display: none;
    }

    :global(.composer-model-trigger) {
      min-width: 124px;
      max-width: min(180px, calc(100cqw - 80px));
    }
  }

  @container (max-width: 300px) {
    :global(.composer-model-trigger svg:first-child) {
      display: none;
    }
  }

  .thinking-shimmer {
    --base-color: #a1a1aa;
    --base-gradient-color: #000;
    --spread: 16px;
    --bg: linear-gradient(
      90deg,
      transparent calc(50% - var(--spread)),
      var(--base-gradient-color),
      transparent calc(50% + var(--spread))
    );
    position: relative;
    display: inline-block;
    background-image: var(--bg), linear-gradient(var(--base-color), var(--base-color));
    background-size:
      250% 100%,
      auto;
    background-repeat: no-repeat, padding-box;
    background-position: 100% center;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    animation: shimmer-slide 1.2s linear infinite;
  }

  :global(.dark) .thinking-shimmer {
    --base-color: #71717a;
    --base-gradient-color: #ffffff;
  }

  @keyframes shimmer-slide {
    0% {
      background-position: 100% center;
    }
    100% {
      background-position: 0% center;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .thinking-shimmer {
      animation: none;
      background: none;
      -webkit-text-fill-color: currentColor;
      color: inherit;
    }
  }
</style>
