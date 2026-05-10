/**
 * Client-side Files store — per-user workspace file tree.
 *
 * Backs `/api/workspace-files`. Holds a flat list of files; UI builds the
 * tree on the fly via buildFileTree(). The store also tracks the currently
 * selected file id and quota usage.
 */

import { hmrRestore, hmrPreserve } from '$lib/client/util/hmr';
import { kv } from '$lib/client/stores/kvStore.svelte';

const ACTIVE_FILE_KV_KEY = 'graphini_files_active_v1';

export type FileKind = 'md' | 'json' | 'yaml' | 'mermaid';

export interface WorkspaceFile {
  id: string;
  path: string;
  kind: FileKind;
  content: string;
  created_at: string;
  updated_at: string;
}

interface FilesState {
  list: WorkspaceFile[];
  activeId: string | null;
  loading: boolean;
  quota: { used: number; total: number };
}

function loadActiveIdFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = kv.get<string>('files', ACTIVE_FILE_KV_KEY);
    return typeof stored === 'string' && stored ? stored : null;
  } catch {
    return null;
  }
}

function persistActiveId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    kv.set('files', ACTIVE_FILE_KV_KEY, id);
  } catch {
    /* silent */
  }
}

const state = $state<FilesState>(
  hmrRestore('filesState') ?? {
    list: [],
    // Restore the previously-active file id from kv so a page refresh keeps
    // the user on the same file. The full row is hydrated by `fetchAll()`
    // a few hundred ms later; until then `activeFile` returns null but the
    // engine resolver in page.svelte already falls back gracefully.
    activeId: loadActiveIdFromStorage(),
    loading: false,
    quota: { used: 0, total: 30 }
  }
);
hmrPreserve('filesState', () => ({ ...state }));

let fetchAllInFlight: Promise<void> | null = null;

async function fetchAll(options: { silent?: boolean } = {}): Promise<void> {
  if (fetchAllInFlight) return fetchAllInFlight;
  const showLoading = options.silent !== true && state.list.length === 0;
  fetchAllInFlight = (async () => {
    try {
      if (showLoading) state.loading = true;
      const res = await fetch('/api/workspace-files', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        state.list = (data.files ?? []) as WorkspaceFile[];
        state.quota = data.quota ?? state.quota;
      }
    } catch {
      /* ignore */
    } finally {
      if (showLoading) state.loading = false;
      fetchAllInFlight = null;
    }
  })();
  return fetchAllInFlight;
}

async function refreshAll(): Promise<void> {
  return fetchAll({ silent: true });
}

async function fetchAllVisible(): Promise<void> {
  return fetchAll({ silent: false });
}

async function create(path?: string, content = ''): Promise<WorkspaceFile | { error: string }> {
  try {
    const body: Record<string, unknown> = { content };
    if (path !== undefined) body.path = path;
    const res = await fetch('/api/workspace-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = data?.error ?? `HTTP ${res.status}`;
      return { error };
    }
    state.list = [...state.list, data as WorkspaceFile].sort((a, b) =>
      a.path.localeCompare(b.path)
    );
    state.quota = { ...state.quota, used: state.quota.used + 1 };
    return data as WorkspaceFile;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to create file' };
  }
}

async function update(
  id: string,
  patch: { path?: string; content?: string }
): Promise<WorkspaceFile | { error: string }> {
  try {
    const res = await fetch(`/api/workspace-files/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(patch)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error ?? `HTTP ${res.status}` };
    state.list = state.list
      .map((f) => (f.id === id ? (data as WorkspaceFile) : f))
      .sort((a, b) => a.path.localeCompare(b.path));
    return data as WorkspaceFile;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Failed to update file' };
  }
}

async function remove(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/workspace-files/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!res.ok) return false;
    state.list = state.list.filter((f) => f.id !== id);
    state.quota = { ...state.quota, used: Math.max(0, state.quota.used - 1) };
    if (state.activeId === id) {
      state.activeId = null;
      persistActiveId(null);
    }
    return true;
  } catch {
    return false;
  }
}

async function moveFolder(from: string, to: string): Promise<{ moved: number; error?: string }> {
  try {
    const res = await fetch('/api/workspace-files/folder-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ from, to })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { moved: 0, error: data?.error ?? `HTTP ${res.status}` };
    await refreshAll();
    return { moved: data.moved ?? 0 };
  } catch (err) {
    return { moved: 0, error: err instanceof Error ? err.message : 'Failed' };
  }
}

async function deleteFolder(path: string): Promise<{ deleted: number; error?: string }> {
  try {
    const res = await fetch('/api/workspace-files/folder-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ path })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { deleted: 0, error: data?.error ?? `HTTP ${res.status}` };
    await refreshAll();
    return { deleted: data.deleted ?? 0 };
  } catch (err) {
    return { deleted: 0, error: err instanceof Error ? err.message : 'Failed' };
  }
}

function setActive(id: string | null) {
  state.activeId = id;
  persistActiveId(id);
}

function getById(id: string): WorkspaceFile | null {
  return state.list.find((f) => f.id === id) ?? null;
}

// ── Tree building ──

export type FileTreeNode =
  | { type: 'folder'; name: string; path: string; children: FileTreeNode[] }
  | { type: 'file'; file: WorkspaceFile };

export function buildFileTree(files: WorkspaceFile[]): FileTreeNode[] {
  // Build a nested map of folders → children. These Maps are local
  // computation helpers, not reactive state — SvelteMap is not needed.
  type FolderMap = Map<string, { folders: Map<string, unknown>; files: WorkspaceFile[] }>;
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const root = { folders: new Map() as FolderMap, files: [] as WorkspaceFile[] };

  for (const file of files) {
    const parts = file.path.split('/');
    const fileName = parts.length > 0 ? parts.pop() : file.path;
    if (!fileName) continue;
    let cursor = root;
    for (const part of parts) {
      let next = cursor.folders.get(part) as
        | { folders: FolderMap; files: WorkspaceFile[] }
        | undefined;
      if (!next) {
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        next = { folders: new Map(), files: [] };
        cursor.folders.set(part, next);
      }
      cursor = next;
    }
    // Reattach the filename so it doesn't get lost.
    cursor.files.push({ ...file, path: file.path });
    void fileName;
  }

  function toNodes(
    node: { folders: Map<string, unknown>; files: WorkspaceFile[] },
    prefix: string
  ): FileTreeNode[] {
    const folders: FileTreeNode[] = [...node.folders.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, sub]) => ({
        type: 'folder',
        name,
        path: prefix ? `${prefix}/${name}` : name,
        children: toNodes(
          sub as { folders: Map<string, unknown>; files: WorkspaceFile[] },
          prefix ? `${prefix}/${name}` : name
        )
      }));
    const fileNodes: FileTreeNode[] = [...node.files]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((file) => ({ type: 'file', file }));
    return [...folders, ...fileNodes];
  }

  return toNodes(root, '');
}

// ── Exported store ──

export const filesStore = {
  get activeFile() {
    return state.activeId ? (state.list.find((f) => f.id === state.activeId) ?? null) : null;
  },
  get activeId() {
    return state.activeId;
  },
  create,
  deleteFolder,
  fetchAll,
  fetchAllVisible,
  getById,
  get list() {
    return state.list;
  },
  get loading() {
    return state.loading;
  },
  moveFolder,
  get quota() {
    return state.quota;
  },
  remove,
  refreshAll,
  setActive,
  update
};
