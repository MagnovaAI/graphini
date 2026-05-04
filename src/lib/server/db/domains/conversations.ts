/**
 * Domain helper — Conversations, Messages, Snapshots, Files, Usage Stats
 */

import { and, asc, desc, eq, inArray, not } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type {
  Conversation,
  FileRecord,
  Message,
  PaginationOptions,
  Snapshot,
  UsageStats
} from '../types';
import * as schema from '../schema';

// ── Row Mappers ────────────────────────────────────────────────────────────

export function mapConversation(row: typeof schema.conversations.$inferSelect): Conversation {
  return {
    created_at: row.created_at.toISOString(),
    id: row.id,
    is_archived: row.is_archived,
    is_pinned: row.is_pinned,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    title: row.title,
    updated_at: row.updated_at.toISOString(),
    user_id: row.user_id,
    workspace_id: row.workspace_id
  };
}

export function mapMessage(row: typeof schema.messages.$inferSelect): Message {
  return {
    content: row.content,
    conversation_id: row.conversation_id,
    created_at: row.created_at.toISOString(),
    credits_charged: row.credits_charged ?? 0,
    id: row.id,
    metadata: (row.metadata as Record<string, unknown>) ?? null,
    model_used: row.model_used,
    parts: row.parts,
    role: row.role as Message['role'],
    tokens_used: row.tokens_used ?? 0
  };
}

export function mapSnapshot(row: typeof schema.snapshots.$inferSelect): Snapshot {
  return {
    conversation_id: row.conversation_id,
    created_at: row.created_at.toISOString(),
    description: row.description,
    id: row.id,
    message_id: row.message_id,
    state: (row.state as Record<string, unknown>) ?? {}
  };
}

export function mapFileRecord(row: typeof schema.files.$inferSelect): FileRecord {
  return {
    conversation_id: row.conversation_id,
    created_at: row.created_at.toISOString(),
    filename: row.filename,
    id: row.id,
    message_id: row.message_id,
    mime_type: row.mime_type,
    original_name: row.original_name,
    size_bytes: row.size_bytes,
    storage_bucket: row.storage_bucket ?? 'uploads',
    storage_path: row.storage_path,
    user_id: row.user_id
  };
}

export function mapUsageStats(row: typeof schema.usageStats.$inferSelect): UsageStats {
  return {
    completion_tokens: row.completion_tokens ?? 0,
    conversation_id: row.conversation_id,
    created_at: row.created_at.toISOString(),
    credits_charged: row.credits_charged ?? 0,
    estimated_cost_usd: Number(row.estimated_cost_usd),
    id: row.id,
    message_id: row.message_id,
    model: row.model,
    prompt_tokens: row.prompt_tokens ?? 0,
    total_tokens: row.total_tokens ?? 0,
    user_id: row.user_id
  };
}

// ── Conversations ──────────────────────────────────────────────────────────

export async function createConversation(
  db: NeonHttpDatabase<typeof schema>,
  data: {
    user_id?: string;
    workspace_id?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<Conversation> {
  const [conv] = await db
    .insert(schema.conversations)
    .values({
      user_id: data.user_id ?? null,
      workspace_id: data.workspace_id ?? null,
      title: data.title ?? null,
      metadata: data.metadata ?? {}
    })
    .returning();
  return mapConversation(conv);
}

export async function getConversation(
  db: NeonHttpDatabase<typeof schema>,
  id: string
): Promise<Conversation | null> {
  const [conv] = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.id, id));
  return conv ? mapConversation(conv) : null;
}

export async function listConversations(
  db: NeonHttpDatabase<typeof schema>,
  options?: {
    user_id?: string;
    workspace_id?: string;
    include_archived?: boolean;
  } & PaginationOptions
): Promise<Conversation[]> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  const conditions = [];
  if (options?.user_id) conditions.push(eq(schema.conversations.user_id, options.user_id));
  if (options?.workspace_id)
    conditions.push(eq(schema.conversations.workspace_id, options.workspace_id));
  if (!options?.include_archived) conditions.push(eq(schema.conversations.is_archived, false));

  const rows = await db
    .select()
    .from(schema.conversations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.conversations.updated_at))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => mapConversation(r));
}

export async function updateConversation(
  db: NeonHttpDatabase<typeof schema>,
  id: string,
  data: Partial<
    Pick<Conversation, 'title' | 'is_archived' | 'is_pinned' | 'metadata' | 'workspace_id'>
  >
): Promise<Conversation> {
  const [conv] = await db
    .update(schema.conversations)
    .set(data)
    .where(eq(schema.conversations.id, id))
    .returning();
  return mapConversation(conv);
}

