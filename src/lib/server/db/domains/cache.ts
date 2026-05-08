/**
 * Domain helper — Cache & KV Store (App Settings)
 */

import { and, eq, not, sql } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type { CacheEntry } from '../types';
import * as schema from '../schema';

// ── Row Mapper ─────────────────────────────────────────────────────────────

export function mapCacheEntry(row: typeof schema.cacheEntries.$inferSelect): CacheEntry {
  return {
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at?.toISOString() ?? null,
    hit_count: row.hit_count ?? 0,
    key: row.key,
    last_accessed_at: row.last_accessed_at.toISOString(),
    tags: (row.tags as string[]) ?? [],
    value: row.value
  };
}

// ── Cache Operations ───────────────────────────────────────────────────────

export async function cacheGet(
  db: NeonHttpDatabase<typeof schema>,
  key: string
): Promise<CacheEntry | null> {
  const [row] = await db.select().from(schema.cacheEntries).where(eq(schema.cacheEntries.key, key));
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await cacheDelete(db, key);
    return null;
  }
  // Update hit count in background
  db.update(schema.cacheEntries)
    .set({
      hit_count: (row.hit_count ?? 0) + 1,
      last_accessed_at: new Date()
    })
    .where(eq(schema.cacheEntries.key, key))
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .then(() => {});
  return mapCacheEntry(row);
}

export async function cacheSet(
  db: NeonHttpDatabase<typeof schema>,
  key: string,
  value: unknown,
  options?: { ttl_seconds?: number; tags?: string[] }
): Promise<void> {
  const now = new Date();
  const expiresAt = options?.ttl_seconds
    ? new Date(now.getTime() + options.ttl_seconds * 1000)
    : null;

  await db
    .insert(schema.cacheEntries)
    .values({
      expires_at: expiresAt,
      hit_count: 0,
      key,
      last_accessed_at: now,
      tags: options?.tags ?? [],
      value: value as Record<string, unknown>
    })
    .onConflictDoUpdate({
      target: schema.cacheEntries.key,
      set: {
        expires_at: expiresAt,
        hit_count: 0,
        last_accessed_at: now,
        tags: options?.tags ?? [],
        value: value as Record<string, unknown>
      }
    });
}

export async function cacheDelete(
  db: NeonHttpDatabase<typeof schema>,
  key: string
): Promise<boolean> {
  const result = await db
    .delete(schema.cacheEntries)
    .where(eq(schema.cacheEntries.key, key))
    .returning({ key: schema.cacheEntries.key });
  return result.length > 0;
}

export async function cacheDeleteByTag(
  db: NeonHttpDatabase<typeof schema>,
  tag: string
): Promise<number> {
  const result = await db
    .delete(schema.cacheEntries)
    .where(sql`${tag} = ANY(${schema.cacheEntries.tags})`)
    .returning({ key: schema.cacheEntries.key });
  return result.length;
}

export async function cacheClear(db: NeonHttpDatabase<typeof schema>): Promise<void> {
  await db.delete(schema.cacheEntries).where(not(eq(schema.cacheEntries.key, '')));
}

export async function cacheCleanup(db: NeonHttpDatabase<typeof schema>): Promise<number> {
  const result = await db
    .delete(schema.cacheEntries)
    .where(
      and(
        sql`${schema.cacheEntries.expires_at} IS NOT NULL`,
        sql`${schema.cacheEntries.expires_at} < NOW()`
      )
    )
    .returning({ key: schema.cacheEntries.key });
  return result.length;
}

// ── KV Store (App Settings) ────────────────────────────────────────────────

import {
  decryptFromStorage,
  encryptForStorage,
  isSensitiveSetting
} from '$lib/server/crypto';

function unwrapKv(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && '__kv' in raw) {
    return (raw as Record<string, unknown>).__kv;
  }
  return raw;
}

function wrapForStorage(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { __kv: value };
}

export async function kvGet(
  db: NeonHttpDatabase<typeof schema>,
  user_id: string,
  category: string,
  key: string
): Promise<unknown | null> {
  const [row] = await db
    .select()
    .from(schema.appSettings)
    .where(
      and(
        eq(schema.appSettings.user_id, user_id),
        eq(schema.appSettings.category, category),
        eq(schema.appSettings.key, key)
      )
    );
  if (!row) return null;
  const unwrapped = unwrapKv(row.value);
  return decryptFromStorage(category, key, unwrapped);
}

export async function kvSet(
  db: NeonHttpDatabase<typeof schema>,
  user_id: string,
  category: string,
  key: string,
  value: unknown
): Promise<void> {
  const stored = encryptForStorage(category, key, value);
  const jsonbValue = wrapForStorage(stored);

  await db
    .insert(schema.appSettings)
    .values({
      user_id,
      category,
      key,
      is_sensitive: isSensitiveSetting(category, key),
      value: jsonbValue
    })
    .onConflictDoUpdate({
      target: [schema.appSettings.user_id, schema.appSettings.category, schema.appSettings.key],
      set: {
        value: jsonbValue,
        is_sensitive: isSensitiveSetting(category, key),
        updated_at: new Date()
      }
    });
}

export async function kvDelete(
  db: NeonHttpDatabase<typeof schema>,
  user_id: string,
  category: string,
  key: string
): Promise<void> {
  await db
    .delete(schema.appSettings)
    .where(
      and(
        eq(schema.appSettings.user_id, user_id),
        eq(schema.appSettings.category, category),
        eq(schema.appSettings.key, key)
      )
    );
}

export async function kvGetAll(
  db: NeonHttpDatabase<typeof schema>,
  user_id: string,
  category?: string
): Promise<{ category: string; key: string; value: unknown }[]> {
  const conditions = [eq(schema.appSettings.user_id, user_id)];
  if (category) conditions.push(eq(schema.appSettings.category, category));

  const rows = await db
    .select({
      category: schema.appSettings.category,
      key: schema.appSettings.key,
      value: schema.appSettings.value
    })
    .from(schema.appSettings)
    .where(and(...conditions));

  return rows.map((r) => ({
    category: r.category,
    key: r.key,
    value: decryptFromStorage(r.category, r.key, unwrapKv(r.value))
  }));
}

export async function kvSetBatch(
  db: NeonHttpDatabase<typeof schema>,
  user_id: string,
  entries: { category: string; key: string; value: unknown }[]
): Promise<void> {
  if (entries.length === 0) return;
  const validEntries = entries.filter((e) => e.value !== undefined);
  if (validEntries.length === 0) return;

  for (const e of validEntries) {
    await kvSet(db, user_id, e.category, e.key, e.value);
  }
}
