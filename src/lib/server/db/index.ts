/**
 * Database Module - Switchable adapter pattern
 *
 * Usage:
 *   import { getDb } from '$lib/server/db';
 *   const db = getDb();
 *   const user = await db.getUserByEmail('test@example.com');
 */

import { DATABASE_URL } from '$env/static/private';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type { DatabaseAdapter } from './adapter';
import { NeonAdapter } from './neon-adapter';
import type * as schema from './schema';

export type { DatabaseAdapter } from './adapter';
export * from './types';

let dbInstance: DatabaseAdapter | null = null;

/**
 * Get the database adapter singleton.
 * Uses Neon (Drizzle ORM + @neondatabase/serverless).
 */
export function getDb(): DatabaseAdapter {
  if (!dbInstance) {
    if (!DATABASE_URL) {
      throw new Error('Database not configured. Set DATABASE_URL in your environment.');
    }
    dbInstance = new NeonAdapter(DATABASE_URL);
  }
  return dbInstance;
}

/**
 * Return the raw Drizzle handle when the active adapter exposes one.
 * Domain code that needs `drizzle-orm` query builders should go through
 * this helper rather than casting to NeonAdapter, so a non-Neon adapter
 * (e.g. a test mock) falls through cleanly instead of throwing.
 */
export function getDrizzle(): NeonHttpDatabase<typeof schema> | null {
  const adapter = getDb();
  if (adapter instanceof NeonAdapter) return adapter.db;
  return null;
}

/**
 * Reset the DB instance (for testing or hot-swap)
 */
export function resetDb(): void {
  dbInstance = null;
}
