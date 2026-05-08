import type { DbMessageRow } from './db-types';

export interface ConversationCreateInput {
  fileId: string;
  title: string;
}

export interface ConversationCreateResult {
  id: string | null;
}

export interface GuestLimitError {
  kind: 'guest_conversation_limit_reached';
  message: string;
  limit: number;
  used: number;
}

export async function createConversation(
  input: ConversationCreateInput
): Promise<ConversationCreateResult | GuestLimitError | null> {
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        title: input.title,
        metadata: { fileId: input.fileId }
      })
    });
    if (res.status === 402) {
      const body = await res.json().catch(() => ({}));
      if (body && body.error === 'guest_conversation_limit_reached') {
        return {
          kind: 'guest_conversation_limit_reached',
          message: body.message ?? 'Guest chat limit reached.',
          limit: body.limit ?? 15,
          used: body.used ?? 15
        };
      }
    }
    if (!res.ok) return null;
    const data = await res.json();
    return { id: data.conversation?.id || null };
  } catch {
    return null;
  }
}

export function isGuestLimitError(
  value: unknown
): value is GuestLimitError {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).kind === 'guest_conversation_limit_reached'
  );
}

export interface FetchMessagesResult {
  status: 'ok' | 'gone' | 'error';
  rows?: DbMessageRow[];
}

export async function fetchConversationMessages(
  conversationId: string
): Promise<FetchMessagesResult> {
  try {
    const res = await fetch(`/api/conversations/messages?conversation_id=${conversationId}`, {
      credentials: 'include'
    });
    if (res.status === 404) return { status: 'gone' };
    if (!res.ok) return { status: 'error' };
    const data = await res.json();
    if (!Array.isArray(data.messages)) return { status: 'error' };
    return { status: 'ok', rows: data.messages as DbMessageRow[] };
  } catch {
    return { status: 'error' };
  }
}

export interface PostMessagePayload {
  content: string;
  metadata: Record<string, unknown>;
  model_used?: string;
  parts: unknown;
  role: string;
}

export async function postConversationMessages(
  conversationId: string,
  payload: PostMessagePayload[]
): Promise<boolean> {
  try {
    const res = await fetch('/api/conversations/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ conversation_id: conversationId, messages: payload })
    });
    return res.ok;
  } catch {
    return false;
  }
}
