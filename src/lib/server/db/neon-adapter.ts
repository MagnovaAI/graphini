/**
 * Neon Database Adapter — implements DatabaseAdapter using Drizzle ORM + Neon serverless driver
 *
 * All domain logic lives in ./domains/*.ts — this class is a thin delegation layer.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { desc, sql } from 'drizzle-orm';
import type { DatabaseAdapter } from './adapter';
import type {
  CacheEntry,
  CollaborationMember,
  Conversation,
  CreditBalance,
  CreditTransaction,
  DeductCreditsResult,
  DiagramWorkspaceRow,
  DiagramWorkspaceSummaryRow,
  EnabledModel,
  FileRecord,
  Message,
  ModelPricing,
  PaginationOptions,
  Session,
  Snapshot,
  UsageStats,
  User,
  Workspace
} from './types';
import * as schema from './schema';

// Domain helpers
import * as usersDomain from './domains/users';
import * as workspacesDomain from './domains/workspaces';
import * as conversationsDomain from './domains/conversations';
import * as creditsDomain from './domains/credits';
import * as cacheDomain from './domains/cache';
import * as modelsDomain from './domains/models';

export class NeonAdapter implements DatabaseAdapter {
  public db: NeonHttpDatabase<typeof schema>;

  constructor(connectionString: string) {
    const client = neon(connectionString, { disableWarningInBrowsers: true });
    this.db = drizzle(client, { schema });
  }

  // ── Auth ──────────────────────────────────────────────────────────────

  async createUser(data: {
    email: string;
    password_hash: string;
    display_name?: string;
  }): Promise<User> {
    return usersDomain.createUser(this.db, data);
  }

  async getUserById(id: string): Promise<User | null> {
    return usersDomain.getUserById(this.db, id);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return usersDomain.getUserByEmail(this.db, email);
  }

  async getUserByFirebaseUid(firebase_uid: string): Promise<User | null> {
    return usersDomain.getUserByFirebaseUid(this.db, firebase_uid);
  }

  async upsertUserFromFirebase(data: {
    firebase_uid: string;
    email: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
  }): Promise<User> {
    return usersDomain.upsertUserFromFirebase(this.db, data);
  }

  async updateUser(
    id: string,
    data: Partial<
      Pick<
        User,
        | 'display_name'
        | 'avatar_url'
        | 'role'
        | 'is_active'
        | 'email_verified'
        | 'last_login_at'
        | 'metadata'
      >
    >
  ): Promise<User> {
    return usersDomain.updateUser(this.db, id, data);
  }

  async deleteUser(id: string): Promise<void> {
    return usersDomain.deleteUser(this.db, id);
  }

  async listUsers(
    options?: PaginationOptions & { search?: string }
  ): Promise<{ users: User[]; total: number }> {
    return usersDomain.listUsers(this.db, options);
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  async createSession(data: {
    user_id: string;
    token: string;
    expires_at: string;
    ip_address?: string;
    user_agent?: string;
  }): Promise<Session> {
    return usersDomain.createSession(this.db, data);
  }

  async getSessionByToken(token: string): Promise<Session | null> {
    return usersDomain.getSessionByToken(this.db, token);
  }

  async deleteSession(id: string): Promise<void> {
    return usersDomain.deleteSession(this.db, id);
  }

  async deleteUserSessions(user_id: string): Promise<void> {
    return usersDomain.deleteUserSessions(this.db, user_id);
  }

  async cleanupExpiredSessions(): Promise<number> {
    return usersDomain.cleanupExpiredSessions(this.db);
  }

  // ── Workspaces ────────────────────────────────────────────────────────

  async createWorkspace(data: {
    owner_id: string;
    name: string;
    slug: string;
    description?: string;
  }): Promise<Workspace> {
    return workspacesDomain.createWorkspace(this.db, data);
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    return workspacesDomain.getWorkspace(this.db, id);
  }

  async listUserWorkspaces(user_id: string): Promise<Workspace[]> {
    return workspacesDomain.listUserWorkspaces(this.db, user_id);
  }

  async updateWorkspace(
    id: string,
    data: Partial<Pick<Workspace, 'name' | 'description' | 'is_public' | 'settings'>>
  ): Promise<Workspace> {
    return workspacesDomain.updateWorkspace(this.db, id, data);
  }

  async deleteWorkspace(id: string): Promise<void> {
    return workspacesDomain.deleteWorkspace(this.db, id);
  }

  // ── Collaboration ─────────────────────────────────────────────────────

  async addCollaborator(data: {
    workspace_id: string;
    user_id: string;
    role: CollaborationMember['role'];
    invited_by?: string;
  }): Promise<CollaborationMember> {
    return workspacesDomain.addCollaborator(this.db, data);
  }

  async removeCollaborator(workspace_id: string, user_id: string): Promise<void> {
    return workspacesDomain.removeCollaborator(this.db, workspace_id, user_id);
  }

  async listCollaborators(
    workspace_id: string
  ): Promise<(CollaborationMember & { user?: User })[]> {
    return workspacesDomain.listCollaborators(this.db, workspace_id);
  }

  async updateCollaboratorRole(
    workspace_id: string,
    user_id: string,
    role: CollaborationMember['role']
  ): Promise<void> {
    return workspacesDomain.updateCollaboratorRole(this.db, workspace_id, user_id, role);
  }

  // ── Credits ───────────────────────────────────────────────────────────

  async getCreditBalance(user_id: string): Promise<CreditBalance | null> {
    return creditsDomain.getCreditBalance(this.db, user_id);
  }

  async deductCredits(
    user_id: string,
    amount: number,
    description?: string,
    model_id?: string,
    conversation_id?: string,
    message_id?: string
  ): Promise<DeductCreditsResult> {
    return creditsDomain.deductCredits(
      this.db,
      user_id,
      amount,
      description,
      model_id,
      conversation_id,
      message_id
    );
  }

  async addCredits(
    user_id: string,
    amount: number,
    type: CreditTransaction['type'],
    description?: string
  ): Promise<CreditBalance> {
    return creditsDomain.addCredits(this.db, user_id, amount, type, description);
  }

  async getCreditTransactions(
    user_id: string,
    options?: PaginationOptions
  ): Promise<CreditTransaction[]> {
    return creditsDomain.getCreditTransactions(this.db, user_id, options);
  }

  // ── Model Pricing ─────────────────────────────────────────────────────

  async getModelPricing(model_id: string): Promise<ModelPricing | null> {
    return creditsDomain.getModelPricing(this.db, model_id);
  }

  async listModelPricing(): Promise<ModelPricing[]> {
    return creditsDomain.listModelPricing(this.db);
  }

  async upsertModelPricing(data: Omit<ModelPricing, 'id'>): Promise<ModelPricing> {
    return creditsDomain.upsertModelPricing(this.db, data);
  }

  // ── Conversations ─────────────────────────────────────────────────────

  async createConversation(data: {
    user_id?: string;
    workspace_id?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Conversation> {
    return conversationsDomain.createConversation(this.db, data);
  }

  async getConversation(id: string): Promise<Conversation | null> {
    return conversationsDomain.getConversation(this.db, id);
  }

  async listConversations(
    options?: {
      user_id?: string;
      workspace_id?: string;
      include_archived?: boolean;
    } & PaginationOptions
  ): Promise<Conversation[]> {
    return conversationsDomain.listConversations(this.db, options);
  }

  async updateConversation(
    id: string,
    data: Partial<
      Pick<Conversation, 'title' | 'is_archived' | 'is_pinned' | 'metadata' | 'workspace_id'>
    >
  ): Promise<Conversation> {
    return conversationsDomain.updateConversation(this.db, id, data);
  }

  async deleteConversation(id: string): Promise<void> {
    return conversationsDomain.deleteConversation(this.db, id);
  }

  // ── Messages ──────────────────────────────────────────────────────────

  async createMessage(data: {
    conversation_id: string;
    role: Message['role'];
    content: string;
    parts?: unknown;
    model_used?: string;
    tokens_used?: number;
    credits_charged?: number;
    metadata?: Record<string, unknown>;
  }): Promise<Message> {
    return conversationsDomain.createMessage(this.db, data);
  }

  async createMessages(
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
    return conversationsDomain.createMessages(this.db, messages);
  }

  async listMessages(conversation_id: string, options?: PaginationOptions): Promise<Message[]> {
    return conversationsDomain.listMessages(this.db, conversation_id, options);
  }

  async deleteMessage(id: string): Promise<void> {
    return conversationsDomain.deleteMessage(this.db, id);
  }

  // ── Snapshots ─────────────────────────────────────────────────────────

  async createSnapshot(data: {
    conversation_id: string;
    message_id?: string;
    description?: string;
    state: Record<string, unknown>;
  }): Promise<Snapshot> {
    return conversationsDomain.createSnapshot(this.db, data);
  }

  async listSnapshots(conversation_id: string): Promise<Snapshot[]> {
    return conversationsDomain.listSnapshots(this.db, conversation_id);
  }

  async getSnapshot(id: string): Promise<Snapshot | null> {
    return conversationsDomain.getSnapshot(this.db, id);
  }

  async deleteSnapshot(id: string): Promise<void> {
    return conversationsDomain.deleteSnapshot(this.db, id);
  }

  // ── Files ─────────────────────────────────────────────────────────────

  async createFileRecord(data: Omit<FileRecord, 'id' | 'created_at'>): Promise<FileRecord> {
    return conversationsDomain.createFileRecord(this.db, data);
  }

  async getFile(id: string): Promise<FileRecord | null> {
    return conversationsDomain.getFile(this.db, id);
  }

  async listConversationFiles(conversation_id: string): Promise<FileRecord[]> {
    return conversationsDomain.listConversationFiles(this.db, conversation_id);
  }

  async deleteFile(id: string): Promise<void> {
    return conversationsDomain.deleteFile(this.db, id);
  }

  // ── Usage Stats ───────────────────────────────────────────────────────

  async createUsageStats(data: Omit<UsageStats, 'id' | 'created_at'>): Promise<UsageStats> {
    return conversationsDomain.createUsageStats(this.db, data);
  }

  // ── Cache ─────────────────────────────────────────────────────────────

  async cacheGet(key: string): Promise<CacheEntry | null> {
    return cacheDomain.cacheGet(this.db, key);
  }

  async cacheSet(
    key: string,
    value: unknown,
    options?: { ttl_seconds?: number; tags?: string[] }
  ): Promise<void> {
    return cacheDomain.cacheSet(this.db, key, value, options);
  }

  async cacheDelete(key: string): Promise<boolean> {
    return cacheDomain.cacheDelete(this.db, key);
  }

  async cacheDeleteByTag(tag: string): Promise<number> {
    return cacheDomain.cacheDeleteByTag(this.db, tag);
  }

  async cacheClear(): Promise<void> {
    return cacheDomain.cacheClear(this.db);
  }

  async cacheCleanup(): Promise<number> {
    return cacheDomain.cacheCleanup(this.db);
  }

  // ── Enabled Models ──────────────────────────────────────────────────

  async listEnabledModels(onlyEnabled = true): Promise<EnabledModel[]> {
    return modelsDomain.listEnabledModels(this.db, onlyEnabled);
  }

  async getEnabledModel(model_id: string): Promise<EnabledModel | null> {
    return modelsDomain.getEnabledModel(this.db, model_id);
  }

  async upsertEnabledModel(
    data: Omit<EnabledModel, 'id' | 'created_at' | 'updated_at'>
  ): Promise<EnabledModel> {
    return modelsDomain.upsertEnabledModel(this.db, data);
  }

  async deleteEnabledModel(model_id: string): Promise<void> {
    return modelsDomain.deleteEnabledModel(this.db, model_id);
  }

  // ── App Settings (KV Store) ──────────────────────────────────────────

  async kvGet(user_id: string, category: string, key: string): Promise<unknown | null> {
    return cacheDomain.kvGet(this.db, user_id, category, key);
  }

  async kvSet(user_id: string, category: string, key: string, value: unknown): Promise<void> {
    return cacheDomain.kvSet(this.db, user_id, category, key, value);
  }

  async kvDelete(user_id: string, category: string, key: string): Promise<void> {
    return cacheDomain.kvDelete(this.db, user_id, category, key);
  }

  async kvGetAll(
    user_id: string,
    category?: string
  ): Promise<{ category: string; key: string; value: unknown }[]> {
    return cacheDomain.kvGetAll(this.db, user_id, category);
  }

  async kvSetBatch(
    user_id: string,
    entries: { category: string; key: string; value: unknown }[]
  ): Promise<void> {
    return cacheDomain.kvSetBatch(this.db, user_id, entries);
  }

  // ── File Versions ────────────────────────────────────────────────────

  async createFileVersion(data: {
    file_id: string;
    user_id: string;
    version: number;
    content_mermaid: string;
    content_document: string;
  }): Promise<{ id: string; version: number; created_at: string }> {
    return conversationsDomain.createFileVersion(this.db, data);
  }

  async listFileVersions(
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
    return conversationsDomain.listFileVersions(this.db, file_id, limit);
  }

  async pruneFileVersions(file_id: string, keepCount: number): Promise<number> {
    return conversationsDomain.pruneFileVersions(this.db, file_id, keepCount);
  }

  // ── Diagram Workspaces ──────────────────────────────────────────────

  async createDiagramWorkspace(data: {
    user_id: string;
    title: string;
    description?: string;
    document?: Record<string, unknown>;
    engine?: string;
  }): Promise<DiagramWorkspaceRow> {
    return modelsDomain.createDiagramWorkspace(this.db, data);
  }

  async getDiagramWorkspace(id: string): Promise<DiagramWorkspaceRow | null> {
    return modelsDomain.getDiagramWorkspace(this.db, id);
  }

  async listDiagramWorkspaces(
    user_id: string,
    options?: { limit?: number; offset?: number; starred_only?: boolean; search?: string }
  ): Promise<{ workspaces: DiagramWorkspaceSummaryRow[]; total: number }> {
    return modelsDomain.listDiagramWorkspaces(this.db, user_id, options);
  }

  async updateDiagramWorkspace(
    id: string,
    data: Partial<Pick<DiagramWorkspaceRow, 'title' | 'description' | 'is_starred' | 'tags'>>
  ): Promise<DiagramWorkspaceRow> {
    return modelsDomain.updateDiagramWorkspace(this.db, id, data);
  }

  async deleteDiagramWorkspace(id: string): Promise<void> {
    return modelsDomain.deleteDiagramWorkspace(this.db, id);
  }

  async updateDiagramWorkspaceDocument(
    id: string,
    document: Record<string, unknown>,
    meta?: { element_count?: number; diagram_type?: string | null }
  ): Promise<void> {
    return modelsDomain.updateDiagramWorkspaceDocument(this.db, id, document, meta);
  }

  async duplicateDiagramWorkspace(id: string, newTitle: string): Promise<DiagramWorkspaceRow> {
    return modelsDomain.duplicateDiagramWorkspace(this.db, id, newTitle);
  }

  // ── Admin (read-only table browser) ─────────────────────────────────

  async adminBrowseTable(
    table: string,
    options: { limit: number; offset: number }
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    const { limit, offset } = options;

    const countRows = await (() => {
      switch (table) {
        case 'users':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.users);
        case 'sessions':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.sessions);
        case 'workspaces':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.workspaces);
        case 'credit_balances':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.creditBalances);
        case 'credit_transactions':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.creditTransactions);
        case 'model_pricing':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.modelPricing);
        case 'enabled_models':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.enabledModels);
        case 'conversations':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.conversations);
        case 'messages':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.messages);
        case 'usage_stats':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.usageStats);
        case 'cache_entries':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.cacheEntries);
        case 'app_settings':
          return this.db.select({ c: sql<number>`count(*)::int` }).from(schema.appSettings);
        default:
          throw new Error(`Unsupported admin table: ${table}`);
      }
    })();

    const total = countRows[0]?.c ?? 0;

    const rows = await (() => {
      switch (table) {
        case 'users':
          return this.db
            .select()
            .from(schema.users)
            .orderBy(desc(schema.users.created_at))
            .limit(limit)
            .offset(offset);
        case 'sessions':
          return this.db
            .select()
            .from(schema.sessions)
            .orderBy(desc(schema.sessions.created_at))
            .limit(limit)
            .offset(offset);
        case 'workspaces':
          return this.db
            .select()
            .from(schema.workspaces)
            .orderBy(desc(schema.workspaces.created_at))
            .limit(limit)
            .offset(offset);
        case 'credit_balances':
          return this.db
            .select()
            .from(schema.creditBalances)
            .orderBy(desc(schema.creditBalances.updated_at))
            .limit(limit)
            .offset(offset);
        case 'credit_transactions':
          return this.db
            .select()
            .from(schema.creditTransactions)
            .orderBy(desc(schema.creditTransactions.created_at))
            .limit(limit)
            .offset(offset);
        case 'model_pricing':
          return this.db
            .select()
            .from(schema.modelPricing)
            .orderBy(desc(schema.modelPricing.created_at))
            .limit(limit)
            .offset(offset);
        case 'enabled_models':
          return this.db
            .select()
            .from(schema.enabledModels)
            .orderBy(desc(schema.enabledModels.created_at))
            .limit(limit)
            .offset(offset);
        case 'conversations':
          return this.db
            .select()
            .from(schema.conversations)
            .orderBy(desc(schema.conversations.created_at))
            .limit(limit)
            .offset(offset);
        case 'messages':
          return this.db
            .select()
            .from(schema.messages)
            .orderBy(desc(schema.messages.created_at))
            .limit(limit)
            .offset(offset);
        case 'usage_stats':
          return this.db
            .select()
            .from(schema.usageStats)
            .orderBy(desc(schema.usageStats.created_at))
            .limit(limit)
            .offset(offset);
        case 'cache_entries':
          return this.db
            .select()
            .from(schema.cacheEntries)
            .orderBy(desc(schema.cacheEntries.created_at))
            .limit(limit)
            .offset(offset);
        case 'app_settings':
          return this.db
            .select()
            .from(schema.appSettings)
            .orderBy(desc(schema.appSettings.created_at))
            .limit(limit)
            .offset(offset);
        default:
          throw new Error(`Unsupported admin table: ${table}`);
      }
    })();

    return { rows: rows as Record<string, unknown>[], total };
  }

  // ── Health ────────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }
}
