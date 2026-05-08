import { validateSessionOrGuest } from '$lib/server/auth';
import { GUEST_CONVERSATION_LIMIT } from '$lib/server/auth/limits';
import { getDb } from '$lib/server/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** List conversations for the authenticated user */
export const GET: RequestHandler = async ({ request, url }) => {
  try {
    const user = await validateSessionOrGuest(request);
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

    const db = getDb();
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const includeArchived = url.searchParams.get('archived') === 'true';

    const conversations = await db.listConversations({
      user_id: user.id,
      include_archived: includeArchived,
      limit,
      offset
    });

    return json({ conversations });
  } catch (err: unknown) {
    return json({ error: errorMessage(err, 'Failed to list conversations') }, { status: 500 });
  }
};

/** Delete a conversation */
export const DELETE: RequestHandler = async ({ request, url }) => {
  try {
    const user = await validateSessionOrGuest(request);
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing conversation id' }, { status: 400 });

    const db = getDb();
    const conv = await db.getConversation(id);
    if (!conv || conv.user_id !== user.id) {
      return json({ error: 'Conversation not found' }, { status: 404 });
    }

    await db.deleteConversation(id);

    return json({ success: true });
  } catch (err: unknown) {
    return json({ error: errorMessage(err, 'Failed to delete conversation') }, { status: 500 });
  }
};

/** Create a new conversation */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const user = await validateSessionOrGuest(request);
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

    const db = getDb();

    if (user.is_guest === true) {
      const count = await db.countConversations(user.id, { include_archived: true });
      if (count >= GUEST_CONVERSATION_LIMIT) {
        return json(
          {
            error: 'guest_conversation_limit_reached',
            message: `You've reached the ${GUEST_CONVERSATION_LIMIT}-chat guest limit. Sign in to keep chatting and save your work.`,
            limit: GUEST_CONVERSATION_LIMIT,
            used: count
          },
          { status: 402 }
        );
      }
    }

    const body = await request.json().catch(() => ({}));
    const conversation = await db.createConversation({
      user_id: user.id,
      title: body.title || 'New Chat',
      metadata: body.metadata || {}
    });

    return json({ conversation }, { status: 201 });
  } catch (err: unknown) {
    return json({ error: errorMessage(err, 'Failed to create conversation') }, { status: 500 });
  }
};
