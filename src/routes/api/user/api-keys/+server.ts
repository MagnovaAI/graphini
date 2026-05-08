/**
 * Per-user API key storage. Available to both logged-in users and guests.
 *
 * Keys are stored as user-scoped rows in `app_settings`. The state-manager's
 * encryption layer (lib/server/crypto) ensures the value lands in the DB as
 * AES-GCM ciphertext; only the holder of APP_SETTINGS_ENCRYPTION_KEY can
 * decrypt. Both `category='ai_provider'` and any key whose name ends in
 * `_api_key` are flagged sensitive automatically.
 *
 *   GET    → list which providers have a key set (presence only, never the key)
 *   PUT    → set/update a provider's key
 *   DELETE → clear a provider's key
 */

import { validateSessionOrGuest } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface ProviderSpec {
  /** Wire name accepted by GET/PUT/DELETE — e.g. "openrouter", "brave_search". */
  id: string;
  /** app_settings row category — used by the encryption rule. */
  category: 'ai_provider' | 'search_provider';
  /** app_settings row key, must end in `_api_key` for the encryption gate. */
  storageKey: string;
}

const PROVIDERS: readonly ProviderSpec[] = [
  { id: 'openrouter', category: 'ai_provider', storageKey: 'openrouter_api_key' },
  { id: 'openai', category: 'ai_provider', storageKey: 'openai_api_key' },
  { id: 'anthropic', category: 'ai_provider', storageKey: 'anthropic_api_key' },
  { id: 'gemini', category: 'ai_provider', storageKey: 'gemini_api_key' },
  { id: 'brave_search', category: 'search_provider', storageKey: 'brave_search_api_key' }
] as const;

const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

function findProvider(id: unknown): ProviderSpec | null {
  if (typeof id !== 'string') return null;
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** GET — return { providers: { openrouter: true, brave_search: false, ... } } */
export const GET: RequestHandler = async ({ request }) => {
  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const result: Record<string, boolean> = {};
  for (const p of PROVIDERS) {
    const value = await db.kvGet(user.id, p.category, p.storageKey);
    result[p.id] = typeof value === 'string' && value.length > 0;
  }

  return json({ providers: result });
};

/** PUT — body: { provider: string, key: string } */
export const PUT: RequestHandler = async ({ request }) => {
  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  let body: { provider?: unknown; key?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid body' }, { status: 400 });
  }

  const provider = findProvider(body.provider);
  if (!provider) {
    return json({ error: `provider must be one of ${PROVIDER_IDS.join(', ')}` }, { status: 400 });
  }
  const key = body.key;
  if (typeof key !== 'string' || key.trim().length < 8) {
    return json({ error: 'key must be a non-empty string of at least 8 characters' }, { status: 400 });
  }

  await getDb().kvSet(user.id, provider.category, provider.storageKey, key.trim());
  return json({ ok: true });
};

/** DELETE ?provider=brave_search — clear a single provider's key */
export const DELETE: RequestHandler = async ({ request, url }) => {
  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const provider = findProvider(url.searchParams.get('provider'));
  if (!provider) {
    return json({ error: `provider must be one of ${PROVIDER_IDS.join(', ')}` }, { status: 400 });
  }

  // Clearing == storing empty string. The encryption layer skips encryption of
  // empty strings, so this row becomes a recognizable "cleared" marker without
  // leaking that it ever held a key.
  await getDb().kvSet(user.id, provider.category, provider.storageKey, '');
  return json({ ok: true });
};
