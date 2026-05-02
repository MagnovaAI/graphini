/**
 * Reactive KV Store — Svelte 5 runes replacement for kvStore.ts
 * Uses $state for reactive sync status so UI components can respond to changes.
 * Supabase-backed via /api/kv with localStorage fallback.
 */

const LS_PREFIX = 'kv::';
const LOCAL_ONLY_CATEGORIES = new Set(['chat']);

function cacheKey(category: string, key: string): string {
  return `${category}::${key}`;
}

function shouldSyncToServer(category: string): boolean {
  return !LOCAL_ONLY_CATEGORIES.has(category);
}

function lsSet(ck: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LS_PREFIX + ck, JSON.stringify(value));
  } catch {
    /* quota exceeded */
  }
}

function lsDel(ck: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LS_PREFIX + ck);
  } catch {
    /* ignore */
  }
}

class KvStore {
  // Reactive state — UI can bind to these directly
  initialized = $state(false);
  isAuthenticated = $state(false);
  hasPending = $state(false);
  lastSavedAt = $state<number | null>(null);

  // Internal (non-reactive) state
  private memCache = new Map<string, unknown>();
  private pendingWrites = new Map<string, { category: string; key: string; value: unknown }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        if (this.pendingWrites.size > 0 && this.isAuthenticated) {
          const batch = Array.from(this.pendingWrites.values());
          this.pendingWrites.clear();
          this.hasPending = false;
          navigator.sendBeacon(
            '/api/kv',
            new Blob([JSON.stringify({ batch })], { type: 'application/json' })
          );
        }
      });
    }
  }

  /**
   * Initialize the KV store. Loads localStorage first (instant), then fetches
   * from /api/kv and merges server data on top.
   */
  async init(options: { force?: boolean } = {}): Promise<void> {
    const force = options.force === true;
    if (this.initialized && !force) return;
    if (this.initPromise && !force) return this.initPromise;
    if (this.initPromise && force) await this.initPromise;

    this.initPromise = (async () => {
      // Load localStorage first for instant availability
      this.lsLoadAll();

      try {
        const res = await fetch('/api/kv', { cache: 'no-store', credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const entries = data.entries || [];
          for (const e of entries) {
            const ck = cacheKey(e.category, e.key);
            this.memCache.set(ck, e.value);
            lsSet(ck, e.value);
          }
          this.isAuthenticated = true;
        } else {
          this.isAuthenticated = false;
        }
      } catch {
        // Silently fail — localStorage data is already loaded
      }

      this.initialized = true;
      this.initPromise = null;
    })();

    return this.initPromise;
  }

  /**
   * Get a value from the KV store (sync read from memory cache).
   */
  get<T = unknown>(category: string, key: string): T | null {
    const v = this.memCache.get(cacheKey(category, key));
    return v !== undefined ? (v as T) : null;
  }

  /**
   * Set a value. Updates memCache + localStorage immediately,
   * then schedules a debounced flush to server.
   */
  set(category: string, key: string, value: unknown): void {
    const ck = cacheKey(category, key);
    this.memCache.set(ck, value);
    lsSet(ck, value);
    if (!shouldSyncToServer(category)) return;
    this.pendingWrites.set(ck, { category, key, value });
    this.hasPending = true;
    this.scheduleFlush();
  }

  /**
   * Delete a value from the KV store.
   */
  delete(category: string, key: string): void {
    const ck = cacheKey(category, key);
    this.memCache.delete(ck);
    lsDel(ck);
    this.pendingWrites.delete(ck);
    this.hasPending = this.pendingWrites.size > 0;

    if (!shouldSyncToServer(category)) return;
    if (!this.isAuthenticated) return;

    fetch(`/api/kv?category=${encodeURIComponent(category)}&key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
      credentials: 'include',
      keepalive: true
    }).catch(() => {
      /* silent */
    });
  }

  /**
   * Get all entries for a category.
   */
  getCategory<T = unknown>(category: string): Record<string, T> {
    const result: Record<string, T> = {};
    const prefix = category + '::';
    for (const [k, v] of this.memCache.entries()) {
      if (k.startsWith(prefix)) {
        const key = k.slice(prefix.length);
        result[key] = v as T;
      }
    }
    return result;
  }

  /**
   * Get all entries (for admin/debug).
   */
  getAll(): { category: string; key: string; value: unknown }[] {
    const result: { category: string; key: string; value: unknown }[] = [];
    for (const [k, v] of this.memCache.entries()) {
      const [category, ...rest] = k.split('::');
      result.push({ category, key: rest.join('::'), value: v });
    }
    return result;
  }

  /**
   * Flush all pending writes to server immediately.
   */
  async flush(): Promise<void> {
    if (this.pendingWrites.size === 0) return;
    if (!this.isAuthenticated) {
      this.pendingWrites.clear();
      this.hasPending = false;
      return;
    }

    const batch = Array.from(this.pendingWrites.values()).filter((entry) =>
      shouldSyncToServer(entry.category)
    );
    this.pendingWrites.clear();
    if (batch.length === 0) {
      this.hasPending = false;
      return;
    }

    try {
      await fetch('/api/kv', {
        body: JSON.stringify({ batch }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        method: 'POST'
      });
      this.lastSavedAt = Date.now();
      this.hasPending = false;
    } catch {
      // Re-queue on failure
      for (const entry of batch) {
        this.pendingWrites.set(cacheKey(entry.category, entry.key), entry);
      }
      this.hasPending = this.pendingWrites.size > 0;
    }
  }

  /**
   * Reset the KV store (for logout). Clears all data and state.
   */
  reset(): void {
    // Clear localStorage kv entries
    if (typeof localStorage !== 'undefined') {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    }

    this.memCache.clear();
    this.pendingWrites.clear();

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.initialized = false;
    this.isAuthenticated = false;
    this.hasPending = false;
    this.lastSavedAt = null;
    this.initPromise = null;
  }

  // --- Private helpers ---

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 1500);
  }

  private lsLoadAll(): void {
    if (typeof localStorage === 'undefined') return;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) {
        try {
          const ck = k.slice(LS_PREFIX.length);
          if (!this.memCache.has(ck)) {
            const raw = localStorage.getItem(k);
            if (raw !== null) this.memCache.set(ck, JSON.parse(raw));
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
}

import { hmrRestore, hmrPreserve } from '$lib/util/hmr';

export const kv: KvStore = hmrRestore('kvStore') ?? new KvStore();
hmrPreserve('kvStore', () => kv);