export async function deleteConversation(
  db: NeonHttpDatabase<typeof schema>,
  id: string
): Promise<void> {
  await db.delete(schema.conversations).where(eq(schema.conversations.id, id));
}

// ── Messages ───────────────────────────────────────────────────────────────

export async function createMessage(
  db: NeonHttpDatabase<typeof schema>,
  data: {
    conversation_id: string;
    role: Message['role'];
    content: string;
    parts?: unknown;
    model_used?: string;
    tokens_used?: number;
    credits_charged?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<Message> {
  const [msg] = await db
    .insert(schema.messages)
    .values({
      content: data.content,
      conversation_id: data.conversation_id,
      credits_charged: data.credits_charged ?? 0,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      model_used: data.model_used ?? null,
      parts: (data.parts as Record<string, unknown>) ?? null,
      role: data.role,
      tokens_used: data.tokens_used ?? 0
    })
    .returning();
  await touchConversation(db, data.conversation_id);
  return mapMessage(msg);
}

export async function createMessages(
  db: NeonHttpDatabase<typeof schema>,
  messages: {
    conversation_id: string;
    role: Message['role'];
    content: string;
    parts?: unknown;
    model_used?: string;
    tokens_used?: number;
    credits_charged?: number;
    metadata?: Record<string, unknown>;
  }[]
): Promise<Message[]> {
  if (messages.length === 0) return [];

  const rows = await db
    .insert(schema.messages)
    .values(
      messages.map((message) => ({
        content: message.content,
        conversation_id: message.conversation_id,
        credits_charged: message.credits_charged ?? 0,
        metadata: message.metadata ?? {},
        model_used: message.model_used ?? null,
        parts: (message.parts as Record<string, unknown>) ?? null,
        role: message.role,
        tokens_used: message.tokens_used ?? 0
      }))
    )
    .returning();

  await touchConversation(db, messages[0].conversation_id);
  return rows.map((row) => mapMessage(row));
}

export async function listMessages(
  db: NeonHttpDatabase<typeof schema>,
  conversation_id: string,
  options?: PaginationOptions
): Promise<Message[]> {
  const limit = options?.limit || 200;
  const offset = options?.offset || 0;
  const rows = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversation_id, conversation_id))
    .orderBy(asc(schema.messages.created_at))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => mapMessage(r));
}

export async function deleteMessage(
  db: NeonHttpDatabase<typeof schema>,
  id: string
): Promise<void> {
  await db.delete(schema.messages).where(eq(schema.messages.id, id));
}

async function touchConversation(
  db: NeonHttpDatabase<typeof schema>,
  conversationId: string
): Promise<void> {
  await db
    .update(schema.conversations)
    .set({ updated_at: new Date() })
    .where(eq(schema.conversations.id, conversationId));
}

// ── Snapshots ──────────────────────────────────────────────────────────────

export async function createSnapshot(
  db: NeonHttpDatabase<typeof schema>,
  data: {
    conversation_id: string;
    message_id?: string;
    description?: string;
    state: Record<string, unknown>;
  }
): Promise<Snapshot> {
  const [snap] = await db
    .insert(schema.snapshots)
    .values({
      conversation_id: data.conversation_id,
      message_id: data.message_id ?? null,
      description: data.description ?? null,
      state: data.state
    })
    .returning();
  return mapSnapshot(snap);
}

export async function listSnapshots(
  db: NeonHttpDatabase<typeof schema>,
  conversation_id: string
): Promise<Snapshot[]> {
  const rows = await db
    .select()
    .from(schema.snapshots)
    .where(eq(schema.snapshots.conversation_id, conversation_id))
    .orderBy(desc(schema.snapshots.created_at));
  return rows.map((r) => mapSnapshot(r));
}

export async function getSnapshot(
  db: NeonHttpDatabase<typeof schema>,
  id: string
): Promise<Snapshot | null> {
  const [snap] = await db.select().from(schema.snapshots).where(eq(schema.snapshots.id, id));
  return snap ? mapSnapshot(snap) : null;
}

export async function deleteSnapshot(
  db: NeonHttpDatabase<typeof schema>,
  id: string
): Promise<void> {
  await db.delete(schema.snapshots).where(eq(schema.snapshots.id, id));
}

// ── Files ──────────────────────────────────────────────────────────────────

