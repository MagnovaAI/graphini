import { validateSessionOrGuest } from '$lib/server/auth';
import { getDb, type Message } from '$lib/server/db';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface MessagePayload {
  content?: unknown;
  credits_charged?: unknown;
  metadata?: unknown;
  model_used?: unknown;
  parts?: unknown;
  role?: unknown;
  tokens_used?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toMessageRole(value: unknown): Message['role'] {
  return value === 'assistant' || value === 'system' || value === 'tool' ? value : 'user';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** List messages for a conversation */
export const GET: RequestHandler = async ({ request, url }) => {
  try {
    const user = await validateSessionOrGuest(request);
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

    const conversationId = url.searchParams.get('conversation_id');
    if (!conversationId) return json({ error: 'Missing conversation_id' }, { status: 400 });

    const db = getDb();
    const conv = await db.getConversation(conversationId);
    if (!conv || conv.user_id !== user.id) {
      return json({ error: 'Conversation not found' }, { status: 404 });
    }

    const messages = await db.listMessages(conversationId);

    return json({ messages });
  } catch (err: unknown) {
    return json({ error: errorMessage(err, 'Failed to list messages') }, { status: 500 });
  }
};

/** Sync messages (bulk create) for a conversation */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const user = await validateSessionOrGuest(request);
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { conversation_id, messages } = body;

    if (!conversation_id) return json({ error: 'Missing conversation_id' }, { status: 400 });
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: 'Missing or empty messages array' }, { status: 400 });
    }

    const db = getDb();

    // Verify conversation belongs to user
    const conv = await db.getConversation(conversation_id);
    if (!conv || conv.user_id !== user.id) {
      return json({ error: 'Conversation not found' }, { status: 404 });
    }

    const existing = await db.listMessages(conversation_id);
    const existingClientIds = new Set(
      existing
        .map((msg) => asRecord(msg.metadata).clientId)
        .filter((clientId): clientId is string => typeof clientId === 'string')
    );
    const seenClientIds = new Set<string>();

    const toUpsert = (messages as MessagePayload[]).filter((msg) => {
      const clientId = asRecord(msg.metadata).clientId;
      if (typeof clientId !== 'string') return true;
      if (seenClientIds.has(clientId)) return false;
      seenClientIds.add(clientId);
      return true;
    });

    const updates: MessagePayload[] = [];
    const inserts: MessagePayload[] = [];
    for (const msg of toUpsert) {
      const clientId = asRecord(msg.metadata).clientId;
      if (typeof clientId === 'string' && existingClientIds.has(clientId)) {
        updates.push(msg);
      } else {
        inserts.push(msg);
      }
    }

    const updated: Message[] = [];
    for (const msg of updates) {
      const clientId = asRecord(msg.metadata).clientId as string;
      const row = await db.updateMessageByClientId(conversation_id, clientId, {
        content:
          typeof msg.content === 'string' && msg.content.trim() ? msg.content : '[tool call]',
        metadata: asRecord(msg.metadata),
        model_used: typeof msg.model_used === 'string' ? msg.model_used : undefined,
        parts: msg.parts ?? null
      });
      if (row) updated.push(row);
    }

    const messagesToCreate = inserts.map((msg) => ({
      content: typeof msg.content === 'string' && msg.content.trim() ? msg.content : '[tool call]',
      conversation_id,
      credits_charged: toFiniteNumber(msg.credits_charged),
      metadata: asRecord(msg.metadata),
      model_used: typeof msg.model_used === 'string' ? msg.model_used : undefined,
      parts: msg.parts ?? null,
      role: toMessageRole(msg.role),
      tokens_used: toFiniteNumber(msg.tokens_used)
    }));

    const created = messagesToCreate.length > 0 ? await db.createMessages(messagesToCreate) : [];

    return json({ messages: [...updated, ...created] }, { status: 201 });
  } catch (err: unknown) {
    return json({ error: errorMessage(err, 'Failed to sync messages') }, { status: 500 });
  }
};
