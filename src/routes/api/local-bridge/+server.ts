/**
 * Local-bridge settings API.
 *
 *  GET    — returns { source, hasUrl, serverName? } for the current user.
 *           The URL itself is never returned — only whether one is configured
 *           and the bridge's friendly name if we can reach it.
 *  POST   — { url }  → probe the URL with a real MCP initialize; save on success.
 *  DELETE — clear the saved URL. Source falls back to "cloud" automatically.
 *  PATCH  — { source: "cloud" | "local" } toggle without touching the URL.
 *
 * The URL is stored in app_settings under category=local_bridge, key=url and
 * is auto-encrypted at rest (crypto/index.ts marks the category sensitive).
 */

import { validateSession } from '$lib/server/auth';
import { probeBridge } from '$lib/server/chat/mcp-bridge-client';
import { settingsManager } from '$lib/server/state-manager';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type WorkspaceSource = 'cloud' | 'local';

async function readState(userId: string) {
  const [source, url] = await Promise.all([
    settingsManager.get<WorkspaceSource>(userId, 'workspace', 'source', 'cloud'),
    settingsManager.get<string>(userId, 'local_bridge', 'url', '')
  ]);
  return {
    hasUrl: typeof url === 'string' && url.length > 0,
    source: source === 'local' ? ('local' as const) : ('cloud' as const)
  };
}

export const GET: RequestHandler = async ({ request }) => {
  const user = await validateSession(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
  return json(await readState(user.id));
};

export const POST: RequestHandler = async ({ request }) => {
  const user = await validateSession(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return json({ error: 'Missing `url`' }, { status: 400 });
  // Block obvious garbage early so we don't fire a fetch at file:// etc.
  if (!/^https?:\/\//i.test(url)) {
    return json({ error: 'URL must start with http:// or https://' }, { status: 400 });
  }

  // Probe before saving — refusing here means the user gets immediate
  // feedback instead of discovering the bridge is down on the next chat.
  const probe = await probeBridge(url);
  if (!probe.ok) {
    return json({ error: probe.error, ok: false }, { status: 400 });
  }

  await settingsManager.set(user.id, 'local_bridge', 'url', url, {
    description: 'graphini-bridge connect URL (read-only filesystem)',
    isSensitive: true
  });

  return json({
    ok: true,
    serverName: probe.serverName,
    serverVersion: probe.serverVersion,
    ...(await readState(user.id))
  });
};

export const DELETE: RequestHandler = async ({ request }) => {
  const user = await validateSession(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  await settingsManager.delete(user.id, 'local_bridge', 'url');
  // If the user had Local selected but no bridge, the chat tool already
  // returns a "configure a bridge" error — but flip the source back to
  // cloud so the sidebar UX matches reality.
  await settingsManager.set(user.id, 'workspace', 'source', 'cloud');

  return json({ ok: true, ...(await readState(user.id)) });
};

export const PATCH: RequestHandler = async ({ request }) => {
  const user = await validateSession(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  let body: { source?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const source = body.source === 'local' ? 'local' : 'cloud';

  if (source === 'local') {
    // Refuse to flip to Local without a saved URL — keeps the sidebar
    // state honest. The client UI also disables the button in this case.
    const url = await settingsManager.get<string>(user.id, 'local_bridge', 'url', '');
    if (!url) {
      return json(
        { error: 'No bridge URL configured. Save one in Settings → Local files first.' },
        { status: 400 }
      );
    }
  }

  await settingsManager.set(user.id, 'workspace', 'source', source);
  return json({ ok: true, ...(await readState(user.id)) });
};
