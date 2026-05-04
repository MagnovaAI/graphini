/**
 * Database Adapter Interface
 * All database operations go through this interface.
 * Swap implementations (Supabase, raw PG, Prisma, etc.) by changing the adapter.
 */

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

export interface DatabaseAdapter {
  // ── Auth ──────────────────────────────────────────────────────────────
  createUser(data: { email: string; password_hash: string; display_name?: string }): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserByFirebaseUid(firebase_uid: string): Promise<User | null>;
  upsertUserFromFirebase(data: {
    firebase_uid: string;
    email: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
  }): Promise<User>;
  updateUser(
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
  ): Promise<User>;
  deleteUser(id: string): Promise<void>;
  listUsers(
    options?: PaginationOptions & { search?: string }
  ): Promise<{ users: User[]; total: number }>;

  // ── Sessions ──────────────────────────────────────────────────────────
  createSession(data: {
    user_id: string;
    token: string;
    expires_at: string;
    ip_address?: string;
    user_agent?: string;
  }): Promise<Session>;
  getSessionByToken(token: string): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;
  deleteUserSessions(user_id: string): Promise<void>;
  cleanupExpiredSessions(): Promise<number>;

  // ── Workspaces ────────────────────────────────────────────────────────
  createWorkspace(data: {
    owner_id: string;
    name: string;
    slug: string;
    description?: string;
  }): Promise<Workspace>;
  getWorkspace(id: string): Promise<Workspace | null>;
  listUserWorkspaces(user_id: string): Promise<Workspace[]>;
  updateWorkspace(
    id: string,
    data: Partial<Pick<Workspace, 'name' | 'description' | 'is_public' | 'settings'>>
  ): Promise<Workspace>;
  deleteWorkspace(id: string): Promise<void>;

  // ── Collaboration ─────────────────────────────────────────────────────
  addCollaborator(data: {
    workspace_id: string;
    user_id: string;
    role: CollaborationMember['role'];
    invited_by?: string;
  }): Promise<CollaborationMember>;
  removeCollaborator(workspace_id: string, user_id: string): Promise<void>;
  listCollaborators(workspace_id: string): Promise<(CollaborationMember & { user?: User })[]>;
  updateCollaboratorRole(
    workspace_id: string,
    user_id: string,
    role: CollaborationMember['role']
  ): Promise<void>;

  // ── Credits ───────────────────────────────────────────────────────────
  getCreditBalance(user_id: string): Promise<CreditBalance | null>;
  deductCredits(
    user_id: string,
    amount: number,
    description?: string,
    model_id?: string,
    conversation_id?: string,
    message_id?: string
  ): Promise<DeductCreditsResult>;
  addCredits(
    user_id: string,
    amount: number,
    type: CreditTransaction['type'],
    description?: string
  ): Promise<CreditBalance>;
  getCreditTransactions(user_id: string, options?: PaginationOptions): Promise<CreditTransaction[]>;

  // ── Model Pricing ─────────────────────────────────────────────────────
  getModelPricing(model_id: string): Promise<ModelPricing | null>;
  listModelPricing(): Promise<ModelPricing[]>;
  upsertModelPricing(data: Omit<ModelPricing, 'id'>): Promise<ModelPricing>;

