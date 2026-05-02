/**
 * Workspace Store
 * Manages the current diagram workspace — loading, saving, and auto-save.
 * Coordinates state between canvas, code editor, chat, and document stores.
 */

import type {
  DiagramEngine,
  DiagramWorkspace,
  DiagramWorkspaceSummary,
  WorkspaceDiagram,
  WorkspaceDocument
} from '$lib/types/workspace';
import { DEFAULT_WORKSPACE_DOCUMENT } from '$lib/types/workspace';
import { documentMarkdownStore } from '$lib/stores/documentStore.svelte';
import { get } from 'svelte/store';
import { inputStateStore } from '$lib/util/state/state';
import { hmrRestore, hmrPreserve } from '$lib/util/hmr';

// ── State ──────────────────────────────────────────────────────────────────

interface WorkspaceState {
  workspace: DiagramWorkspace | null;
  loading: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  dirty: boolean;
  error: string | null;
}

const state = $state<WorkspaceState>(
  hmrRestore('workspaceState') ?? {
    dirty: false,
    error: null,
    lastSavedAt: null,
    loading: false,
    saving: false,
    workspace: null
  }
);
hmrPreserve('workspaceState', () => ({ ...state }));

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 5000;

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_CANVAS: WorkspaceDocument['canvas'] = {
  connections: [],
  elements: [],
  gridEnabled: true,
  gridSize: 20,
  snapToGrid: true,
  viewport: { x: 0, y: 0, zoom: 1 }
};

function createDiagram(
  title: string,
  engine: DiagramEngine,
  seed?: Partial<WorkspaceDiagram>
): WorkspaceDiagram {
  const now = new Date().toISOString();
  return {
    canvas: seed?.canvas ?? DEFAULT_CANVAS,
    chat: seed?.chat ?? { messages: [] },
    createdAt: seed?.createdAt ?? now,
    documentMarkdown: seed?.documentMarkdown ?? '',
    engine,
    files: seed?.files ?? {},
    id: seed?.id ?? crypto.randomUUID(),
    mermaidCode: seed?.mermaidCode ?? '',
    title,
    updatedAt: now
  };
}

