/**
 * Search-provider key resolution.
 *
 * Per-user only — each caller stores their own keys in app_settings
 * (encrypted at rest by the crypto layer; both the 'search_provider' category
 * and the '_api_key' suffix flag sensitive).
 *
 * No env fallback: web search is a per-user feature. If the user hasn't
 * provisioned any key, the tool reports the missing key explicitly so the
 * model can tell the user to add one in settings.
 */

import { getDb } from '$lib/server/db';

const SEARCH_PROVIDER_CATEGORY = 'search_provider';

export type SearchProvider = 'tavily' | 'brave_search';

const STORAGE_KEY: Record<SearchProvider, string> = {
  tavily: 'tavily_api_key',
  brave_search: 'brave_search_api_key'
};

async function readUserKey(userId: string, provider: SearchProvider): Promise<string> {
  try {
    const value = await getDb().kvGet(userId, SEARCH_PROVIDER_CATEGORY, STORAGE_KEY[provider]);
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  } catch (err) {
    console.error(`[search] failed to read per-user ${provider} key:`, err);
  }
  return '';
}

export interface ResolvedSearchKey {
  provider: SearchProvider;
  apiKey: string;
}

/**
 * Pick which search provider to use for this user. Tavily wins when the user
 * has both — its results are richer (titles + snippets + ranked relevance
 * out of the box). Brave is the fallback. Returns null when the user has
 * neither key.
 */
export async function resolveSearchKeyFor(
  userId: string | null
): Promise<ResolvedSearchKey | null> {
  if (!userId) return null;
  const tavily = await readUserKey(userId, 'tavily');
  if (tavily) return { provider: 'tavily', apiKey: tavily };
  const brave = await readUserKey(userId, 'brave_search');
  if (brave) return { provider: 'brave_search', apiKey: brave };
  return null;
}
