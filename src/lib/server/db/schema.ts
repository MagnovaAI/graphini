/**
 * Drizzle ORM Schema — mirrors database/v2-schema.sql
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  numeric,
  jsonb,
  timestamp,
  uniqueIndex,
  index
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// === USERS & AUTH ===

export const users = pgTable(
  'users',
  {
    avatar_url: text('avatar_url'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    display_name: text('display_name'),
    email: text('email').unique(),
    email_verified: boolean('email_verified').notNull().default(false),
    firebase_uid: text('firebase_uid').unique(),
    id: uuid('id').primaryKey().defaultRandom(),
    ip_address: text('ip_address'),
    is_active: boolean('is_active').notNull().default(true),
    last_login_at: timestamp('last_login_at', { withTimezone: true }),
    last_seen_at: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata').default({}),
    password_hash: text('password_hash'),
    role: text('role', { enum: ['user', 'admin', 'superadmin'] })
      .notNull()
      .default('user'),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('idx_users_email').on(t.email),
    index('idx_users_role').on(t.role),
    index('idx_users_firebase_uid').on(t.firebase_uid),
    index('idx_users_last_seen').on(t.last_seen_at)
  ]
);

export const sessions = pgTable(
  'sessions',
  {
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    ip_address: text('ip_address'),
    token: text('token').unique().notNull(),
    user_agent: text('user_agent'),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
  },
  (t) => [
    index('idx_sessions_user').on(t.user_id),
    index('idx_sessions_token').on(t.token),
    index('idx_sessions_expires').on(t.expires_at)
  ]
);

// === WORKSPACES ===

export const workspaces = pgTable(
  'workspaces',
  {
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    description: text('description'),
    id: uuid('id').primaryKey().defaultRandom(),
    is_public: boolean('is_public').notNull().default(false),
    name: text('name').notNull(),
    owner_id: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    settings: jsonb('settings').default({}),
    slug: text('slug').unique().notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('idx_workspaces_owner').on(t.owner_id), index('idx_workspaces_slug').on(t.slug)]
);

export const collaborationMembers = pgTable(
  'collaboration_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invited_by: uuid('invited_by').references(() => users.id),
    joined_at: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    role: text('role', { enum: ['viewer', 'editor', 'admin', 'owner'] })
      .notNull()
      .default('viewer'),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspace_id: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' })
  },
  (t) => [
    uniqueIndex('collaboration_members_workspace_id_user_id_key').on(t.workspace_id, t.user_id),
    index('idx_collab_workspace').on(t.workspace_id),
    index('idx_collab_user').on(t.user_id)
  ]
);

// === CREDITS ===

export const creditBalances = pgTable('credit_balances', {
  balance: integer('balance').notNull().default(100),
  id: uuid('id').primaryKey().defaultRandom(),
  lifetime_earned: integer('lifetime_earned').notNull().default(100),
  lifetime_spent: integer('lifetime_spent').notNull().default(0),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  user_id: uuid('user_id')
    .unique()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
});

export const modelPricing = pgTable('model_pricing', {
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  credits_per_1k_input_tokens: numeric('credits_per_1k_input_tokens', {
    precision: 10,
    scale: 4
  }).default('0'),
  credits_per_1k_output_tokens: numeric('credits_per_1k_output_tokens', {
    precision: 10,
    scale: 4
  }).default('0'),
  credits_per_request: integer('credits_per_request').notNull().default(1),
  id: uuid('id').primaryKey().defaultRandom(),
  is_active: boolean('is_active').notNull().default(true),
  is_free: boolean('is_free').notNull().default(false),
  metadata: jsonb('metadata').default({}),
  model_id: text('model_id').unique().notNull(),
  model_name: text('model_name').notNull(),
  provider: text('provider').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    amount: integer('amount').notNull(),
    balance_after: integer('balance_after').notNull(),
    conversation_id: uuid('conversation_id'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    description: text('description'),
    id: uuid('id').primaryKey().defaultRandom(),
    message_id: uuid('message_id'),
    metadata: jsonb('metadata').default({}),
    model_id: text('model_id'),
    type: text('type', {
      enum: ['purchase', 'usage', 'refund', 'bonus', 'signup', 'referral']
    }).notNull(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
  },
  (t) => [
    index('idx_credit_tx_user').on(t.user_id, t.created_at),
    index('idx_credit_tx_type').on(t.type)
  ]
);

// === CONVERSATIONS & MESSAGES ===

export const conversations = pgTable(
  'conversations',
  {
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    id: uuid('id').primaryKey().defaultRandom(),
    is_archived: boolean('is_archived').notNull().default(false),
    is_pinned: boolean('is_pinned').notNull().default(false),
    metadata: jsonb('metadata').default({}),
    title: text('title'),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    workspace_id: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' })
  },
  (t) => [
    index('idx_conversations_user').on(t.user_id, t.updated_at),
    index('idx_conversations_workspace').on(t.workspace_id),
    index('idx_conversations_updated').on(t.updated_at)
  ]
);

export const messages = pgTable(
  'messages',
  {
    content: text('content').notNull(),
    conversation_id: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    credits_charged: integer('credits_charged').default(0),
    id: uuid('id').primaryKey().defaultRandom(),
    metadata: jsonb('metadata').default({}),
    model_used: text('model_used'),
    parts: jsonb('parts'),
    role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
    tokens_used: integer('tokens_used').default(0)
  },
  (t) => [
    index('idx_messages_conversation').on(t.conversation_id, t.created_at),
    index('idx_messages_role').on(t.conversation_id, t.role)
  ]
);

export const snapshots = pgTable(
  'snapshots',
  {
    conversation_id: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    description: text('description'),
    id: uuid('id').primaryKey().defaultRandom(),
    message_id: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    state: jsonb('state').notNull()
  },
  (t) => [index('idx_snapshots_conversation').on(t.conversation_id, t.created_at)]
);

// === FILES ===

export const files = pgTable(
  'files',
  {
    conversation_id: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade'
    }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    filename: text('filename').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    message_id: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
    mime_type: text('mime_type').notNull(),
    original_name: text('original_name').notNull(),
    size_bytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storage_bucket: text('storage_bucket').default('uploads'),
    storage_path: text('storage_path').notNull(),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' })
  },
  (t) => [
    index('idx_files_user').on(t.user_id),
    index('idx_files_conversation').on(t.conversation_id)
  ]
);

// === USAGE STATS ===

export const usageStats = pgTable(
  'usage_stats',
  {
    completion_tokens: integer('completion_tokens').default(0),
    conversation_id: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade'
    }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    credits_charged: integer('credits_charged').default(0),
    estimated_cost_usd: numeric('estimated_cost_usd', { precision: 10, scale: 6 }).default('0'),
    id: uuid('id').primaryKey().defaultRandom(),
    message_id: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    prompt_tokens: integer('prompt_tokens').default(0),
    total_tokens: integer('total_tokens').default(0),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' })
  },
  (t) => [
    index('idx_usage_user').on(t.user_id, t.created_at),
    index('idx_usage_conversation').on(t.conversation_id)
  ]
);

// === CACHE & KV ===

export const cacheEntries = pgTable(
  'cache_entries',
  {
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    hit_count: integer('hit_count').default(0),
    key: text('key').primaryKey(),
    last_accessed_at: timestamp('last_accessed_at', { withTimezone: true }).notNull().defaultNow(),
    tags: text('tags')
      .array()
      .default(sql`'{}'`),
    value: jsonb('value').notNull()
  },
  (t) => [index('idx_cache_expires').on(t.expires_at)]
);

// (KV Store — replaces localStorage)

export const appSettings = pgTable(
  'app_settings',
  {
    category: text('category').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    description: text('description'),
    id: uuid('id').primaryKey().defaultRandom(),
    is_sensitive: boolean('is_sensitive').default(false),
    key: text('key').notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    value: jsonb('value').notNull()
  },
  (t) => [
    uniqueIndex('app_settings_user_id_category_key_key').on(t.user_id, t.category, t.key),
    index('idx_settings_user').on(t.user_id, t.category)
  ]
);

// === APP STATES ===

export const appStates = pgTable(
  'app_states',
  {
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    id: uuid('id').primaryKey().defaultRandom(),
    metadata: jsonb('metadata').default({}),
    session_id: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    state_data: jsonb('state_data').notNull().default({}),
    state_type: text('state_type', {
      enum: ['ui', 'chat', 'editor', 'streaming', 'error', 'debug', 'analytics']
    }).notNull(),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' })
  },
  (t) => [
    index('idx_states_user').on(t.user_id),
    index('idx_states_type').on(t.state_type),
    index('idx_states_session').on(t.session_id)
  ]
);

// === ANALYTICS & AUDIT ===

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    conversation_id: uuid('conversation_id'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    event_data: jsonb('event_data').default({}),
    event_type: text('event_type').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    session_id: uuid('session_id'),
    user_id: uuid('user_id').references(() => users.id, { onDelete: 'set null' })
  },
  (t) => [
    index('idx_analytics_type').on(t.event_type, t.created_at),
    index('idx_analytics_user').on(t.user_id)
  ]
);

export const adminAuditLog = pgTable('admin_audit_log', {
  action: text('action').notNull(),
  admin_user_id: uuid('admin_user_id').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  id: uuid('id').primaryKey().defaultRandom(),
  ip_address: text('ip_address'),
  new_value: jsonb('new_value'),
  old_value: jsonb('old_value'),
  resource_id: text('resource_id'),
  resource_type: text('resource_type').notNull(),
  user_agent: text('user_agent')
});

// === ENABLED MODELS ===

export const enabledModels = pgTable(
  'enabled_models',
  {
    category: text('category').notNull().default('General'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    description: text('description'),
    gems_per_message: integer('gems_per_message').notNull().default(2),
    id: uuid('id').primaryKey().defaultRandom(),
    is_enabled: boolean('is_enabled').notNull().default(true),
    is_free: boolean('is_free').notNull().default(false),
    max_tokens: integer('max_tokens').default(4000),
    metadata: jsonb('metadata').default({}),
    model_id: text('model_id').unique().notNull(),
    model_name: text('model_name').notNull(),
    provider: text('provider').notNull().default('openrouter'),
    sort_order: integer('sort_order').default(0),
    tool_support: boolean('tool_support').notNull().default(false),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('idx_enabled_models_provider').on(t.provider),
    index('idx_enabled_models_enabled').on(t.is_enabled),
    index('idx_enabled_models_free').on(t.is_free)
  ]
);

// === DIAGRAM WORKSPACES ===

export const diagramWorkspaces = pgTable(
  'diagram_workspaces',
  {
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    description: text('description'),
    diagram_type: text('diagram_type'),
    document: jsonb('document').notNull().default({}),
    element_count: integer('element_count').notNull().default(0),
    engine: text('engine').notNull().default('mermaid'),
    id: uuid('id').primaryKey().defaultRandom(),
    is_starred: boolean('is_starred').notNull().default(false),
    tags: text('tags')
      .array()
      .default(sql`'{}'`),
    thumbnail_url: text('thumbnail_url'),
    title: text('title').notNull().default('Untitled Workspace'),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
  },
  (t) => [
    index('idx_diagram_workspaces_user').on(t.user_id, t.updated_at),
    index('idx_diagram_workspaces_starred').on(t.user_id, t.is_starred)
  ]
);

// === WORKSPACE FILES ===
//
// Per-user file system: a flat list of rows whose `path` (forward-slash
// hierarchy) is unique per user. Folders are derived from paths — no
// dedicated folder rows. Quotas are enforced server-side at insert time
// (15 for guests, 30 for signed-in users).

export const workspaceFiles = pgTable(
  'workspace_files',
  {
    content: text('content').notNull().default(''),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['md', 'json', 'yaml', 'mermaid'] }).notNull(),
    path: text('path').notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
  },
  (t) => [
    uniqueIndex('idx_workspace_files_user_path').on(t.user_id, t.path),
    index('idx_workspace_files_user').on(t.user_id, t.updated_at)
  ]
);

// === FILE VERSIONS ===

export const fileVersions = pgTable(
  'file_versions',
  {
    content_document: text('content_document').notNull().default(''),
    content_mermaid: text('content_mermaid').notNull().default(''),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    file_id: text('file_id').notNull(),
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: text('user_id').notNull(),
    version: integer('version').notNull()
  },
  (t) => [index('idx_file_versions_file').on(t.file_id, t.version)]
);
