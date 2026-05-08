/**
 * Search-provider key resolution.
 *
 * Per-user only — each caller stores their own Brave Search key in
 * app_settings (encrypted at rest by the crypto layer; both the
 * 'search_provider' category and the '_api_key' suffix flag sensitive).
 *
 * No env fallback: web search is a per-user feature. If the user hasn't
 * provisioned a key, the tool reports the missing key explicitly so the
 * model can tell the user to add one in settings.
 */

import { getDb } from '$lib/server/db';

const SEARCH_PROVIDER_CATEGORY = 'search_provider';
const BRAVE_SEARCH_KEY = 'brave_search_api_key';

/** Returns the user's Brave Search key, or '' when they haven't set one. */
export async function getBraveSearchKeyFor(userId: string | null): Promise<string> {
  if (!userId) return '';
  try {
    const value = await getDb().kvGet(userId, SEARCH_PROVIDER_CATEGORY, BRAVE_SEARCH_KEY);
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  } catch (err) {
    console.error('[search] failed to read per-user Brave key:', err);
  }
  return '';
}
