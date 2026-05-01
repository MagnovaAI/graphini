-- ============================================================================
-- Graphini - Chat Database Schema
-- ============================================================================
-- This schema supports server-side storage for chat conversations, messages,
-- and diagram snapshots. Designed for PostgreSQL (Supabase recommended).
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- TABLES
-- ============================================================================

-- Conversations table
-- Stores chat conversation metadata
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT, -- For future auth integration, nullable for now
  title TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Constraints
  CONSTRAINT title_length CHECK (char_length(title) <= 200)
);

-- Messages table
-- Stores individual messages within conversations
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  parts JSONB, -- Store message parts (text, files, tool calls, etc.)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Constraints
  CONSTRAINT content_not_empty CHECK (char_length(content) > 0),
  CONSTRAINT content_length CHECK (char_length(content) <= 50000)
);

-- Snapshots table
-- Stores diagram state snapshots for restoration
CREATE TABLE snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  description TEXT,
  state JSONB NOT NULL, -- Serialized diagram state
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT description_length CHECK (char_length(description) <= 500)
);

-- Usage stats table (for cost tracking)
CREATE TABLE usage_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_usd DECIMAL(10, 6),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT tokens_positive CHECK (
    prompt_tokens >= 0 AND 
    completion_tokens >= 0 AND 
    total_tokens >= 0
  )
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Conversations indexes
CREATE INDEX idx_conversations_user ON conversations(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX idx_conversations_created ON conversations(created_at DESC);

-- Messages indexes
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_role ON messages(conversation_id, role);
CREATE INDEX idx_messages_created ON messages(created_at DESC);

-- Snapshots indexes
CREATE INDEX idx_snapshots_conversation ON snapshots(conversation_id, created_at DESC);
CREATE INDEX idx_snapshots_message ON snapshots(message_id) WHERE message_id IS NOT NULL;

-- Usage stats indexes
CREATE INDEX idx_usage_conversation ON usage_stats(conversation_id);
CREATE INDEX idx_usage_created ON usage_stats(created_at DESC);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp on conversations
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversations_updated_at 
  BEFORE UPDATE ON conversations
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();

-- Update conversation updated_at when messages are added
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations 
  SET updated_at = NOW() 
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_conversation_on_message_insert
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_on_message();

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Cleanup old conversations
CREATE OR REPLACE FUNCTION cleanup_old_conversations(days_to_keep INTEGER DEFAULT 30)
RETURNS TABLE(deleted_count INTEGER, freed_space_mb NUMERIC) AS $$
DECLARE
  deleted_count INTEGER;
  freed_space_mb NUMERIC;
BEGIN
  -- Calculate space before deletion
  SELECT 
    pg_total_relation_size('conversations') + 
    pg_total_relation_size('messages') + 
    pg_total_relation_size('snapshots')
  INTO freed_space_mb;
  
  -- Delete old conversations (cascade will delete messages and snapshots)
  WITH deleted AS (
    DELETE FROM conversations
    WHERE updated_at < NOW() - (days_to_keep || ' days')::INTERVAL
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO deleted_count FROM deleted;
  
  -- Calculate space after deletion
  SELECT 
    freed_space_mb - (
      pg_total_relation_size('conversations') + 
      pg_total_relation_size('messages') + 
      pg_total_relation_size('snapshots')
    )
  INTO freed_space_mb;
  
  freed_space_mb := freed_space_mb / (1024 * 1024); -- Convert to MB
  
  RETURN QUERY SELECT deleted_count, freed_space_mb;
END;
$$ LANGUAGE plpgsql;

-- Get conversation statistics
CREATE OR REPLACE FUNCTION get_conversation_stats(conv_id UUID)
RETURNS TABLE(
  message_count INTEGER,
  user_message_count INTEGER,
  assistant_message_count INTEGER,
  snapshot_count INTEGER,
  total_tokens INTEGER,
  estimated_cost_usd NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(DISTINCT m.id)::INTEGER as message_count,
    COUNT(DISTINCT m.id) FILTER (WHERE m.role = 'user')::INTEGER as user_message_count,
    COUNT(DISTINCT m.id) FILTER (WHERE m.role = 'assistant')::INTEGER as assistant_message_count,
    COUNT(DISTINCT s.id)::INTEGER as snapshot_count,
    COALESCE(SUM(u.total_tokens), 0)::INTEGER as total_tokens,
    COALESCE(SUM(u.estimated_cost_usd), 0)::NUMERIC as estimated_cost_usd
  FROM conversations c
  LEFT JOIN messages m ON m.conversation_id = c.id
  LEFT JOIN snapshots s ON s.conversation_id = c.id
  LEFT JOIN usage_stats u ON u.conversation_id = c.id
  WHERE c.id = conv_id
  GROUP BY c.id;
END;
$$ LANGUAGE plpgsql;

-- Check user quota
CREATE OR REPLACE FUNCTION check_user_quota(
  p_user_id TEXT,
  p_max_conversations INTEGER DEFAULT 10,
  p_max_messages_per_conversation INTEGER DEFAULT 100
)
RETURNS TABLE(
  within_quota BOOLEAN,
  conversation_count INTEGER,
  max_conversations INTEGER,
  message_count INTEGER,
  max_messages INTEGER
) AS $$
DECLARE
  conv_count INTEGER;
  msg_count INTEGER;
BEGIN
  -- Count user's conversations
  SELECT COUNT(*) INTO conv_count
  FROM conversations
  WHERE user_id = p_user_id;

  -- Count messages in most recent conversation
  SELECT COUNT(*) INTO msg_count
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.user_id = p_user_id
  ORDER BY c.updated_at DESC
  LIMIT 1;

  RETURN QUERY SELECT
    (conv_count < p_max_conversations AND msg_count < p_max_messages_per_conversation)::BOOLEAN,
    conv_count::INTEGER,
    p_max_conversations::INTEGER,
    msg_count::INTEGER,
    p_max_messages_per_conversation::INTEGER;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- Enable when authentication is added

-- Enable RLS on all tables
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_stats ENABLE ROW LEVEL SECURITY;

-- Policies for conversations (allow all for now, restrict when auth is added)
CREATE POLICY "Allow all operations on conversations" ON conversations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on messages" ON messages
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on snapshots" ON snapshots
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all operations on usage_stats" ON usage_stats
  FOR ALL USING (true) WITH CHECK (true);

-- Future auth policies (commented out, uncomment when auth is added):
/*
-- Users can only see their own conversations
CREATE POLICY "Users can view their own conversations" ON conversations
  FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "Users can create their own conversations" ON conversations
  FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Users can update their own conversations" ON conversations
  FOR UPDATE USING (user_id = auth.uid()::text);

CREATE POLICY "Users can delete their own conversations" ON conversations
  FOR DELETE USING (user_id = auth.uid()::text);

-- Similar policies for messages, snapshots, and usage_stats
*/

-- ============================================================================
-- SAMPLE DATA (for testing)
-- ============================================================================

-- Insert sample conversation
INSERT INTO conversations (id, title) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Sample Conversation')
ON CONFLICT DO NOTHING;

-- Insert sample messages
INSERT INTO messages (conversation_id, role, content, parts) VALUES
  ('00000000-0000-0000-0000-000000000001', 'user', 'Create a flowchart', 
   '[{"type": "text", "text": "Create a flowchart"}]'::jsonb),
  ('00000000-0000-0000-0000-000000000001', 'assistant', 'Here is a flowchart', 
   '[{"type": "text", "text": "```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```"}]'::jsonb)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- MAINTENANCE
-- ============================================================================

-- Schedule cleanup (run via cron or scheduled function)
-- Example: SELECT * FROM cleanup_old_conversations(30);

-- Vacuum and analyze tables periodically
-- VACUUM ANALYZE conversations;
-- VACUUM ANALYZE messages;
-- VACUUM ANALYZE snapshots;

-- ============================================================================
-- MONITORING QUERIES
-- ============================================================================

-- View database size
-- SELECT 
--   pg_size_pretty(pg_database_size(current_database())) as database_size;

-- View table sizes
-- SELECT 
--   schemaname,
--   tablename,
--   pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- View conversation statistics
-- SELECT * FROM get_conversation_stats('00000000-0000-0000-0000-000000000001');

-- View recent activity
-- SELECT 
--   c.id,
--   c.title,
--   c.updated_at,
--   COUNT(m.id) as message_count
-- FROM conversations c
-- LEFT JOIN messages m ON m.conversation_id = c.id
-- GROUP BY c.id
-- ORDER BY c.updated_at DESC
-- LIMIT 10;
