/**
 * Per-user API key storage. Available to both logged-in users and guests.
 *
 * Keys are stored as user-scoped rows in `app_settings` under the `ai_provider`
 * category. The state-manager's encryption layer (lib/server/crypto) ensures
 * the value lands in the DB as AES-GCM ciphertext; only the holder of
 * APP_SETTINGS_ENCRYPTION_KEY can decrypt.
 *
 *   GET    → list which providers have a key set (presence only, never the key)
 *   PUT    → set/update a provider's key
 *   DELETE → clear a provider's key
 */

import { validateSessionOrGuest } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const CATEGORY = 'ai_provider';

const SUPPORTED_PROVIDERS = ['openrouter', 'openai', 'anthropic', 'gemini'] as const;
type Provider = (typeof SUPPORTED_PROVIDERS)[number];

function keyFor(provider: Provider): string {
  return `${provider}_api_key`;
}

function isProvider(v: unknown): v is Provider {
  return typeof v === 'string' && (SUPPORTED_PROVIDERS as readonly string[]).includes(v);
}

/** GET — return { providers: { openrouter: true, anthropic: false, ... } } */
export const GET: RequestHandler = async ({ request }) => {
  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const result: Record<Provider, boolean> = {
    openrouter: false,
    openai: false,
    anthropic: false,
    gemini: false
  };

  // We must NOT return the key bodies. Only presence.
  for (const p of SUPPORTED_PROVIDERS) {
    const value = await db.kvGet(user.id, CATEGORY, keyFor(p));
    result[p] = typeof value === 'string' && value.length > 0;
  }

  return json({ providers: result });
};

/** PUT — body: { provider: Provider, key: string } */
export const PUT: RequestHandler = async ({ request }) => {
  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  let body: { provider?: unknown; key?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid body' }, { status: 400 });
  }

  if (!isProvider(body.provider)) {
    return json({ error: `provider must be one of ${SUPPORTED_PROVIDERS.join(', ')}` }, { status: 400 });
  }
  const key = body.key;
  if (typeof key !== 'string' || key.trim().length < 8) {
    return json({ error: 'key must be a non-empty string of at least 8 characters' }, { status: 400 });
  }

  await getDb().kvSet(user.id, CATEGORY, keyFor(body.provider), key.trim());
  return json({ ok: true });
};

/** DELETE ?provider=openrouter — clear a single provider's key */
export const DELETE: RequestHandler = async ({ request, url }) => {
  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const provider = url.searchParams.get('provider');
  if (!isProvider(provider)) {
    return json({ error: `provider must be one of ${SUPPORTED_PROVIDERS.join(', ')}` }, { status: 400 });
  }

  // Clearing == storing empty string. The encryption layer skips encryption of
  // empty strings, so this row becomes a recognizable "cleared" marker without
  // leaking that it ever held a key.
  await getDb().kvSet(user.id, CATEGORY, keyFor(provider), '');
  return json({ ok: true });
};
