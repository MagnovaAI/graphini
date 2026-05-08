import { validateSessionOrGuest } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * GET /api/conversations/:id
 *
 * Returns the conversation, ensuring it has an attached workspace_id (creates
 * one on demand the first time the chat is opened in the new chat-first URL
 * scheme). Authz: requesting user must own the conversation.
 */
export const GET: RequestHandler = async ({ request, params }) => {
  try {
    const user = await validateSessionOrGuest(request);
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

    const id = params.id;
    if (!id) return json({ error: 'Missing conversation id' }, { status: 400 });

    const db = getDb();
    const conv = await db.getConversation(id);
    if (!conv || conv.user_id !== user.id) {
      return json({ error: 'Conversation not found' }, { status: 404 });
    }

    if (!conv.workspace_id) {
      // db here is the concrete NeonAdapter which exposes createDiagramWorkspace
      const adapter = db as unknown as {
        createDiagramWorkspace: (data: {
          user_id: string;
          title: string;
          engine?: string;
        }) => Promise<{ id: string }>;
      };
      const workspace = await adapter.createDiagramWorkspace({
        user_id: user.id,
        title: conv.title || 'Untitled',
        engine: 'mermaid'
      });
      const updated = await db.updateConversation(conv.id, { workspace_id: workspace.id });
      return json({ conversation: updated });
    }

    return json({ conversation: conv });
  } catch (err: unknown) {
    return json({ error: errorMessage(err, 'Failed to load conversation') }, { status: 500 });
  }
};

/**
 * PATCH /api/conversations/:id
 *
 * Updates the conversation title (and optionally pin/archive flags). Used by
 * the client to rename a chat from "New chat" to a derived title once the
 * first user message has been sent. Authz: caller must own the conversation.
 */
export const PATCH: RequestHandler = async ({ request, params }) => {
  try {
    const user = await validateSessionOrGuest(request);
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

    const id = params.id;
    if (!id) return json({ error: 'Missing conversation id' }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updates: { title?: string; is_pinned?: boolean; is_archived?: boolean } = {};
    if (typeof body.title === 'string') updates.title = body.title.trim().slice(0, 200);
    if (typeof body.is_pinned === 'boolean') updates.is_pinned = body.is_pinned;
    if (typeof body.is_archived === 'boolean') updates.is_archived = body.is_archived;
    if (Object.keys(updates).length === 0) {
      return json({ error: 'No supported fields to update' }, { status: 400 });
    }

    const db = getDb();
    const conv = await db.getConversation(id);
    if (!conv || conv.user_id !== user.id) {
      return json({ error: 'Conversation not found' }, { status: 404 });
    }

    const updated = await db.updateConversation(id, updates);
    return json({ conversation: updated });
  } catch (err: unknown) {
    return json({ error: errorMessage(err, 'Failed to update conversation') }, { status: 500 });
  }
};
