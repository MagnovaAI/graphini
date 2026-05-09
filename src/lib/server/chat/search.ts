/**
 * Search-provider key resolution.
 *
 * Pure: keys come in via the same per-request `ProviderKeys` bag the chat
 * resolver uses. No DB lookup, no env fallback. If the user hasn't supplied
 * a Tavily or Brave key, the caller surfaces a "missing_search_key" error
 * back to the model so the model tells the user to add one in Settings.
 */

import type { ProviderKeys } from '$lib/server/auth/provider-keys';

export type SearchProvider = 'tavily' | 'brave_search';

export interface ResolvedSearchKey {
  provider: SearchProvider;
  apiKey: string;
}

/**
 * Pick which search provider to use given the request's keys. Tavily wins
 * when the user has both — its results are richer (titles + snippets +
 * ranked relevance). Brave is the fallback. Returns null when the user has
 * neither key.
 */
export function resolveSearchKey(keys: ProviderKeys): ResolvedSearchKey | null {
  if (keys.tavily) return { apiKey: keys.tavily, provider: 'tavily' };
  if (keys.braveSearch) return { apiKey: keys.braveSearch, provider: 'brave_search' };
  return null;
}
