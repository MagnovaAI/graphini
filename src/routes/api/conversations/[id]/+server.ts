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
