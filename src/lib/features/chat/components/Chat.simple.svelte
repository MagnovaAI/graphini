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
  import { ReasoningBlock } from '$lib/features/chat/components/ai-elements/reasoning-block';
  import { Response } from '$lib/features/chat/components/ai-elements/response';
  import { parse as mermaidParse } from '$lib/features/diagram/mermaid';
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
    AtSign,
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
    Gem,
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

  // Track current file to detect switches
  let currentFileId = getCurrentFileId();
  let fileEffectInitialized = false;

  // React to workspace switches.
  $effect(() => {
    const newFileId = workspaceStore.workspace?.id || '_default';
    if (!fileEffectInitialized) {
      fileEffectInitialized = true;
      return;
    }
    if (newFileId !== currentFileId) {
      saveChatState();
      debouncedDbSync();
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
          role: m.role,
          content,
          parts: safeParts,
          metadata: { timestamp: m.timestamp, attachments: m.attachments }
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
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.messages || data.messages.length === 0) return false;
      messages = data.messages.map((m: Record<string, unknown>) => ({
        role: m.role,
        content: m.content,
        timestamp:
          (m.metadata as Record<string, unknown>)?.timestamp ||
          new Date(m.created_at as string).getTime(),
        attachments: (m.metadata as Record<string, unknown>)?.attachments || []
      }));
      // Restore parts from DB
      const parts: Record<number, ContentPart[]> = {};
      data.messages.forEach((m: Record<string, unknown>, i: number) => {
        if (m.parts) parts[i] = m.parts as ContentPart[];
        else if (m.role === 'assistant' && m.content)
          parts[i] = [{ type: 'text', text: m.content as string }];
      });
      messageParts = parts;
      dbConversationId = convId;
      dbSyncedMessageCount = messages.length;
      conversationStarted = messages.length > 0;
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
      // Ensure KV store cache is populated before reading from it
      await kv.init();
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
        // Not logged in — clear any stale KV chat data and reset to clean start
        try {
          kv.delete('chat', chatKey('messages'));
          kv.delete('chat', chatKey('parts'));
          kv.delete('chat', chatKey('artifacts'));
          kv.delete('chat', chatKey('reasoning'));
          kv.delete('chat', chatKey('checkpoints'));
          kv.delete('chat', chatKey('diagramCode'));
          kv.set('chat', chatKey('activeConversationId'), null);
        } catch {
          /* ignore */
        }
        messages = [];
        messageParts = {};
        artifactMap = {};
        reasoningMap = {};
        conversationStarted = false;
        conversationTitle = null;
        // Reset diagram to empty
        inputStateStore.update((s) => ({ ...s, code: '', updateDiagram: true }));
      }
      isDataReady = true;
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

    // Clean up messageParts, artifactMap, reasoningMap for removed messages
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
    | { type: 'artifact'; artifactId: string }
    | { type: 'reasoning'; id: string }
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

  function contentPartKey(part: ContentPart, index: number) {
    if (part.type === 'artifact') return part.artifactId;
    if ('id' in part) return part.id;
    if (part.type === 'text') return `text:${part.text.slice(0, 40)}:${index}`;
    if (part.type === 'error') return `error:${part.error}:${index}`;
    return `part:${index}`;
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

  function shouldShowReasoning(content: string): boolean {
    const text = content.trim();
    if (!text) return false;

    const lower = text.toLowerCase();
    const toolChoiceSignals = [
      'according to the workflow',
      'call diagram',
      'call selfcritique',
      'call subagent',
      'call the tool',
      'function call',
      'need to call',
      'produce a function',
      'produce the call',
      'tool call',
      'use the tool',
      'we need to call'
    ];

    return !toolChoiceSignals.some((signal) => lower.includes(signal));
  }

  let questionnaireResponses = $state<Record<string, Record<string, string | string[]>>>({});
  let messageParts = $state<Record<number, ContentPart[]>>({});

  // Reasoning blocks stored by ID
  interface ReasoningData {
    id: string;
    content: string;
    isStreaming: boolean;
    startTime: number;
    durationMs?: number;
  }
  let reasoningMap = $state<Record<string, ReasoningData>>({});
  let currentReasoningId = $state<string | null>(null);

  // Tool streaming state
  let currentToolCallId = $state<string | null>(null);
  let currentToolName = $state('');
  let currentToolInputJson = $state('');
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

  // Group models by category for organized display
  let groupedModels = $derived.by(() => {
    const groups: Record<string, typeof filteredModels> = {};
    for (const model of filteredModels) {
      const cat = model.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(model);
    }
    // Sort categories: prioritize common ones
    const order = ['fast', 'standard', 'powerful', 'reasoning', 'creative', 'other'];
    return Object.entries(groups).sort(([a], [b]) => {
      const ai = order.indexOf(a.toLowerCase());
      const bi = order.indexOf(b.toLowerCase());
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  });

  let messagesContainer: HTMLDivElement;
  let abortController: AbortController | null = $state(null);

  let selectedModel = $derived(modelsStore.selectedModel ?? modelsStore.models[0]);
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
  const CONTEXT_WINDOW = 128000; // default context window in tokens
  let estimatedTokens = $derived.by(() => {
    let total = 0;
    for (const msg of messages) {
      total += Math.ceil((msg.content?.length || 0) / 3.5);
    }
    // Add current diagram code tokens
    const diagramCode = $stateStore.code || '';
    total += Math.ceil(diagramCode.length / 3.5);
    return total;
  });
  let contextPercent = $derived(
    Math.min(100, Math.round((estimatedTokens / CONTEXT_WINDOW) * 100))
  );
  let contextColor = $derived(
    contextPercent > 80
      ? 'text-red-500'
      : contextPercent > 50
        ? 'text-amber-500'
        : 'text-emerald-500'
  );
  let contextStrokeColor = $derived(
    contextPercent > 80
      ? 'stroke-red-500'
      : contextPercent > 50
        ? 'stroke-amber-500'
        : 'stroke-emerald-500'
  );

  // Save chat state to localStorage (full state including artifacts) — per-file
  function saveChatState() {
    try {
      // Save messages (include attachments for user messages)
      const simpleMessages = messages.map((m: Record<string, unknown>) => {
        const msg: Record<string, unknown> = { id: m.id, role: m.role, content: m.content };
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
      kv.set('chat', chatKey('messages'), simpleMessages);
      workspaceStore.setActiveDiagramChatMessages(
        simpleMessages.map((message: Record<string, unknown>) => ({
          content: String(message.content ?? ''),
          id: String(message.id ?? uuidv4()),
          model_used: message.model_used as string | undefined,
          role: (message.role as 'user' | 'assistant' | 'system') ?? 'user',
          timestamp: String(message.timestamp ?? new Date().toISOString())
        }))
      );
      // Save all message parts (including artifact refs and reasoning refs)
      const allParts: Record<number, ContentPart[]> = {};
      for (const [idx, parts] of Object.entries(messageParts)) {
        allParts[Number(idx)] = (parts as ContentPart[]).map((p: ContentPart) => {
          if (p.type === 'text') return { type: 'text', text: p.text };
          if (p.type === 'artifact') return { type: 'artifact', artifactId: p.artifactId };
          if (p.type === 'reasoning') return { type: 'reasoning', id: p.id };
          if (p.type === 'error') return { type: 'error', error: p.error };
          return p;
        });
      }
      kv.set('chat', chatKey('parts'), allParts);
      // Save artifacts (only finalized, non-streaming)
      const savedArtifacts: Record<string, Artifact> = {};
      for (const [id, art] of Object.entries(artifactMap)) {
        if (!art.isStreaming) {
          savedArtifacts[id] = { ...art, isStreaming: false };
        }
      }
      kv.set('chat', chatKey('artifacts'), savedArtifacts);
      // Save reasoning blocks (only finalized)
      const savedReasoning: Record<string, ReasoningData> = {};
      for (const [id, r] of Object.entries(reasoningMap)) {
        if (!r.isStreaming) {
          savedReasoning[id] = { ...r, isStreaming: false };
        }
      }
      kv.set('chat', chatKey('reasoning'), savedReasoning);
      // Save checkpoints
      kv.set('chat', chatKey('checkpoints'), checkpoints);
      // Save current diagram code so it renders on refresh
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
          if (storeVal?.code) kv.set('chat', chatKey('diagramCode'), storeVal.code);
        } else {
          kv.set('chat', chatKey('diagramCode'), currentCode);
        }
      } catch {
        /* ignore */
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
    reasoningMap = {};
    checkpoints = [];
    conversationStarted = false;
    conversationTitle = null;
    try {
      const savedMessages = kv.get<Record<string, unknown>[]>('chat', chatKey('messages'));
      const savedParts = kv.get<Record<number, ContentPart[]>>('chat', chatKey('parts'));
      const savedArtifacts = kv.get<Record<string, Artifact>>('chat', chatKey('artifacts'));
      const savedReasoning = kv.get<Record<string, ReasoningData>>('chat', chatKey('reasoning'));
      if (savedMessages && Array.isArray(savedMessages) && savedMessages.length > 0) {
        messages = savedMessages;
        conversationStarted = true;
        if (savedParts) {
          messageParts = savedParts;
        } else {
          // Rebuild simple text parts from messages
          const parts: Record<number, ContentPart[]> = {};
          savedMessages.forEach((m: Record<string, unknown>, i: number) => {
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
        // Restore reasoning blocks
        if (savedReasoning) {
          reasoningMap = savedReasoning;
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
    reasoningMap = {};
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
      kv.delete('chat', chatKey('messages'));
      kv.delete('chat', chatKey('parts'));
      kv.delete('chat', chatKey('artifacts'));
      kv.delete('chat', chatKey('reasoning'));
      kv.delete('chat', chatKey('checkpoints'));
      kv.delete('chat', chatKey('diagramCode'));
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
    reasoningMap = {};
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
      kv.delete('chat', chatKey('messages'));
      kv.delete('chat', chatKey('parts'));
      kv.delete('chat', chatKey('artifacts'));
      kv.delete('chat', chatKey('reasoning'));
      kv.delete('chat', chatKey('checkpoints'));
      kv.delete('chat', chatKey('diagramCode'));
    } catch {
      /* ignore */
    }
    // Persist the active conversation ID as null (new chat)
    try {
      kv.set('chat', chatKey('activeConversationId'), null);
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
    reasoningMap = {};
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
      messages = data.messages.map((m: Record<string, unknown>) => ({
        role: m.role,
        content: m.content,
        timestamp:
          (m.metadata as Record<string, unknown>)?.timestamp ||
          new Date(m.created_at as string).getTime(),
        attachments: (m.metadata as Record<string, unknown>)?.attachments || []
      }));
      // Restore parts from DB
      const parts: Record<number, ContentPart[]> = {};
      data.messages.forEach((m: Record<string, unknown>, i: number) => {
        if (m.parts) parts[i] = m.parts as ContentPart[];
        else if (m.role === 'assistant' && m.content)
          parts[i] = [{ type: 'text', text: m.content as string }];
      });
      messageParts = parts;
      dbSyncedMessageCount = messages.length;
      conversationStarted = messages.length > 0;
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
          messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
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
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        console.error('Upload failed:', res.status);
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

    // Soft gems check — prompt refill if no gems (skip for repair)
    const balance = authStore.credits?.balance ?? 0;
    if (balance <= 0 && !isRepair) {
      messages = [
        ...messages,
        { id: uuidv4(), role: 'user', content: text },
        {
          id: uuidv4(),
          role: 'assistant',
          content:
            "💎 **You're out of gems!** You need gems to use the AI assistant. Click the button below or the gems icon in the toolbar to refill."
        }
      ];
      window.dispatchEvent(new CustomEvent('open-refill-gems'));
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
    }

    // Save checkpoint: capture diagram state before this user message
    const currentCode = $stateStore.code || '';
    const userMsgIndex = messages.length;
    checkpoints = [...checkpoints, { code: currentCode, messageIndex: userMsgIndex }];

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
    messages = [...messages, userMessage];
    inputText = '';
    isLoading = true;

    // Auto-create conversation on first message
    if (!conversationStarted) {
      conversationStarted = true;
      conversationTitle = text.length > 50 ? text.slice(0, 50) + '...' : text;
      window.dispatchEvent(
        new CustomEvent('conversation-created', {
          detail: { sessionId, title: conversationTitle }
        })
      );
    }
    currentToolCallId = null;
    currentToolName = '';
    currentToolInputJson = '';
    currentArtifactId = null;
    lastPartWasText = false;
    currentReasoningId = null;
    scrollToBottom();

    const assistantMessage = { id: uuidv4(), role: 'assistant', content: '' };
    messages = [...messages, assistantMessage];
    const assistantIndex = messages.length - 1;
    messageParts[assistantIndex] = [];

    abortController = new AbortController();

    // Build the message content with file context (all files are now text)
    let fullMessage = contextPrefix + (text || '');
    for (const fc of fileContents) {
      if (fc.extractedText) {
        fullMessage += `\n\n--- Attached file: ${fc.filename} ---\n${fc.extractedText}\n--- End of ${fc.filename} ---`;
      }
    }

    const sendRequest = () =>
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentDiagram: $stateStore.code,
          currentMarkdown: documentMarkdownStore.value,
          enabledTools: toolsStore.getEnabledToolIds(),
          engine: workspaceStore.workspace?.document?.engine ?? 'mermaid',
          isRepair,
          message: fullMessage,
          messages: messages
            .slice(0, -1)
            .filter(
              (m: Record<string, unknown>) =>
                m.role === 'user' || (m.role === 'assistant' && m.content)
            )
            .map((m: Record<string, unknown>) => ({ role: m.role, content: m.content })),
          model: selectedModelId,
          sessionId: sessionId
        }),
        signal: abortController?.signal
      });

    sendRequest()
      .then(async (res) => {
        if (!res.ok) {
          // Try to parse error body for specific messages
          try {
            const errBody = await res.json();
            const errMsg = errBody?.message || errBody?.error || '';
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
          throw new Error(`API error ${res.status}`);
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
                    // Finalize any active reasoning block when text starts
                    if (currentReasoningId && reasoningMap[currentReasoningId]) {
                      reasoningMap[currentReasoningId] = {
                        ...reasoningMap[currentReasoningId],
                        isStreaming: false,
                        durationMs: Date.now() - reasoningMap[currentReasoningId].startTime
                      };
                      reasoningMap = { ...reasoningMap };
                      currentReasoningId = null;
                    }
                    const content = data.content || data.delta || data.textDelta || '';
                    // Append to last text part, or create a new text part
                    const parts = messageParts[assistantIndex] || [];
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
                  } else if (data.type === 'reasoning-delta') {
                    // Accumulate reasoning content
                    const delta = data.delta || '';
                    if (!currentReasoningId) {
                      // Start a new reasoning block
                      currentReasoningId = `reasoning-${Date.now()}`;
                      reasoningMap[currentReasoningId] = {
                        id: currentReasoningId,
                        content: delta,
                        isStreaming: true,
                        startTime: Date.now()
                      };
                      reasoningMap = { ...reasoningMap };
                      // Insert reasoning part in stream order
                      const parts = messageParts[assistantIndex] || [];
                      parts.push({ type: 'reasoning', id: currentReasoningId });
                      messageParts[assistantIndex] = [...parts];
                      lastPartWasText = false;
                    } else {
                      // Append to existing reasoning block
                      reasoningMap[currentReasoningId] = {
                        ...reasoningMap[currentReasoningId],
                        content: reasoningMap[currentReasoningId].content + delta
                      };
                      reasoningMap = { ...reasoningMap };
                    }
                    scrollToBottom();
                  } else if (data.type === 'tool-input-start') {
                    // Finalize any active reasoning block
                    if (currentReasoningId && reasoningMap[currentReasoningId]) {
                      reasoningMap[currentReasoningId] = {
                        ...reasoningMap[currentReasoningId],
                        isStreaming: false,
                        durationMs: Date.now() - reasoningMap[currentReasoningId].startTime
                      };
                      reasoningMap = { ...reasoningMap };
                      currentReasoningId = null;
                    }
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
                      codePatch: 'codePatch',
                      codeRead: 'codeRead',
                      codeWrite: 'codeWrite',
                      diagramDelete: 'Clearing Diagram',
                      diagramPatch: 'Patching Diagram',
                      diagramRead: 'Reading Diagram',
                      diagramWrite: 'Writing Diagram'
                    };

                    if (
                      currentToolName === 'diagramWrite' ||
                      currentToolName === 'diagramPatch' ||
                      currentToolName === 'codeWrite' ||
                      currentToolName === 'codePatch'
                    ) {
                      // Reuse existing artifact card in same assistant message if one exists
                      const parts = messageParts[assistantIndex] || [];
                      const existingAid = (() => {
                        for (const p of parts) {
                          if (p.type === 'artifact' && artifactMap[p.artifactId])
                            return p.artifactId;
                        }
                        return null;
                      })();
                      if (existingAid) {
                        // Reuse existing artifact — update in-place
                        currentArtifactId = existingAid;
                        artifactMap[currentArtifactId] = {
                          ...artifactMap[currentArtifactId],
                          code: '',
                          errors: undefined,
                          hasErrors: false,
                          isStreaming: true,
                          language:
                            currentToolName === 'codeWrite' || currentToolName === 'codePatch'
                              ? artifactMap[currentArtifactId].language || 'text'
                              : 'mermaid',
                          operation: op,
                          previousCode:
                            artifactMap[currentArtifactId].code || $stateStore.code || '',
                          title: titleMap[currentToolName] || 'Processing'
                        };
                        artifactMap = { ...artifactMap };
                      } else {
                        currentArtifactId = `artifact-${currentToolCallId}`;
                        const prevCode = $stateStore.code || '';
                        artifactMap[currentArtifactId] = {
                          code: '',
                          id: currentArtifactId,
                          isStreaming: true,
                          language:
                            currentToolName === 'codeWrite' || currentToolName === 'codePatch'
                              ? 'text'
                              : 'mermaid',
                          operation: op,
                          previousCode: prevCode,
                          title: titleMap[currentToolName] || 'Processing'
                        };
                        artifactMap = { ...artifactMap };
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
                      const aid = `code-read-${currentToolCallId || Date.now()}`;
                      const parts = messageParts[assistantIndex] || [];
                      artifactMap[aid] = {
                        code: '',
                        id: aid,
                        isStreaming: true,
                        language: 'text',
                        operation: 'read',
                        previousCode: '',
                        title: 'codeRead'
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
                      currentArtifactId &&
                      (currentToolName === 'diagramWrite' ||
                        currentToolName === 'diagramPatch' ||
                        currentToolName === 'codeWrite' ||
                        currentToolName === 'codePatch')
                    ) {
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

                        if (rawCode.trim() && artifactMap[currentArtifactId]) {
                          artifactMap[currentArtifactId] = {
                            ...artifactMap[currentArtifactId],
                            code: rawCode,
                            language:
                              languageMatch?.[1] ||
                              artifactMap[currentArtifactId].language ||
                              (currentToolName.startsWith('code') ? 'text' : 'mermaid')
                          };
                          artifactMap = { ...artifactMap };
                          // Live canvas preview: debounce update to canvas during streaming
                          if (
                            currentToolName === 'diagramWrite' ||
                            currentToolName === 'diagramPatch'
                          ) {
                            if (streamCanvasTimer) clearTimeout(streamCanvasTimer);
                            streamCanvasTimer = setTimeout(() => {
                              inputStateStore.update((s) => ({ ...s, code: rawCode }));
                            }, 300);
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
                        if (currentToolName === 'autoStyler') {
                          const palMatch = currentToolInputJson.match(
                            /"palette"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          if (palMatch) liveMsg = `Applying ${palMatch[1]} palette…`;
                        } else if (currentToolName === 'iconifier') {
                          const modeMatch = currentToolInputJson.match(
                            /"mode"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          if (modeMatch) liveMsg = `Mode: ${modeMatch[1]}`;
                        } else if (currentToolName === 'planner') {
                          const taskMatch = currentToolInputJson.match(
                            /"task"\s*:\s*"((?:[^"\\]|\\.)*)"/
                          );
                          if (taskMatch)
                            liveMsg = `Planning: ${taskMatch[1].replace(/\\"/g, '"').slice(0, 60)}…`;
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
                      const aid = `read-${data.toolCallId || Date.now()}`;

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
                        title: readHasErrors ? 'Errors Found' : 'Current Diagram',
                        totalLines
                      };
                      artifactMap = { ...artifactMap };
                      const parts = messageParts[assistantIndex] || [];
                      parts.push({ type: 'artifact', artifactId: aid });
                      messageParts[assistantIndex] = [...parts];
                      lastPartWasText = false;
                      scrollToBottom();
                    } else if (
                      output &&
                      typeof output.content === 'string' &&
                      (toolName === 'codeRead' ||
                        toolName === 'codeWrite' ||
                        toolName === 'codePatch')
                    ) {
                      const aid =
                        currentArtifactId && artifactMap[currentArtifactId]
                          ? currentArtifactId
                          : `code-${data.toolCallId || Date.now()}`;
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
                        title: toolName,
                        totalLines: output.totalLines || output.lines
                      };
                      artifactMap = { ...artifactMap };
                      const parts = messageParts[assistantIndex] || [];
                      if (!parts.some((p) => p.type === 'artifact' && p.artifactId === aid)) {
                        parts.push({ type: 'artifact', artifactId: aid });
                        messageParts[assistantIndex] = [...parts];
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
                      const diagramCode = output.content;
                      if (currentArtifactId && artifactMap[currentArtifactId]) {
                        artifactMap[currentArtifactId] = {
                          ...artifactMap[currentArtifactId],
                          code: diagramCode,
                          isStreaming: false,
                          title:
                            toolName === 'diagramWrite'
                              ? 'Diagram Created'
                              : toolName === 'diagramPatch'
                                ? 'Diagram Patched'
                                : 'Diagram Updated'
                        };
                        artifactMap = { ...artifactMap };
                      } else {
                        // Try to reuse existing artifact in same message
                        const parts = messageParts[assistantIndex] || [];
                        const existingAidOut = (() => {
                          for (const p of parts) {
                            if (p.type === 'artifact' && artifactMap[p.artifactId])
                              return p.artifactId;
                          }
                          return null;
                        })();
                        const titleStr =
                          toolName === 'diagramWrite'
                            ? 'Diagram Created'
                            : toolName === 'diagramPatch'
                              ? 'Diagram Patched'
                              : 'Diagram Updated';
                        if (existingAidOut) {
                          artifactMap[existingAidOut] = {
                            ...artifactMap[existingAidOut],
                            code: diagramCode,
                            isStreaming: false,
                            title: titleStr
                          };
                          artifactMap = { ...artifactMap };
                        } else {
                          const aid = `result-${data.toolCallId || Date.now()}`;
                          artifactMap[aid] = {
                            code: diagramCode,
                            id: aid,
                            isStreaming: false,
                            operation:
                              toolName === 'diagramWrite'
                                ? 'create'
                                : toolName === 'diagramPatch'
                                  ? 'patch'
                                  : 'update',
                            previousCode: $stateStore.code || '',
                            title: titleStr
                          };
                          artifactMap = { ...artifactMap };
                          parts.push({ type: 'artifact', artifactId: aid });
                          messageParts[assistantIndex] = [...parts];
                        }
                      }
                      inputStateStore.update((s) => ({ ...s, code: diagramCode }));
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
                          const errArtifactId = currentArtifactId || Object.keys(artifactMap).pop();
                          if (errArtifactId && artifactMap[errArtifactId]) {
                            artifactMap[errArtifactId] = {
                              ...artifactMap[errArtifactId],
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
                        inputStateStore.update((s) => ({ ...s, code: output.content }));
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
                        inputStateStore.update((s) => ({ ...s, code: output.content }));
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
                        }

                        const doneLabel: Record<string, string> = {
                          actionItemExtractor: output.actionItems
                            ? `Extracted ${output.actionItems.length} item(s)`
                            : 'Extraction complete',
                          dataAnalyzer: output.summary || 'Analysis complete',
                          errorChecker: !checkerValid
                            ? `Found ${checkerErrors.length} error(s)`
                            : 'No errors found ✓',
                          gitGuard: output.clean
                            ? 'Git safety check passed'
                            : `${output.changedPaths?.length || 0} changed path(s) detected`,
                          longTermMemory: output.message || 'Memory accessed',
                          planWithProgress: output.progress || output.message || 'Plan updated',
                          planner: output.task
                            ? `Plan ready for: ${output.task.slice(0, 50)}${output.task.length > 50 ? '…' : ''}`
                            : 'Plan created',
                          selfCritique: output.summary || 'Review complete',
                          sequentialThinking: output.isComplete
                            ? `Thinking complete (${output.totalThoughts} steps)`
                            : `Thought ${output.thoughtNumber}/${output.totalThoughts}`,
                          subagentAssemble: output.integrationPlan
                            ? `Assembled ${output.integrationPlan.length} agent output(s)`
                            : 'Agent work assembled',
                          subagentFanout: output.assignments
                            ? `Ran ${output.assignments.length} subagent(s)`
                            : 'Subagents spawned',
                          tableAnalytics: output.summary || 'Analysis complete'
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
                    // Clear any pending canvas streaming timer
                    if (streamCanvasTimer) {
                      clearTimeout(streamCanvasTimer);
                      streamCanvasTimer = null;
                    }
                    // Finalize any active reasoning block
                    if (currentReasoningId && reasoningMap[currentReasoningId]) {
                      reasoningMap[currentReasoningId] = {
                        ...reasoningMap[currentReasoningId],
                        isStreaming: false,
                        durationMs: Date.now() - reasoningMap[currentReasoningId].startTime
                      };
                      reasoningMap = { ...reasoningMap };
                      currentReasoningId = null;
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
                    // Finalize any still-streaming questionnaires
                    const doneParts = messageParts[assistantIndex] || [];
                    let qChanged = false;
                    for (let pi = 0; pi < doneParts.length; pi++) {
                      if (
                        doneParts[pi].type === 'questionnaire' &&
                        (doneParts[pi] as ContentPart & { isStreaming?: boolean }).isStreaming
                      ) {
                        doneParts[pi] = { ...doneParts[pi], isStreaming: false } as ContentPart;
                        qChanged = true;
                      }
                    }
                    if (qChanged) messageParts[assistantIndex] = [...doneParts];
                    isLoading = false;
                    scrollToBottom();
                    return;
                  } else if (data.type === 'error') {
                    const parts = messageParts[assistantIndex] || [];
                    parts.push({ type: 'error', error: data.error, userMessage: text });
                    messageParts[assistantIndex] = [...parts];
                    isLoading = false;
                    abortController = null;
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
          isLoading = false;
          abortController = null;
          debouncedSaveChatState();
          return;
        }
        const parts = messageParts[assistantIndex] || [];
        parts.push({ type: 'error', error: err.message, userMessage: text });
        messageParts[assistantIndex] = [...parts];
        isLoading = false;
        abortController = null;
        debouncedSaveChatState();
      })
      .finally(() => {
        // Finalize any active reasoning block
        if (currentReasoningId && reasoningMap[currentReasoningId]) {
          reasoningMap[currentReasoningId] = {
            ...reasoningMap[currentReasoningId],
            isStreaming: false,
            durationMs: Date.now() - reasoningMap[currentReasoningId].startTime
          };
          reasoningMap = { ...reasoningMap };
          currentReasoningId = null;
        }
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
      <!-- Loading State — Data restoring -->
      <div class="flex h-full flex-col items-center justify-center gap-4 px-6 py-8">
        <div class="relative">
          <img src="/brand/logo.png" alt="Graphini" class="size-12 rounded-xl opacity-60" />
        </div>
        <div class="flex items-center gap-2">
          <div
            class="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50"
            style="animation-delay: 0ms">
          </div>
          <div
            class="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50"
            style="animation-delay: 150ms">
          </div>
          <div
            class="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50"
            style="animation-delay: 300ms">
          </div>
        </div>
        <p class="text-[11px] text-muted-foreground/50">Restoring your session...</p>
      </div>
    {:else if !hasMessages}
      <!-- Empty State — Graphini Welcome -->
      <div class="flex h-full flex-col items-center justify-center px-5 py-10">
        <!-- Greeting -->
        <div class="mb-8 text-center">
          <h2 class="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            What will you diagram?
          </h2>
          <p class="mt-2 text-sm text-muted-foreground/70">
            Describe it in plain English — I'll handle the rest.
          </p>
        </div>

        <!-- Suggestion Cards -->
        <div class="grid w-full max-w-lg grid-cols-2 gap-2.5 sm:grid-cols-3">
          {#each suggestions as suggestion (suggestion.label)}
            <button
              type="button"
              onclick={() => {
                handleSubmit({ text: suggestion.prompt });
              }}
              class="group relative flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-3 py-4 text-center transition-colors duration-150 hover:border-foreground/20 hover:bg-accent">
              <suggestion.icon
                class="h-6 w-6 text-foreground/70 transition-colors group-hover:text-foreground" />
              <span class="text-xs font-medium text-foreground/80 group-hover:text-foreground"
                >{suggestion.label}</span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <!-- All Messages -->
      <div class="mx-auto max-w-3xl space-y-5 px-4 py-4 sm:px-6 sm:py-5">
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
                          class="h-[56px] w-[56px] overflow-hidden rounded-xl border border-border">
                          <img
                            src={att.url}
                            alt={att.filename || 'Image'}
                            class="h-full w-full object-cover" />
                        </div>
                      {:else}
                        {@const ext = (att.ext || '?').toLowerCase()}
                        {@const isPdf = ext === 'pdf'}
                        {@const isCode = [
                          'js',
                          'ts',
                          'py',
                          'json',
                          'xml',
                          'yaml',
                          'yml',
                          'csv'
                        ].includes(ext)}
                        {@const extBg = isPdf
                          ? 'bg-destructive/10'
                          : isCode
                            ? 'bg-amber-500/15'
                            : 'bg-muted'}
                        {@const extText = isPdf
                          ? 'text-destructive'
                          : isCode
                            ? 'text-foreground'
                            : 'text-muted-foreground'}
                        {@const iconColor = isPdf
                          ? 'text-destructive'
                          : isCode
                            ? 'text-muted-foreground'
                            : 'text-muted-foreground'}
                        <div
                          class="flex h-[56px] w-[56px] flex-col items-center justify-center gap-0.5 rounded-xl border border-border bg-card"
                          title={att.filename}>
                          <div
                            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md {extBg}">
                            <svg
                              class="h-3.5 w-3.5 {iconColor}"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.5"
                              viewBox="0 0 24 24">
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M7 21h10a2 2 0 002-2V9l-5-5H7a2 2 0 00-2 2v13a2 2 0 002 2zm5-16v4h4" />
                            </svg>
                          </div>
                          <span
                            class="block w-full truncate px-1 text-center text-[7px] leading-tight font-semibold text-foreground/80"
                            >{att.filename || 'File'}</span>
                          <span
                            class="rounded px-0.5 text-[6px] font-bold tracking-wider {extBg} {extText}"
                            >{(att.ext || '?').toUpperCase()}</span>
                        </div>
                      {/if}
                    {/each}
                  </div>
                {/if}
                {#if message.content}
                  <div
                    class="inline-block rounded-2xl rounded-tr-sm bg-muted px-4 py-2.5 text-[13px] leading-relaxed text-foreground">
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
                  {#each messageParts[i] as part, pi (contentPartKey(part, pi))}
                    {#if part.type === 'text' && part.text}
                      <div class="pl-3 text-[13px] leading-relaxed text-foreground/90">
                        <Response content={part.text} />
                      </div>
                    {:else if part.type === 'reasoning' && reasoningMap[part.id] && shouldShowReasoning(reasoningMap[part.id].content)}
                      {@const reasoning = reasoningMap[part.id]}
                      <ReasoningBlock
                        content={reasoning.content}
                        isStreaming={reasoning.isStreaming}
                        durationMs={reasoning.durationMs} />
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
                      {@const isIconifier = part.toolName === 'iconifier'}
                      {@const isSearch = part.toolName === 'webSearch'}
                      {@const isFileManager = part.toolName === 'fileManager'}
                      {@const isDiagramRead = part.toolName === 'diagramRead'}
                      {@const isSubagent =
                        part.toolName === 'subagentFanout' || part.toolName === 'subagentAssemble'}
                      {@const isChecker =
                        part.toolName === 'errorChecker' || part.toolName === 'selfCritique'}
                      {@const isAnalytics = part.toolName === 'tableAnalytics'}
                      {@const toolIconColor = isDiagramRead
                        ? 'bg-blue-500/10 text-blue-500'
                        : isIconifier
                          ? 'bg-violet-500/10 text-violet-500'
                          : part.toolName === 'autoStyler'
                            ? 'bg-pink-500/10 text-pink-500'
                            : isSearch
                              ? 'bg-sky-500/10 text-sky-500'
                              : isFileManager
                                ? 'bg-amber-500/10 text-amber-500'
                                : part.toolName === 'selfCritique'
                                  ? 'bg-rose-500/10 text-rose-500'
                                  : isChecker
                                    ? 'bg-red-500/10 text-red-500'
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
                                                : part.toolName === 'sequentialThinking'
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
                            {:else if part.toolName === 'autoStyler'}
                              <Paintbrush
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
                            {:else if part.toolName === 'sequentialThinking'}
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
                            <span class="font-mono">{part.toolName}</span>
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
                                      <span class="font-medium text-cyan-500">{agent.role}</span>
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
                                        class="mt-1.5 space-y-0.5 border-l border-cyan-500/20 pl-2">
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
                                          class="cursor-pointer text-[10px] font-medium text-cyan-500/90">
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
                                        ? 'text-violet-500'
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
                                      <span class="truncate text-violet-500/70">{icon.iconId}</span>
                                      {#if icon.confidence !== undefined}
                                        <span
                                          class="ml-auto text-[10px] text-violet-500/60 tabular-nums">
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
                                      <span class="ml-1 text-[10px] text-sky-400/60"
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
                  <div class="flex items-center py-2">
                    <span class="thinking-shimmer text-[12px] font-medium text-muted-foreground/60"
                      >Thinking...</span>
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
      class="rounded-xl border border-border bg-background text-foreground transition-colors duration-150 focus-within:border-foreground/30"
      accept="image/*,.pdf,.txt,.md,.json,.xml,.yaml,.yml,.html,.mmd,.mermaid,.svg,.log,.env,.toml,.ini,.cfg,.js,.ts,.py,.java,.c,.cpp,.h,.go,.rs,.rb,.php,.sh,.bat,.sql,.r,.swift,.kt,.csv,.xlsx,.xls"
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
      <!-- Context indicator -->
      {#if selectedContext.type && selectedContext.ids.length > 0}
        <div class="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
          <div class="flex size-4 items-center justify-center rounded-full bg-muted">
            <AtSign class="size-2.5 text-muted-foreground" />
          </div>
          <span class="text-[10px] font-medium text-foreground">
            {selectedContext.ids.length}
            {selectedContext.type}{selectedContext.ids.length > 1 ? 's' : ''} selected
          </span>
          <span class="truncate text-[10px] text-muted-foreground">
            {selectedContext.label ||
              selectedContext.ids.map((id) => svgIdToNodeName(id)).join(', ')}
          </span>
          <button
            type="button"
            class="ml-auto text-[9px] text-muted-foreground/60 transition-colors hover:text-foreground"
            onclick={() => {
              selectedContext = { type: null, label: '', ids: [] };
            }}>
            clear
          </button>
        </div>
      {/if}
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
          placeholder={selectedContext.type
            ? `Ask about selected ${selectedContext.type}s...`
            : 'Describe your diagram...'}
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
            title="Attach files (max 20MB per file)"
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
              if (!open) modelSearchQuery = '';
            }}>
            <Popover.Trigger
              class="flex h-7 max-w-[180px] cursor-pointer items-center gap-1 rounded-full border border-border px-2 text-[10px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground">
              <Zap class="size-2.5 shrink-0" />
              <span class="truncate">
                {selectedModel ? selectedModel.name : 'Model'}
              </span>
              <ChevronsUpDown class="size-2 shrink-0 opacity-40" />
            </Popover.Trigger>
            <Popover.Content
              class="w-[300px] rounded-xl border border-border bg-popover p-0 shadow-[0_4px_16px_var(--dash-card-shadow)]"
              align="start"
              sideOffset={8}>
              <!-- Search -->
              <div class="flex items-center gap-2 px-3 py-2.5">
                <Search class="size-3.5 shrink-0 text-muted-foreground/50" />
                <input
                  type="text"
                  name="model-search"
                  placeholder="Search models..."
                  class="h-5 w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/40"
                  bind:value={modelSearchQuery} />
              </div>
              <div class="h-px bg-border"></div>
              <!-- Model list -->
              <div class="max-h-[300px] overflow-y-auto overscroll-contain py-1">
                {#if modelsStore.isLoading}
                  <div class="flex items-center justify-center py-8">
                    <div class="flex items-center gap-2 text-xs text-muted-foreground">
                      <div
                        class="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground">
                      </div>
                      Loading models...
                    </div>
                  </div>
                {:else if filteredModels.length === 0}
                  <div class="flex flex-col items-center justify-center gap-2 py-8">
                    <Search class="size-5 text-muted-foreground/20" />
                    <span class="text-xs text-muted-foreground/60">No models found</span>
                  </div>
                {:else}
                  {#each groupedModels as [category, categoryModels] (category)}
                    {#if groupedModels.length > 1}
                      <div class="sticky top-0 z-10 bg-popover px-3 pt-2 pb-1">
                        <span
                          class="text-[10px] font-medium tracking-wider text-muted-foreground/50 uppercase"
                          >{category}</span>
                      </div>
                    {/if}
                    {#each categoryModels as model (model.id)}
                      <button
                        type="button"
                        class="group flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/50 {selectedModelId ===
                        model.id
                          ? 'bg-accent/50'
                          : ''}"
                        onclick={() => {
                          modelsStore.select(model.id);
                          modelPopoverOpen = false;
                          modelSearchQuery = '';
                        }}>
                        <div class="flex min-w-0 flex-1 flex-col">
                          <span class="truncate text-[13px] font-medium text-foreground"
                            >{model.name}</span>
                          {#if model.description}
                            <span class="truncate text-[11px] text-muted-foreground/70"
                              >{model.description}</span>
                          {/if}
                        </div>
                        <div class="flex shrink-0 items-center gap-2">
                          <span
                            class="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
                            <Gem class="size-2.5" />
                            {model.gemsPerMessage}
                          </span>
                          {#if selectedModelId === model.id}
                            <Check class="size-3.5 text-foreground" />
                          {/if}
                        </div>
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
            title="{estimatedTokens.toLocaleString()} / {CONTEXT_WINDOW.toLocaleString()} tokens ({contextPercent}% used)">
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
                class="{contextStrokeColor} transition-all duration-500"
                stroke-dasharray="{contextPercent * 0.8796} 87.96"
                transform="rotate(-90 18 18)" />
              <text
                x="18"
                y="19"
                text-anchor="middle"
                dominant-baseline="middle"
                class="fill-current {contextColor} text-[10px] font-bold">{contextPercent}</text>
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
              class="flex size-8 items-center justify-center rounded-full"
              title="Processing files...">
              <div
                class="size-3.5 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-500">
              </div>
            </div>
          {:else if isLoading}
            <button
              type="button"
              onclick={stopStream}
              class="flex size-8 items-center justify-center rounded-full border border-border text-foreground transition-colors duration-150 hover:bg-accent">
              <Square class="size-2.5" fill="currentColor" />
            </button>
          {:else}
            <PromptInputSubmit
              status={chatStatus}
              disabled={!inputText.trim()}
              class="size-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90" />
          {/if}
        </div>
      </PromptInputToolbar>
    </PromptInput>
  </div>
</div>

<style>
  .thinking-shimmer {
    background: linear-gradient(90deg, currentColor 0%, var(--foreground) 40%, currentColor 80%);
    background-size: 200% 100%;
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
</style>
