/**
 * Reactive KV Store — local-only key/value storage with reactive sync flags.
 *
 * Uses Svelte 5 $state for `initialized` and `isAuthenticated` so UI
 * components can bind to those flags directly. Backed by `localStorage`
 * with an in-memory cache for synchronous reads.
 *
 * No server sync. Earlier versions of this store mirrored writes to /api/kv;
 * that endpoint is removed as part of the local-settings revamp. Each user
 * keeps their own settings on their own browser; nothing crosses the wire.
 *
 * Public API (preserved for callers across the client codebase):
 *   - init({ force? })       async; loads localStorage into memCache.
 *   - get(category, key)     sync read from memCache.
 *   - set(category, key, v)  writes to memCache + localStorage.
 *   - delete(category, key)  removes from both.
 *   - getCategory(category)  all entries under one category.
 *   - getAll()               every entry, for debug/export.
 *   - flush()                no-op (kept so callers don't need to change).
 *   - reset()                clears memCache + localStorage entries; runs on logout.
 *
 * `isAuthenticated` is kept as a reactive flag for backward compat with
 * components that gated on it; it's always `true` once init has run.
 */

import { hmrRestore, hmrPreserve } from '$lib/client/util/hmr';

const LS_PREFIX = 'kv::';

function cacheKey(category: string, key: string): string {
  return `${category}::${key}`;
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

// Cheap-then-deep equality. Identical references win immediately; primitives
// compare directly; for everything else we fall back to JSON serialization.
// Used to skip redundant writes — without this, streaming chat parts would
// rewrite the same payload on every tick.
function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

class KvStore {
  initialized = $state(false);
  /**
   * Always true after init in the local-only model — no sign-in is needed
   * to read/write the user's own browser storage. Kept reactive so existing
   * components that gated on it keep working without changes.
   */
  isAuthenticated = $state(false);

  private memCache = new Map<string, unknown>();
  private initPromise: Promise<void> | null = null;

  /**
   * Load localStorage into the in-memory cache. Cheap and synchronous in
   * practice — the async signature is preserved so callers (e.g. Chat.simple
   * `await kv.init(...)`) don't change.
   *
   * `force: true` re-reads localStorage; useful after a logout/login swap if
   * a different tab cleared the prefix while we were idle.
   */
  async init(options: { force?: boolean } = {}): Promise<void> {
    const force = options.force === true;
    if (this.initialized && !force) return;
    if (this.initPromise && !force) return this.initPromise;

    this.initPromise = (async () => {
      if (force) this.memCache.clear();
      this.lsLoadAll();
      this.initialized = true;
      this.isAuthenticated = true;
      this.initPromise = null;
    })();

    return this.initPromise;
  }

  /** Sync read from the in-memory cache. */
  get<T = unknown>(category: string, key: string): T | null {
    if (!this.initialized) {
      this.lsLoadAll();
      this.initialized = true;
      this.isAuthenticated = true;
    }
    const v = this.memCache.get(cacheKey(category, key));
    return v !== undefined ? (v as T) : null;
  }

  /**
   * Write to memCache + localStorage. Skips when the new value matches the
   * cached one — without this, streaming chat parts would rewrite the same
   * (large) payload on every tick.
   */
  set(category: string, key: string, value: unknown): void {
    const ck = cacheKey(category, key);
    if (this.memCache.has(ck) && shallowEqual(this.memCache.get(ck), value)) return;
    this.memCache.set(ck, value);
    lsSet(ck, value);
  }

  delete(category: string, key: string): void {
    const ck = cacheKey(category, key);
    this.memCache.delete(ck);
    lsDel(ck);
  }

  /** Every entry under one category, returned as a plain object. */
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

  /** Every entry, for debug/export. */
  getAll(): { category: string; key: string; value: unknown }[] {
    const result: { category: string; key: string; value: unknown }[] = [];
    for (const [k, v] of this.memCache.entries()) {
      const [category, ...rest] = k.split('::');
      result.push({ category, key: rest.join('::'), value: v });
    }
    return result;
  }

  /**
   * No-op in the local-only model. Kept so existing callers
   * (`await kv.flush()`, `kv.flush()`) don't break.
   */
  async flush(): Promise<void> {
    // No server queue to flush — writes are synchronous to localStorage.
  }

  /**
   * Wipe every kv entry (memory + localStorage). Called on logout so the
   * next user landing on this browser starts fresh.
   */
  reset(): void {
    if (typeof localStorage !== 'undefined') {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    }

    this.memCache.clear();
    this.initialized = false;
    this.isAuthenticated = false;
    this.initPromise = null;
  }

  // --- Private helpers ---

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
          /* corrupt entry — skip */
        }
      }
    }
  }
}

export const kv: KvStore = hmrRestore('kvStore') ?? new KvStore();
hmrPreserve('kvStore', () => kv);
