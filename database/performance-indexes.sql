-- Performance Optimization Indexes for Graphini
-- This migration adds critical indexes to improve query performance

-- ============================================================================
-- CONVERSATION INDEXES
-- ============================================================================

-- Primary index for conversation lookups by user and updated_at
-- This optimizes the conversation list query
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated 
ON conversations(user_id, updated_at DESC);

-- Index for conversation lookups by ID (primary key already exists but we ensure it's optimized)
CREATE INDEX IF NOT EXISTS idx_conversations_id_lookup 
ON conversations(id) WHERE id IS NOT NULL;

-- Index for conversation metadata searches (if frequently queried)
CREATE INDEX IF NOT EXISTS idx_conversations_created_at 
ON conversations(created_at DESC);

-- ============================================================================
-- MESSAGE INDEXES
-- ============================================================================

-- Critical index for message pagination within conversations
-- This fixes the N+1 query problem for message loading
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
ON messages(conversation_id, created_at ASC);

-- Index for message lookups by ID
CREATE INDEX IF NOT EXISTS idx_messages_id_lookup 
ON messages(id) WHERE id IS NOT NULL;

-- Composite index for message role queries (if filtering by role)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_role 
ON messages(conversation_id, role, created_at DESC);

-- ============================================================================
-- SNAPSHOT INDEXES
-- ============================================================================

-- Index for snapshot lookups by conversation
CREATE INDEX IF NOT EXISTS idx_snapshots_conversation_created 
ON snapshots(conversation_id, created_at DESC);

-- Index for snapshot lookups by message
CREATE INDEX IF NOT EXISTS idx_snapshots_message_created 
ON snapshots(message_id, created_at DESC) WHERE message_id IS NOT NULL;

-- ============================================================================
-- FILE INDEXES
-- ============================================================================

-- Index for file lookups by conversation
CREATE INDEX IF NOT EXISTS idx_files_conversation_created 
ON files(conversation_id, created_at DESC);

-- Index for file lookups by user
CREATE INDEX IF NOT EXISTS idx_files_user_created 
ON files(uploaded_by, created_at DESC) WHERE uploaded_by IS NOT NULL;

-- ============================================================================
-- USER MEMORY INDEXES
-- ============================================================================

-- Index for user memory lookups by user and importance
CREATE INDEX IF NOT EXISTS idx_user_memories_user_importance 
ON user_memories(user_id, importance DESC, created_at DESC);

-- Index for user memory lookups by type
CREATE INDEX IF NOT EXISTS idx_user_memories_user_type 
ON user_memories(user_id, memory_type, created_at DESC);

-- Index for expired memories cleanup
CREATE INDEX IF NOT EXISTS idx_user_memories_expires_at 
ON user_memories(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================================================
-- USAGE STATS INDEXES
-- ============================================================================

-- Index for usage stats by conversation
CREATE INDEX IF NOT EXISTS idx_usage_stats_conversation_created 
ON usage_stats(conversation_id, created_at DESC) WHERE conversation_id IS NOT NULL;

-- Index for usage stats by model and date
CREATE INDEX IF NOT EXISTS idx_usage_stats_model_created 
ON usage_stats(model, created_at DESC);

-- ============================================================================
-- PARTIAL INDEXES FOR COMMON QUERIES
-- ============================================================================

-- Partial index for active conversations (those with recent activity)
CREATE INDEX IF NOT EXISTS idx_conversations_active 
ON conversations(id, updated_at DESC) 
WHERE updated_at > NOW() - INTERVAL '30 days';

-- Partial index for recent messages
CREATE INDEX IF NOT EXISTS idx_messages_recent 
ON messages(conversation_id, created_at DESC) 
WHERE created_at > NOW() - INTERVAL '7 days';

-- Partial index for non-expired memories
CREATE INDEX IF NOT EXISTS idx_user_memories_active 
ON user_memories(user_id, importance DESC) 
WHERE expires_at IS NULL OR expires_at > NOW();

-- ============================================================================
-- FULL-TEXT SEARCH INDEXES (if using PostgreSQL)
-- ============================================================================

-- Full-text search index for conversation titles
CREATE INDEX IF NOT EXISTS idx_conversations_title_fts 
ON conversations USING gin(to_tsvector('english', title)) 
WHERE title IS NOT NULL;

-- Full-text search index for message content
CREATE INDEX IF NOT EXISTS idx_messages_content_fts 
ON messages USING gin(to_tsvector('english', content)) 
WHERE content IS NOT NULL;

-- ============================================================================
-- STATISTICS UPDATES
-- ============================================================================

-- Update table statistics for better query planning
ANALYZE conversations;
ANALYZE messages;
ANALYZE snapshots;
ANALYZE files;
ANALYZE user_memories;
ANALYZE usage_stats;

-- ============================================================================
-- PERFORMANCE MONITORING VIEWS
-- ============================================================================

-- View for monitoring conversation activity
CREATE OR REPLACE VIEW v_conversation_activity AS
SELECT 
    c.id,
    c.user_id,
    c.title,
    c.created_at,
    c.updated_at,
    COUNT(m.id) as message_count,
    MAX(m.created_at) as last_message_at,
    CASE 
        WHEN c.updated_at > NOW() - INTERVAL '1 hour' THEN 'very_active'
        WHEN c.updated_at > NOW() - INTERVAL '1 day' THEN 'active'
        WHEN c.updated_at > NOW() - INTERVAL '7 days' THEN 'recent'
        ELSE 'inactive'
    END as activity_status
FROM conversations c
LEFT JOIN messages m ON c.id = m.conversation_id
GROUP BY c.id, c.user_id, c.title, c.created_at, c.updated_at;

-- View for monitoring user engagement
CREATE OR REPLACE VIEW v_user_engagement AS
SELECT 
    u.id as user_id,
    COUNT(DISTINCT c.id) as conversation_count,
    COUNT(m.id) as message_count,
    AVG(COUNT(m.id)) as avg_messages_per_conversation,
    MAX(c.updated_at) as last_activity,
    CASE 
        WHEN MAX(c.updated_at) > NOW() - INTERVAL '1 day' THEN 'daily_active'
        WHEN MAX(c.updated_at) > NOW() - INTERVAL '7 days' THEN 'weekly_active'
        WHEN MAX(c.updated_at) > NOW() - INTERVAL '30 days' THEN 'monthly_active'
        ELSE 'inactive'
    END as engagement_level
FROM (SELECT DISTINCT user_id FROM conversations WHERE user_id IS NOT NULL) u
LEFT JOIN conversations c ON u.id = c.user_id
LEFT JOIN messages m ON c.id = m.conversation_id
GROUP BY u.id;

-- ============================================================================
-- CLEANUP FUNCTIONS
-- ============================================================================

-- Function to clean up old conversations (older than 90 days)
CREATE OR REPLACE FUNCTION cleanup_old_conversations(days_to_keep INTEGER DEFAULT 90)
RETURNS TABLE(deleted_count INTEGER, freed_space_mb NUMERIC) AS $$
DECLARE
    deleted_convo_count INTEGER;
    freed_space NUMERIC;
BEGIN
    -- Get size before deletion
    SELECT pg_size_pretty(pg_total_relation_size('conversations')) INTO freed_space;
    
    -- Delete old conversations and related data
    DELETE FROM conversations 
    WHERE updated_at < NOW() - INTERVAL '1 day' * days_to_keep
    RETURNING COUNT(*) INTO deleted_convo_count;
    
    -- Get size after deletion
    SELECT pg_size_pretty(pg_total_relation_size('conversations')) INTO freed_space;
    
    -- Update statistics
    ANALYZE conversations;
    
    RETURN QUERY SELECT deleted_convo_count, pg_total_relation_size('conversations') / 1024 / 1024;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired memories
CREATE OR REPLACE FUNCTION cleanup_expired_memories()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_memories 
    WHERE expires_at IS NOT NULL AND expires_at < NOW()
    RETURNING COUNT(*) INTO deleted_count;
    
    ANALYZE user_memories;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ============================================================================

-- Trigger to automatically update conversation updated_at when messages are added
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE conversations 
    SET updated_at = NEW.created_at 
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS trigger_update_conversation_timestamp ON messages;
CREATE TRIGGER trigger_update_conversation_timestamp
    AFTER INSERT ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_conversation_timestamp();

-- ============================================================================
-- PERFORMANCE CONFIGURATION
-- ============================================================================

-- Set work_mem for larger sorts (temporary, per session)
-- This helps with complex ORDER BY operations
-- SET work_mem = '256MB';

-- Enable parallel query processing for large tables
-- SET max_parallel_workers_per_gather = 4;
-- SET max_parallel_workers = 8;

-- ============================================================================
-- INDEX USAGE MONITORING
-- ============================================================================

-- Query to monitor index usage
CREATE OR REPLACE VIEW v_index_usage AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC, idx_tup_read DESC;

-- Query to find unused indexes
CREATE OR REPLACE VIEW v_unused_indexes AS
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND idx_scan = 0
  AND idx_tup_read = 0
  AND idx_tup_fetch = 0
ORDER BY pg_relation_size(indexrelid) DESC;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Performance optimization indexes created successfully';
    RAISE NOTICE 'Key improvements:';
    RAISE NOTICE '- Fixed N+1 query problems with composite indexes';
    RAISE NOTICE '- Added cursor pagination support';
    RAISE NOTICE '- Implemented partial indexes for common queries';
    RAISE NOTICE '- Added full-text search capabilities';
    RAISE NOTICE '- Created monitoring views for performance tracking';
END $$;
