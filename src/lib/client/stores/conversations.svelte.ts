/**
 * Client-side Conversations Store
 * Manages conversation list, active conversation, and CRUD operations
 */

import { hmrRestore, hmrPreserve } from '$lib/client/util/hmr';

interface ConversationItem {
  id: string;
  title: string | null;
  is_pinned: boolean;
  is_archived: boolean;
  updated_at: string;
  created_at: string;
}

interface ConversationsState {
  list: ConversationItem[];
  activeId: string | null;
  loading: boolean;
  sidebarOpen: boolean;
}

const state = $state<ConversationsState>(
  hmrRestore('conversationsState') ?? {
    list: [],
    activeId: null,
    loading: false,
    sidebarOpen: false
  }
);
hmrPreserve('conversationsState', () => ({ ...state }));

async function fetchConversations(): Promise<void> {
  try {
    state.loading = true;
    const res = await fetch('/api/conversations', { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      state.list = data.conversations || [];
    }
  } catch {
    /* ignore */
  } finally {
    state.loading = false;
  }
}

async function createConversation(title?: string): Promise<ConversationItem | null> {
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || 'New Chat' }),
      credentials: 'include'
    });
    if (res.ok) {
      const data = await res.json();
      const conv = data.conversation;
      state.list = [conv, ...state.list];
      state.activeId = conv.id;
      return conv;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function renameConversation(id: string, title: string): Promise<boolean> {
  const trimmed = title.trim();
  if (!trimmed) return false;
  const idx = state.list.findIndex((c) => c.id === id);
  const prev = idx >= 0 ? state.list[idx].title : null;
  if (prev === trimmed) return true;
  // Optimistic update
  if (idx >= 0) {
    const next = [...state.list];
    next[idx] = { ...next[idx], title: trimmed };
    state.list = next;
  }
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: trimmed }),
      credentials: 'include'
    });
    if (!res.ok) throw new Error('rename failed');
    return true;
  } catch {
    if (idx >= 0) {
      const reverted = [...state.list];
      reverted[idx] = { ...reverted[idx], title: prev };
      state.list = reverted;
    }
    return false;
  }
}

async function deleteConversation(id: string): Promise<boolean> {
  // Optimistic remove so the sidebar updates instantly. Capture enough state
  // to roll back cleanly if the API ends up rejecting the delete.
  const idx = state.list.findIndex((c) => c.id === id);
  if (idx < 0) return false;
  const removed = state.list[idx];
  const prevActiveId = state.activeId;
  state.list = state.list.filter((c) => c.id !== id);
  if (prevActiveId === id) {
    state.activeId = state.list[0]?.id ?? null;
  }
  try {
    const res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (res.ok) return true;
  } catch {
    /* fall through to rollback */
  }
  // Roll back on failure.
  const reverted = [...state.list];
  reverted.splice(idx, 0, removed);
  state.list = reverted;
  state.activeId = prevActiveId;
  return false;
}

function setActive(id: string | null): void {
  state.activeId = id;
}

function toggleSidebar(): void {
  state.sidebarOpen = !state.sidebarOpen;
}

function openSidebar(): void {
  state.sidebarOpen = true;
}

function closeSidebar(): void {
  state.sidebarOpen = false;
}

export const conversationsStore = {
  get activeId() {
    return state.activeId;
  },
  closeSidebar,
  create: createConversation,
  delete: deleteConversation,
  fetch: fetchConversations,
  get isLoading() {
    return state.loading;
  },
  get isSidebarOpen() {
    return state.sidebarOpen;
  },
  get list() {
    return state.list;
  },
  openSidebar,
  rename: renameConversation,
  setActive,
  get state() {
    return state;
  },
  toggleSidebar
};
