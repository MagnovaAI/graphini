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
      // and a delete escape hatch for failed/raced links.
      const adapter = db as unknown as {
        createDiagramWorkspace: (data: {
          user_id: string;
          title: string;
          engine?: string;
        }) => Promise<{ id: string }>;
        deleteDiagramWorkspace?: (id: string) => Promise<void>;
      };
      const workspace = await adapter.createDiagramWorkspace({
        user_id: user.id,
        title: conv.title || 'Untitled',
        engine: 'mermaid'
      });

      // Re-read the conversation. If another concurrent request already
      // linked a workspace_id in the meantime, throw ours away and use the
      // winner — otherwise we'd leave an orphan row. (Was the source of
      // the 300+ orphan rows seen in production.)
      const fresh = await db.getConversation(conv.id);
      if (fresh?.workspace_id && fresh.workspace_id !== workspace.id) {
        await adapter.deleteDiagramWorkspace?.(workspace.id).catch(() => {
          /* best-effort cleanup; the orphan is small (empty doc) */
        });
        return json({ conversation: fresh });
      }

      try {
        const updated = await db.updateConversation(conv.id, { workspace_id: workspace.id });
        return json({ conversation: updated });
      } catch (linkErr) {
        // The link write failed — delete the workspace we just created so
        // it doesn't dangle. Best-effort: if delete also fails, log it but
        // surface the original error.
        await adapter.deleteDiagramWorkspace?.(workspace.id).catch(() => {
          /* swallow */
        });
        throw linkErr;
      }
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
