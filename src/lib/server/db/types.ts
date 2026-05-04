/**
 * Database Types - Shared across all adapter implementations
 */

export interface User {
  id: string;
  firebase_uid: string | null;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin' | 'superadmin';
  is_active: boolean;
  email_verified: boolean;
  last_login_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  /** True when the session is anonymous (cookie-only). Not persisted in DB. */
  is_guest?: boolean;
}

export interface Session {
  id: string;
  user_id: string;
  token: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: string;
  created_at: string;
}

export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_public: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CollaborationMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'viewer' | 'editor' | 'admin' | 'owner';
  invited_by: string | null;
  joined_at: string;
}

export interface CreditBalance {
  id: string;
  user_id: string;
  balance: number;
  lifetime_earned: number;
  lifetime_spent: number;
  updated_at: string;
}

export interface ModelPricing {
  id: string;
  model_id: string;
  model_name: string;
  provider: string;
  credits_per_request: number;
  credits_per_1k_input_tokens: number;
  credits_per_1k_output_tokens: number;
  is_free: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  amount: number;
  balance_after: number;
  type: 'purchase' | 'usage' | 'refund' | 'bonus' | 'signup' | 'referral';
  description: string | null;
  model_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string | null;
  workspace_id: string | null;
  title: string | null;
  is_archived: boolean;
  is_pinned: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  parts: unknown | null;
  model_used: string | null;
  tokens_used: number;
  credits_charged: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Snapshot {
  id: string;
  conversation_id: string;
  message_id: string | null;
  description: string | null;
  state: Record<string, unknown>;
  created_at: string;
}

export interface FileRecord {
  id: string;
  user_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  storage_bucket: string;
  created_at: string;
}

export interface UsageStats {
  id: string;
  user_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  credits_charged: number;
  estimated_cost_usd: number;
  created_at: string;
}

export interface CacheEntry {
  key: string;
  value: unknown;
  tags: string[];
  hit_count: number;
  expires_at: string | null;
  created_at: string;
  last_accessed_at: string;
}

export interface DeductCreditsResult {
  success: boolean;
  new_balance: number;
  error_message: string | null;
}

export interface PaginationOptions {
  limit?: number;
  offset?: number;
}

export interface AppState {
  id: string;
  user_id: string | null;
  session_id: string | null;
  state_type: 'ui' | 'chat' | 'editor' | 'streaming' | 'error' | 'debug' | 'analytics';
  state_data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  expires_at: string | null;
  created_at: string;
}

export interface DiagramWorkspaceRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  diagram_type: string | null;
  engine: string;
  is_starred: boolean;
  tags: string[];
  document: Record<string, unknown>;
  element_count: number;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiagramWorkspaceSummaryRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  diagram_type: string | null;
  engine: string;
  mermaid_preview: string | null;
  is_starred: boolean;
  tags: string[];
  element_count: number;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnabledModel {
  id: string;
  model_id: string;
  model_name: string;
  provider: string;
  category: string;
  description: string | null;
  is_free: boolean;
  gems_per_message: number;
  max_tokens: number;
  tool_support: boolean;
  is_enabled: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
