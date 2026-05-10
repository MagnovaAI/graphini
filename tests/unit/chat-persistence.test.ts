import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  messagesFromDbRows,
  textFromContentParts
} from '../../src/lib/client/features/chat/persistence/db-mappers';
import type { DbMessageRow } from '../../src/lib/client/features/chat/persistence/db-types';

const { mockGetDb, mockValidateSessionOrGuest } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockValidateSessionOrGuest: vi.fn()
}));

vi.mock('$lib/server/auth', () => ({
  validateSessionOrGuest: mockValidateSessionOrGuest
}));

vi.mock('$lib/server/db', () => ({
  getDb: mockGetDb
}));

import {
  _listAllConversationMessages,
  POST as postConversationMessages
} from '../../src/routes/api/conversations/messages/+server';

function row(overrides: Partial<DbMessageRow>): DbMessageRow {
  return {
    content: '',
    created_at: '2026-05-10T00:00:00.000Z',
    id: 'msg',
    metadata: {},
    model_used: null,
    parts: null,
    role: 'assistant',
    ...overrides
  };
}

beforeEach(() => {
  mockGetDb.mockReset();
  mockValidateSessionOrGuest.mockReset();
});

describe('chat persistence restore mapping', () => {
  it('keeps user contextContent hidden from visible restored content', () => {
    const [message] = messagesFromDbRows([
      row({
        content: 'Summarize this file',
        metadata: {
          clientId: 'user-1',
          contextContent: 'Summarize this file\n\n--- hidden uploaded file metadata ---'
        },
        role: 'user'
      })
    ]);

    expect(message.content).toBe('Summarize this file');
    expect(message.contextContent).toContain('hidden uploaded file metadata');
  });

  it('restores assistant visible content from text parts when the content column is stale', () => {
    const [message] = messagesFromDbRows([
      row({
        content: '[tool call]',
        parts: [
          { type: 'tool-simple', id: 'tool-1', status: 'done', toolName: 'fileSystem' },
          { type: 'text', text: 'Here is the complete restored answer.' }
        ],
        role: 'assistant'
      })
    ]);

    expect(message.content).toBe('Here is the complete restored answer.');
  });

  it('hides the DB non-empty sentinel for attachment-only user messages', () => {
    const [message] = messagesFromDbRows([
      row({
        content: '[tool call]',
        metadata: {
          attachments: [{ filename: 'notes.pdf' }],
          contextContent: '\n\n--- hidden uploaded file metadata ---'
        },
        role: 'user'
      })
    ]);

    expect(message.content).toBe('');
    expect(message.attachments).toEqual([{ filename: 'notes.pdf' }]);
    expect(message.contextContent).toContain('hidden uploaded file metadata');
  });

  it('extracts concatenated text from restored content parts', () => {
    expect(
      textFromContentParts([
        { type: 'text', text: 'First ' },
        { type: 'tool-simple', id: 'tool-1' },
        { type: 'text', text: 'second.' }
      ])
    ).toBe('First second.');
  });
});

describe('conversation message restore API helpers', () => {
  it('loads every message page instead of truncating restore at the first page', async () => {
    const listMessages = vi.fn(async (_conversationId: string, options?: { offset?: number }) => {
      const offset = options?.offset ?? 0;
      const count = offset < 1000 ? 500 : 3;
      return Array.from({ length: count }, (_, index) => ({ id: `msg-${offset + index}` }));
    });

    const messages = await _listAllConversationMessages(
      { listMessages: listMessages as never },
      'conversation-1'
    );

    expect(messages).toHaveLength(1003);
    expect(listMessages).toHaveBeenCalledTimes(3);
    expect(listMessages.mock.calls.map(([, options]) => options?.offset)).toEqual([0, 500, 1000]);
  });

  it('checks all existing message pages before inserting synced messages', async () => {
    const targetClientId = 'client-550';
    const listMessages = vi.fn(async (_conversationId: string, options?: { offset?: number }) => {
      const offset = options?.offset ?? 0;
      if (offset === 0) {
        return Array.from({ length: 500 }, (_, index) => ({
          id: `old-${index}`,
          metadata: { clientId: `old-${index}` }
        }));
      }
      if (offset === 500) {
        return [{ id: 'existing-tail', metadata: { clientId: targetClientId } }];
      }
      return [];
    });
    const updateMessageByClientId = vi.fn(async () => row({ id: 'existing-tail' }));
    const createMessages = vi.fn(async () => []);
    mockValidateSessionOrGuest.mockResolvedValue({ id: 'user-1' });
    mockGetDb.mockReturnValue({
      createMessages,
      getConversation: vi.fn(async () => ({ id: 'conversation-1', user_id: 'user-1' })),
      listMessages,
      updateMessageByClientId
    });

    const response = await postConversationMessages({
      request: new Request('http://localhost/api/conversations/messages', {
        body: JSON.stringify({
          conversation_id: 'conversation-1',
          messages: [
            {
              content: 'updated answer',
              metadata: { clientId: targetClientId },
              parts: null,
              role: 'assistant'
            }
          ]
        }),
        method: 'POST'
      })
    } as never);

    expect(response.status).toBe(201);
    expect(listMessages.mock.calls.map(([, options]) => options?.offset)).toEqual([0, 500]);
    expect(updateMessageByClientId).toHaveBeenCalledWith(
      'conversation-1',
      targetClientId,
      expect.objectContaining({ content: 'updated answer' })
    );
    expect(createMessages).not.toHaveBeenCalled();
  });
});