function uniqueDiagramTitle(
  title: string,
  diagrams: Pick<WorkspaceDiagram, 'id' | 'title'>[],
  excludeId?: string
): string {
  const baseTitle = title.trim() || 'Untitled';
  const used = new Set(
    diagrams
      .filter((diagram) => diagram.id !== excludeId)
      .map((diagram) => diagram.title.trim().toLowerCase())
  );
  if (!used.has(baseTitle.toLowerCase())) return baseTitle;

  let suffix = 2;
  let candidate = `${baseTitle} ${suffix}`;
  while (used.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${baseTitle} ${suffix}`;
  }
  return candidate;
}

function normalizeDiagramTitles(diagrams: WorkspaceDiagram[]): WorkspaceDiagram[] {
  const seen: WorkspaceDiagram[] = [];
  return diagrams.map((diagram) => {
    const title = uniqueDiagramTitle(diagram.title, seen);
    const nextDiagram = title === diagram.title ? diagram : { ...diagram, title };
    seen.push(nextDiagram);
    return nextDiagram;
  });
}

function normalizeDocument(document?: WorkspaceDocument): WorkspaceDocument {
  const base = document ?? DEFAULT_WORKSPACE_DOCUMENT;
  const diagrams = normalizeDiagramTitles(
    base.diagrams && base.diagrams.length > 0
      ? base.diagrams
      : [
          createDiagram(
            base.engine === 'mermaid'
              ? 'Untitled Mermaid'
              : `Untitled ${base.engine.toUpperCase()}`,
            base.engine,
            {
              canvas: base.canvas ?? DEFAULT_CANVAS,
              chat: base.chat ?? { messages: [] },
              documentMarkdown: base.documentMarkdown ?? '',
              files: base.files ?? {},
              mermaidCode: base.mermaidCode ?? ''
            }
          )
        ]
  );
  const activeDiagramId =
    diagrams.find((diagram) => diagram.id === base.activeDiagramId)?.id ?? diagrams[0]?.id;
  const activeDiagram = diagrams.find((diagram) => diagram.id === activeDiagramId) ?? diagrams[0];

  return {
    ...base,
    activeDiagramId,
    canvas: activeDiagram?.canvas ?? DEFAULT_CANVAS,
    chat: activeDiagram?.chat ?? { messages: [] },
    diagrams,
    documentMarkdown: activeDiagram?.documentMarkdown ?? '',
    engine: activeDiagram?.engine ?? base.engine,
    files: activeDiagram?.files ?? {},
    mermaidCode: activeDiagram?.mermaidCode ?? '',
    version: Math.max(base.version ?? 1, 2)
  };
}

function getActiveDiagram(document = state.workspace?.document): WorkspaceDiagram | null {
  const diagrams = document?.diagrams ?? [];
  return (
    diagrams.find((diagram) => diagram.id === document?.activeDiagramId) ?? diagrams[0] ?? null
  );
}

function collectDocument(): WorkspaceDocument {
  const mermaidState = get(inputStateStore);
  const docMarkdown = documentMarkdownStore.value;
  const existingDoc = normalizeDocument(state.workspace?.document);
  const activeDiagram = getActiveDiagram(existingDoc);
  const engine = activeDiagram?.engine ?? existingDoc.engine ?? 'mermaid';
  const activeDiagramId = activeDiagram?.id ?? existingDoc.activeDiagramId;
  const updatedActiveDiagram = activeDiagram
    ? {
        ...activeDiagram,
        documentMarkdown: docMarkdown || '',
        files: activeDiagram.files ?? {},
        mermaidCode: mermaidState?.code || '',
        updatedAt: new Date().toISOString()
      }
    : null;
  const diagrams = updatedActiveDiagram
    ? existingDoc.diagrams?.map((diagram) =>
        diagram.id === updatedActiveDiagram.id ? updatedActiveDiagram : diagram
      )
    : existingDoc.diagrams;

  return {
    activeDiagramId,
    canvas: updatedActiveDiagram?.canvas ?? existingDoc.canvas ?? DEFAULT_CANVAS,
    chat: updatedActiveDiagram?.chat ?? existingDoc.chat ?? { messages: [] },
    diagrams,
    documentMarkdown: docMarkdown || '',
    engine,
    files: updatedActiveDiagram?.files ?? existingDoc.files ?? {},
    mermaidCode: mermaidState?.code || '',
    version: 2
  };
}

function detectDiagramType(code: string): string | null {
  if (!code) return null;
  const first = code
    .trim()
    .split(/[\s\n]/)[0]
    ?.toLowerCase();
  const types: Record<string, string> = {
    class: 'class',
    classDiagram: 'class',
    erdiagram: 'erd',
    flowchart: 'flowchart',
    gantt: 'gantt',
    gitgraph: 'gitgraph',
    graph: 'flowchart',
    mindmap: 'mindmap',
    pie: 'pie',
    sequence: 'sequence',
    sequencediagram: 'sequence',
    state: 'state',
    statediagram: 'state',
    timeline: 'timeline'
  };
  return types[first || ''] || null;
}

// ── Core Methods ───────────────────────────────────────────────────────────

async function load(id: string): Promise<boolean> {
  state.loading = true;
  state.error = null;

  // Clear stale diagram from localStorage-persisted store immediately
  // so the canvas doesn't flash old content while the workspace loads
  inputStateStore.update((s) => ({ ...s, code: '' }));

  try {
    const res = await fetch(`/api/workspaces/${id}`, { credentials: 'include' });
    if (!res.ok) {
      state.error = res.status === 404 ? 'Workspace not found' : 'Failed to load workspace';
      state.loading = false;
      return false;
    }

    const workspace: DiagramWorkspace = await res.json();
    const doc = normalizeDocument(workspace.document || DEFAULT_WORKSPACE_DOCUMENT);
    state.workspace = { ...workspace, document: doc };
    state.dirty = false;
    state.lastSavedAt = Date.now();

    // Hydrate sub-stores
    documentMarkdownStore.set(doc.documentMarkdown || '');
    inputStateStore.update((s) => ({
      ...s,
      code: doc.mermaidCode || '',
      editorMode: 'code',
      updateDiagram: doc.engine === 'mermaid'
    }));

    state.loading = false;
    return true;
  } catch {
    state.error = 'Failed to load workspace';
    state.loading = false;
    return false;
  }
}

async function save(): Promise<boolean> {
  if (!state.workspace) return false;
  if (state.saving) return false;

  state.saving = true;
  try {
    const document = collectDocument();
    const elementCount = document.canvas.elements.length;
    const diagramType = detectDiagramType(document.mermaidCode);

    const res = await fetch(`/api/workspaces/${state.workspace.id}/document`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ document, element_count: elementCount, diagram_type: diagramType })
    });

    if (res.ok) {
      state.dirty = false;
      state.lastSavedAt = Date.now();
      // Update local workspace copy
      state.workspace = {
        ...state.workspace,
        diagram_type: diagramType,
        document,
        element_count: elementCount,
        updated_at: new Date().toISOString()
      };
      state.saving = false;
      return true;
    }

    state.saving = false;
    return false;
  } catch {
    state.saving = false;
    return false;
  }
}

function markDirty() {
  if (!state.workspace) return;
  state.dirty = true;
  debouncedSave();
}

function debouncedSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(), SAVE_DEBOUNCE_MS);
}

function addChatMessage(message: {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model_used?: string;
}) {
  if (!state.workspace?.document) return;

  const document = collectDocument();
  const activeDiagram = getActiveDiagram(document);
  if (!activeDiagram) return;
  const chatMessages = [...(activeDiagram.chat?.messages || [])];
  chatMessages.push({
    ...message,
    timestamp: new Date().toISOString()
  });

  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      chat: {
        ...activeDiagram.chat,
        messages: chatMessages
      },
      diagrams: document.diagrams?.map((diagram) =>
        diagram.id === activeDiagram.id
          ? { ...diagram, chat: { ...diagram.chat, messages: chatMessages } }
          : diagram
      )
    }
  };
  markDirty();
}

function setActiveDiagramChatMessages(messages: WorkspaceDocument['chat']['messages']) {
  if (!state.workspace) return;
  const document = collectDocument();
  const activeDiagram = getActiveDiagram(document);
  if (!activeDiagram) return;
  setDiagramChatMessages(activeDiagram.id, messages);
}

function setDiagramChatMessages(
  diagramId: string,
  messages: WorkspaceDocument['chat']['messages']
) {
  if (!state.workspace) return;
  const document = collectDocument();
  const diagram = document.diagrams?.find((item) => item.id === diagramId);
  if (!diagram) return;
  const chat = { ...diagram.chat, messages };
  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      chat: document.activeDiagramId === diagramId ? chat : document.chat,
      diagrams: document.diagrams?.map((diagram) =>
        diagram.id === diagramId ? { ...diagram, chat } : diagram
      )
    }
  };
  markDirty();
}

function setActiveDiagramDocumentMarkdown(markdown: string) {
  if (!state.workspace) return;
  const document = collectDocument();
  const activeDiagram = getActiveDiagram(document);
  if (!activeDiagram) return;
  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      documentMarkdown: markdown,
      diagrams: document.diagrams?.map((diagram) =>
        diagram.id === activeDiagram.id
          ? { ...diagram, documentMarkdown: markdown, updatedAt: new Date().toISOString() }
          : diagram
      )
    }
  };
  markDirty();
}

function hydrateActiveDiagram() {
  const document = normalizeDocument(state.workspace?.document);
  const activeDiagram = getActiveDiagram(document);
  if (!activeDiagram || !state.workspace) return;
  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      canvas: activeDiagram.canvas,
      chat: activeDiagram.chat,
      documentMarkdown: activeDiagram.documentMarkdown,
      engine: activeDiagram.engine,
      files: activeDiagram.files,
      mermaidCode: activeDiagram.mermaidCode
    }
  };
  documentMarkdownStore.set(activeDiagram.documentMarkdown || '');
  inputStateStore.update((s) => ({
    ...s,
    code: activeDiagram.mermaidCode || '',
    editorMode: 'code',
    updateDiagram: activeDiagram.engine === 'mermaid'
  }));
}

function getDefaultSource(engine: DiagramEngine) {
  if (engine === 'markdown')
    return `# Untitled Markdown

Write notes, specs, and docs here.
`;

  if (engine === 'json')
    return JSON.stringify(
      {
        author: {
          username: 'authoruser',
          email: 'author@example.com'
        },
        content: 'This is the content of the blog post...',
        publishedDate: '2023-08-25T15:00:00Z',
        tags: ['Technology', 'Programming'],
        title: 'New Blog Post'
      },
      null,
      2
    );
  if (engine === 'yaml')
    return `title: New Blog Post
content: This is the content of the blog post...
publishedDate: 2023-08-25T15:00:00Z
author:
  username: authoruser
  email: author@example.com
tags:
  - Technology
  - Programming
`;
  return 'flowchart TD\n    A[Start] --> B[New diagram]\n';
}

function addDiagram(engine: DiagramEngine, title: string) {
  if (!state.workspace) return null;
  const document = collectDocument();
  const diagramTitle = uniqueDiagramTitle(title, document.diagrams ?? []);
  const diagram = createDiagram(diagramTitle, engine, {
    files: {},
    mermaidCode: getDefaultSource(engine)
  });
  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      activeDiagramId: diagram.id,
      diagrams: [...(document.diagrams ?? []), diagram]
    }
  };
  hydrateActiveDiagram();
  markDirty();
  return diagram;
}

function switchDiagram(id: string) {
  if (!state.workspace) return;
  const document = collectDocument();
  if (!document.diagrams?.some((diagram) => diagram.id === id)) return;
  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      activeDiagramId: id
    }
  };
  hydrateActiveDiagram();
  markDirty();
}

function renameDiagram(id: string, title: string) {
  if (!state.workspace || !title.trim()) return;
  const document = collectDocument();
  const nextTitle = uniqueDiagramTitle(title, document.diagrams ?? [], id);
  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      diagrams: document.diagrams?.map((diagram) =>
        diagram.id === id
          ? { ...diagram, title: nextTitle, updatedAt: new Date().toISOString() }
          : diagram
      )
    }
  };
  hydrateActiveDiagram();
  markDirty();
}

function closeDiagram(id: string) {
  if (!state.workspace) return;
  const document = collectDocument();
  const diagrams = document.diagrams ?? [];
  if (diagrams.length <= 1) return;
  const index = diagrams.findIndex((diagram) => diagram.id === id);
  if (index === -1) return;
  const remaining = diagrams.filter((diagram) => diagram.id !== id);
  const nextActiveId =
    document.activeDiagramId === id
      ? remaining[Math.max(0, Math.min(index, remaining.length - 1))]?.id
      : document.activeDiagramId;
  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      activeDiagramId: nextActiveId,
      diagrams: remaining
    }
  };
  hydrateActiveDiagram();
  markDirty();
}

function updateFile(filename: string, content: string) {
  if (!state.workspace?.document) return;
  const document = collectDocument();
  const activeDiagram = getActiveDiagram(document);
  const files = {
    ...(activeDiagram?.files ?? document.files),
    [filename]: content
  };
  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      files,
      diagrams: document.diagrams?.map((diagram) =>
        diagram.id === activeDiagram?.id ? { ...diagram, files } : diagram
      )
    }
  };
  markDirty();
}

function deleteFile(filename: string) {
  if (!state.workspace?.document) return;
  const document = collectDocument();
  const activeDiagram = getActiveDiagram(document);
  const files = { ...(activeDiagram?.files ?? document.files) };
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete files[filename];
  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      files,
      diagrams: document.diagrams?.map((diagram) =>
        diagram.id === activeDiagram?.id ? { ...diagram, files } : diagram
      )
    }
  };
  markDirty();
}

function renameFile(oldName: string, newName: string) {
  if (!state.workspace?.document) return;
  const document = collectDocument();
  const activeDiagram = getActiveDiagram(document);
  const files = { ...(activeDiagram?.files ?? document.files) };
  if (!(oldName in files)) return;
  files[newName] = files[oldName];
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete files[oldName];
  state.workspace = {
    ...state.workspace,
    document: {
      ...document,
      files,
      diagrams: document.diagrams?.map((diagram) =>
        diagram.id === activeDiagram?.id ? { ...diagram, files } : diagram
      )
    }
  };
  markDirty();
}

async function updateMeta(
  updates: Partial<Pick<DiagramWorkspace, 'title' | 'description' | 'is_starred' | 'tags'>>
): Promise<boolean> {
  if (!state.workspace) return false;

  try {
    const res = await fetch(`/api/workspaces/${state.workspace.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(updates)
    });

    if (res.ok) {
      const updated = await res.json();
      state.workspace = { ...state.workspace, ...updated };
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function unload() {
  // Flush pending save
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (state.dirty && state.workspace) {
    // Best-effort save via sendBeacon
    const document = collectDocument();
    const payload = JSON.stringify({
      document,
      element_count: document.canvas.elements.length,
      diagram_type: detectDiagramType(document.mermaidCode)
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(
        `/api/workspaces/${state.workspace.id}/document`,
        new Blob([payload], { type: 'application/json' })
      );
    }
  }
  state.workspace = null;
  state.dirty = false;
  state.error = null;
}

// ── Dashboard Helpers ──────────────────────────────────────────────────────

async function createWorkspace(
  title?: string,
  engine: DiagramEngine = 'mermaid'
): Promise<DiagramWorkspace | null> {
  state.error = null;
  try {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title: title || 'Untitled Workspace', engine })
    });
    const data = await res.json().catch(() => null);
    if (res.ok) return data as DiagramWorkspace;
    state.error = data?.error || 'Failed to create workspace';
    return null;
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Failed to create workspace';
    return null;
  }
}

