/**
 * Scalable Cache Layer
 * L1: In-memory LRU cache (fast, per-instance)
 * L2: DB-backed persistent cache (shared across instances)
 *
 * Designed to be swappable - replace L2 with Redis, Memcached, etc.
 */

import { getDb } from '$lib/server/db';
import { redisCache } from './redis';

// ============================================================================
// L1: In-Memory LRU Cache
// ============================================================================

interface L1Entry<T = unknown> {
  value: T;
  tags: string[];
  expiresAt: number | null; // timestamp ms
  hitCount: number;
  lastAccess: number;
}

class L1Cache {
  private store = new Map<string, L1Entry>();
  private maxSize: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private stats = { hits: 0, misses: 0 };

  constructor(maxSize = 10000) {
    this.maxSize = maxSize;
    this.cleanupTimer = setInterval(() => this.evictExpired(), 60_000);
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.stats.misses++;
      return null;
    }
    entry.hitCount++;
    entry.lastAccess = Date.now();
    this.stats.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number, tags: string[] = []): void {
    if (this.store.size >= this.maxSize) this.evictLRU();
    this.store.set(key, {
      value,
      tags,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
      hitCount: 0,
      lastAccess: Date.now()
    });
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  deleteByTag(tag: string): number {
    let count = 0;
    for (const [k, v] of this.store) {
      if (v.tags.includes(tag)) {
        this.store.delete(k);
        count++;
      }
    }
    return count;
  }

  has(key: string): boolean {
    const e = this.store.get(key);
    if (!e) return false;
    if (e.expiresAt && e.expiresAt < Date.now()) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.store.clear();
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      entries: this.store.size,
      hitRate: total > 0 ? this.stats.hits / total : 0
    };
  }

  /**
   * Evict every entry whose TTL has passed. Returns the number of rows
   * removed so callers can report a "cleaned" count without wiping live
   * entries.
   */
  evictExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [k, v] of this.store) {
      if (v.expiresAt && v.expiresAt < now) {
        this.store.delete(k);
        removed++;
      }
    }
    return removed;
  }

  private evictLRU(): void {
    if (this.store.size < this.maxSize) return;
    const sorted = [...this.store.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess);
    const toRemove = Math.ceil(this.maxSize * 0.1);
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      this.store.delete(sorted[i][0]);
    }
  }

  destroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.store.clear();
  }
}

// ============================================================================
// Unified Cache Service
// ============================================================================

export interface CacheOptions {
  ttlSeconds?: number;
  tags?: string[];
  persist?: boolean; // Write-through to L2
}

export class CacheService {
  private l1: L1Cache;
  private defaultTTL: number;

  constructor(opts?: { maxEntries?: number; defaultTTLSeconds?: number }) {
    this.l1 = new L1Cache(opts?.maxEntries || 10_000);
    this.defaultTTL = opts?.defaultTTLSeconds || 3600;
  }

  /** Get from L1, fallback to L2 (Redis → DB) */
  async get<T>(key: string): Promise<T | null> {
    // L1
    const l1Val = this.l1.get<T>(key);
    if (l1Val !== null) return l1Val;

    // L2: Try Redis first
    if (redisCache.isAvailable()) {
      try {
        const redisVal = await redisCache.get<T>(key);
        if (redisVal !== null) {
          this.l1.set(key, redisVal, this.defaultTTL * 1000);
          return redisVal;
        }
      } catch {
        /* Redis failed, try DB */
      }
    }

    // L2: Fallback to DB
    try {
      const db = getDb();
      const entry = await db.cacheGet(key);
      if (entry) {
        // Warm L1 + Redis
        this.l1.set(key, entry.value, this.defaultTTL * 1000, entry.tags);
        if (redisCache.isAvailable()) {
          redisCache.set(key, entry.value, this.defaultTTL).catch(() => {});
        }
        return entry.value as T;
      }
    } catch {
      /* DB not available, L1 only */
    }

    return null;
  }

  /** Set in L1, optionally persist to L2 (Redis + DB) */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    const ttl = options?.ttlSeconds || this.defaultTTL;
    const tags = options?.tags || [];
    this.l1.set(key, value, ttl * 1000, tags);

    // Always write to Redis if available
    if (redisCache.isAvailable()) {
      redisCache.set(key, value, ttl).catch(() => {});
    }

    if (options?.persist) {
      try {
        const db = getDb();
        await db.cacheSet(key, value, { ttl_seconds: ttl, tags });
      } catch {
        /* silently fail L2 */
      }
    }
  }

  /** Delete from all layers */
  async delete(key: string): Promise<boolean> {
    const l1 = this.l1.delete(key);
    if (redisCache.isAvailable()) {
      redisCache.delete(key).catch(() => {});
    }
    try {
      const db = getDb();
      const l2 = await db.cacheDelete(key);
      return l1 || l2;
    } catch {
      return l1;
    }
  }

  /** Delete by tag from all layers */
  async deleteByTag(tag: string): Promise<number> {
    const l1Count = this.l1.deleteByTag(tag);
    if (redisCache.isAvailable()) {
      redisCache.deleteByPattern(`*${tag}*`).catch(() => {});
    }
    try {
      const db = getDb();
      const l2Count = await db.cacheDeleteByTag(tag);
      return l1Count + l2Count;
    } catch {
      return l1Count;
    }
  }

  /** Check L1 only (fast) */
  has(key: string): boolean {
    return this.l1.has(key);
  }

  /** Clear all */
  async clear(): Promise<void> {
    this.l1.clear();
    try {
      const db = getDb();
      await db.cacheClear();
    } catch {}
  }

  /** Get or compute + cache */
  async getOrSet<T>(key: string, factory: () => Promise<T>, options?: CacheOptions): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.set(key, value, options);
    return value;
  }

  getStats() {
    return this.l1.getStats();
  }

  /** Cleanup expired entries by re-checking all keys */
  async cleanup(): Promise<{ cleared: number }> {
    const cleared = this.l1.evictExpired();
    return { cleared };
  }

  destroy(): void {
    this.l1.destroy();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: CacheService | null = null;

export function getCache(): CacheService {
  if (!instance) instance = new CacheService();
  return instance;
}

// ============================================================================
// Helper key builders
// ============================================================================

export function cacheKey(...parts: (string | number | undefined | null)[]): string {
  return parts.filter(Boolean).join(':');
}

export const conversationCacheKeys = {
  conversation: (id: string) => cacheKey('conv', id),
  messages: (id: string) => cacheKey('conv', id, 'msgs'),
  list: (userId: string) => cacheKey('conv', 'list', userId)
};

export const userCacheKeys = {
  user: (id: string) => cacheKey('user', id),
  credits: (id: string) => cacheKey('user', id, 'credits'),
  session: (token: string) => cacheKey('session', token)
};

export const modelCacheKeys = {
  pricing: (modelId: string) => cacheKey('model', 'pricing', modelId),
  allPricing: () => cacheKey('model', 'pricing', 'all')
};