  // ── Conversations ─────────────────────────────────────────────────────
  createConversation(data: {
    user_id?: string;
    workspace_id?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | null>;
  listConversations(
    options?: {
      user_id?: string;
      workspace_id?: string;
      include_archived?: boolean;
    } & PaginationOptions
  ): Promise<Conversation[]>;
  updateConversation(
    id: string,
    data: Partial<
      Pick<Conversation, 'title' | 'is_archived' | 'is_pinned' | 'metadata' | 'workspace_id'>
    >
  ): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;

  // ── Messages ──────────────────────────────────────────────────────────
  createMessage(data: {
    conversation_id: string;
    role: Message['role'];
    content: string;
    parts?: unknown;
    model_used?: string;
    tokens_used?: number;
    credits_charged?: number;
    metadata?: Record<string, unknown>;
  }): Promise<Message>;
  createMessages(
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
  ): Promise<Message[]>;
  listMessages(conversation_id: string, options?: PaginationOptions): Promise<Message[]>;
  deleteMessage(id: string): Promise<void>;

  // ── Snapshots ─────────────────────────────────────────────────────────
  createSnapshot(data: {
    conversation_id: string;
    message_id?: string;
    description?: string;
    state: Record<string, unknown>;
  }): Promise<Snapshot>;
  listSnapshots(conversation_id: string): Promise<Snapshot[]>;
  getSnapshot(id: string): Promise<Snapshot | null>;
  deleteSnapshot(id: string): Promise<void>;

  // ── Files ─────────────────────────────────────────────────────────────
  createFileRecord(data: Omit<FileRecord, 'id' | 'created_at'>): Promise<FileRecord>;
  getFile(id: string): Promise<FileRecord | null>;
  listConversationFiles(conversation_id: string): Promise<FileRecord[]>;
  deleteFile(id: string): Promise<void>;

  // ── Usage Stats ───────────────────────────────────────────────────────
  createUsageStats(data: Omit<UsageStats, 'id' | 'created_at'>): Promise<UsageStats>;

  // ── Cache ─────────────────────────────────────────────────────────────
  cacheGet(key: string): Promise<CacheEntry | null>;
  cacheSet(
    key: string,
    value: unknown,
    options?: { ttl_seconds?: number; tags?: string[] }
  ): Promise<void>;
  cacheDelete(key: string): Promise<boolean>;
  cacheDeleteByTag(tag: string): Promise<number>;
  cacheClear(): Promise<void>;
  cacheCleanup(): Promise<number>;

  // ── Enabled Models ──────────────────────────────────────────────────
  listEnabledModels(onlyEnabled?: boolean): Promise<EnabledModel[]>;
  getEnabledModel(model_id: string): Promise<EnabledModel | null>;
  upsertEnabledModel(
    data: Omit<EnabledModel, 'id' | 'created_at' | 'updated_at'>
  ): Promise<EnabledModel>;
  deleteEnabledModel(model_id: string): Promise<void>;

  // ── App Settings (KV Store — replaces localStorage) ─────────────────
  kvGet(user_id: string, category: string, key: string): Promise<unknown | null>;
  kvSet(user_id: string, category: string, key: string, value: unknown): Promise<void>;
  kvDelete(user_id: string, category: string, key: string): Promise<void>;
  kvGetAll(
    user_id: string,
    category?: string
  ): Promise<{ category: string; key: string; value: unknown }[]>;
  kvSetBatch(
    user_id: string,
    entries: { category: string; key: string; value: unknown }[]
  ): Promise<void>;

  // ── File Versions ────────────────────────────────────────────────────────
  createFileVersion(data: {
    file_id: string;
    user_id: string;
    version: number;
    content_mermaid: string;
    content_document: string;
  }): Promise<{ id: string; version: number; created_at: string }>;
  listFileVersions(
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
  >;
  pruneFileVersions(file_id: string, keepCount: number): Promise<number>;

  // ── Diagram Workspaces ───────────────────────────────────────────────
  createDiagramWorkspace(data: {
    user_id: string;
    title: string;
    description?: string;
    document?: Record<string, unknown>;
    engine?: string;
  }): Promise<DiagramWorkspaceRow>;
  getDiagramWorkspace(id: string): Promise<DiagramWorkspaceRow | null>;
  listDiagramWorkspaces(
    user_id: string,
    options?: { limit?: number; offset?: number; starred_only?: boolean; search?: string }
  ): Promise<{ workspaces: DiagramWorkspaceSummaryRow[]; total: number }>;
  updateDiagramWorkspace(
    id: string,
    data: Partial<Pick<DiagramWorkspaceRow, 'title' | 'description' | 'is_starred' | 'tags'>>
  ): Promise<DiagramWorkspaceRow>;
  deleteDiagramWorkspace(id: string): Promise<void>;
  updateDiagramWorkspaceDocument(
    id: string,
    document: Record<string, unknown>,
    meta?: { element_count?: number; diagram_type?: string | null }
  ): Promise<void>;
  duplicateDiagramWorkspace(id: string, newTitle: string): Promise<DiagramWorkspaceRow>;

  // ── Admin (read-only table browser) ───────────────────────────────────
  /** Whitelisted tables only; used by /api/admin db_table action. */
  adminBrowseTable(
    table: string,
    options: { limit: number; offset: number }
  ): Promise<{ rows: Record<string, unknown>[]; total: number }>;

  // ── Health ────────────────────────────────────────────────────────────
  healthCheck(): Promise<boolean>;
}