async function deleteWorkspace(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/workspaces/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function duplicateWorkspace(id: string, title?: string): Promise<DiagramWorkspace | null> {
  try {
    const res = await fetch(`/api/workspaces/${id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title })
    });
    if (res.ok) return res.json();
    return null;
  } catch {
    return null;
  }
}

async function toggleStar(id: string, starred: boolean): Promise<boolean> {
  try {
    const res = await fetch(`/api/workspaces/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ is_starred: starred })
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function listWorkspaces(options?: {
  limit?: number;
  offset?: number;
  starred?: boolean;
  search?: string;
}): Promise<{ workspaces: DiagramWorkspaceSummary[]; total: number }> {
  try {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- not reactive, just building a URL
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    if (options?.starred) params.set('starred', 'true');
    if (options?.search) params.set('search', options.search);

    const res = await fetch(`/api/workspaces?${params}`, { credentials: 'include' });
    if (res.ok) return res.json();
    return { workspaces: [], total: 0 };
  } catch {
    return { workspaces: [], total: 0 };
  }
}

// ── Exported Store ─────────────────────────────────────────────────────────

export const workspaceStore = {
  get activeDiagramId() {
    return state.workspace?.document?.activeDiagramId ?? null;
  },
  addChatMessage,
  addDiagram,
  closeDiagram,

  // Dashboard operations
  create: createWorkspace,
  delete: deleteWorkspace,
  deleteFile,
  get diagrams() {
    return state.workspace?.document?.diagrams ?? [];
  },
  duplicate: duplicateWorkspace,

  get error() {
    return state.error;
  },
  get isActive() {
    return !!state.workspace;
  },
  get isDirty() {
    return state.dirty;
  },
  get isLoading() {
    return state.loading;
  },
  get isSaving() {
    return state.saving;
  },
  list: listWorkspaces,
  load,
  markDirty,
  renameDiagram,
  renameFile,
  save,
  setActiveDiagramChatMessages,
  setDiagramChatMessages,
  setActiveDiagramDocumentMarkdown,
  get state() {
    return state;
  },
  switchDiagram,
  toggleStar,
  unload,
  updateFile,
  updateMeta,
  get workspace() {
    return state.workspace;
  }
};