export async function createFileRecord(
  db: NeonHttpDatabase<typeof schema>,
  data: Omit<FileRecord, 'id' | 'created_at'>
): Promise<FileRecord> {
  const [file] = await db
    .insert(schema.files)
    .values({
      conversation_id: data.conversation_id,
      filename: data.filename,
      message_id: data.message_id,
      mime_type: data.mime_type,
      original_name: data.original_name,
      size_bytes: data.size_bytes,
      storage_bucket: data.storage_bucket,
      storage_path: data.storage_path,
      user_id: data.user_id
    })
    .returning();
  return mapFileRecord(file);
}

export async function getFile(
  db: NeonHttpDatabase<typeof schema>,
  id: string
): Promise<FileRecord | null> {
  const [file] = await db.select().from(schema.files).where(eq(schema.files.id, id));
  return file ? mapFileRecord(file) : null;
}

export async function listConversationFiles(
  db: NeonHttpDatabase<typeof schema>,
  conversation_id: string
): Promise<FileRecord[]> {
  const rows = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.conversation_id, conversation_id))
    .orderBy(desc(schema.files.created_at));
  return rows.map((r) => mapFileRecord(r));
}

export async function deleteFile(db: NeonHttpDatabase<typeof schema>, id: string): Promise<void> {
  await db.delete(schema.files).where(eq(schema.files.id, id));
}

// ── Usage Stats ────────────────────────────────────────────────────────────

export async function createUsageStats(
  db: NeonHttpDatabase<typeof schema>,
  data: Omit<UsageStats, 'id' | 'created_at'>
): Promise<UsageStats> {
  const [stats] = await db
    .insert(schema.usageStats)
    .values({
      completion_tokens: data.completion_tokens,
      conversation_id: data.conversation_id,
      credits_charged: data.credits_charged,
      estimated_cost_usd: String(data.estimated_cost_usd),
      message_id: data.message_id,
      model: data.model,
      prompt_tokens: data.prompt_tokens,
      total_tokens: data.total_tokens,
      user_id: data.user_id
    })
    .returning();
  return mapUsageStats(stats);
}

// ── File Versions ──────────────────────────────────────────────────────────

export async function createFileVersion(
  db: NeonHttpDatabase<typeof schema>,
  data: {
    file_id: string;
    user_id: string;
    version: number;
    content_mermaid: string;
    content_document: string;
  }
): Promise<{ id: string; version: number; created_at: string }> {
  const [row] = await db
    .insert(schema.fileVersions)
    .values({
      content_document: data.content_document,
      content_mermaid: data.content_mermaid,
      file_id: data.file_id,
      user_id: data.user_id,
      version: data.version
    })
    .returning({
      id: schema.fileVersions.id,
      version: schema.fileVersions.version,
      created_at: schema.fileVersions.created_at
    });
  return {
    id: row.id,
    version: row.version,
    created_at: row.created_at.toISOString()
  };
}

export async function listFileVersions(
  db: NeonHttpDatabase<typeof schema>,
  file_id: string,
  limit?: number
): Promise<
  {
    id: string;
    file_id: string;
    version: number;
    content_mermaid: string;
    content_document: string;
    created_at: string;
  }[]
> {
  const query = db
    .select()
    .from(schema.fileVersions)
    .where(eq(schema.fileVersions.file_id, file_id))
    .orderBy(desc(schema.fileVersions.version));

  const rows = limit ? await query.limit(limit) : await query;

  return rows.map((r) => ({
    content_document: r.content_document,
    content_mermaid: r.content_mermaid,
    created_at: r.created_at.toISOString(),
    file_id: r.file_id,
    id: r.id,
    version: r.version
  }));
}

export async function pruneFileVersions(
  db: NeonHttpDatabase<typeof schema>,
  file_id: string,
  keepCount: number
): Promise<number> {
  const keep = await db
    .select({ id: schema.fileVersions.id })
    .from(schema.fileVersions)
    .where(eq(schema.fileVersions.file_id, file_id))
    .orderBy(desc(schema.fileVersions.version))
    .limit(keepCount);

  const keepIds = keep.map((r) => r.id);

  if (keepIds.length === 0) return 0;

  const deleted = await db
    .delete(schema.fileVersions)
    .where(
      and(eq(schema.fileVersions.file_id, file_id), not(inArray(schema.fileVersions.id, keepIds)))
    )
    .returning({ id: schema.fileVersions.id });

  return deleted.length;
}
