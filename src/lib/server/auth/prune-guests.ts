/**
 * Lazy pruning of stale guest user rows.
 *
 * A guest is "stale" once last_seen_at is older than GUEST_INACTIVITY_TTL_MS.
 * Deleting the user row cascades through every FK with onDelete: 'cascade' or
 * sets the FK to null where that's the policy — which wipes their
 * conversations, messages, app_settings, etc. exactly as the spec asks.
 *
 * Pruning is run lazily (not on every request — too expensive). Each run is
 * gated by a 1-hour cooldown stored in the cache so a hot endpoint can call
 * `maybePruneExpiredGuests` freely without DOSing the DB.
 */

import { getCache } from '$lib/server/cache';
import { getDb } from '$lib/server/db';
import { GUEST_INACTIVITY_TTL_MS } from './limits';

const COOLDOWN_KEY = 'guest-prune:last-run';
const COOLDOWN_SECONDS = 60 * 60; // run at most once per hour

export interface PruneResult {
  ran: boolean;
  deleted: number;
}

/** Force-run the prune, ignoring the cooldown. Returns the number of users deleted. */
export async function pruneExpiredGuests(): Promise<number> {
  const cutoff = new Date(Date.now() - GUEST_INACTIVITY_TTL_MS);
  const ids = await getDb().listExpiredGuestUserIds(cutoff);
  if (ids.length === 0) return 0;
  const db = getDb();
  for (const id of ids) {
    try {
      await db.deleteUser(id);
    } catch (err) {
      console.error(`[prune-guests] failed to delete ${id}:`, err);
    }
  }
  return ids.length;
}

/**
 * Run the prune at most once per hour across the deployment. Safe to call
 * from request handlers — does nothing on the hot path. Errors are swallowed
 * so a failed prune never affects the request that triggered it.
 */
export async function maybePruneExpiredGuests(): Promise<PruneResult> {
  try {
    const cache = getCache();
    const last = await cache.get<number>(COOLDOWN_KEY);
    if (typeof last === 'number' && Date.now() - last < COOLDOWN_SECONDS * 1000) {
      return { ran: false, deleted: 0 };
    }
    // Mark the cooldown BEFORE doing the work so a slow run doesn't get
    // re-triggered concurrently by another request.
    await cache.set(COOLDOWN_KEY, Date.now(), { ttlSeconds: COOLDOWN_SECONDS });
    const deleted = await pruneExpiredGuests();
    return { ran: true, deleted };
  } catch (err) {
    console.error('[prune-guests] background prune failed:', err);
    return { ran: false, deleted: 0 };
  }
}
