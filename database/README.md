# Database Setup Guide

This guide will help you set up the database for server-side chat storage.

## Quick Start (Recommended: Supabase)

### 1. Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in
3. Click "New Project"
4. Choose organization and fill in:
   - **Project name**: `graphini`
   - **Database password**: (generate strong password)
   - **Region**: Choose closest to your users
   - **Pricing plan**: Free tier is sufficient for development

### 2. Run Database Schema

1. In your Supabase project, go to **SQL Editor**
2. Click "New Query"
3. Copy the contents of `database/schema.sql`
4. Paste and click "Run"
5. Verify tables were created in **Table Editor**

### 3. Get API Credentials

1. Go to **Project Settings** → **API**
2. Copy these values:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGc...`
   - **service_role key**: `eyJhbGc...` (keep secret!)

### 4. Configure Environment Variables

Add to your `.env` file:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Chat Configuration
CHAT_MAX_CONVERSATIONS_PER_USER=10
CHAT_MAX_MESSAGES_PER_CONVERSATION=100
CHAT_CLEANUP_DAYS=30
```

### 5. Install Dependencies

```bash
pnpm add @supabase/supabase-js
```

### 6. Test Connection

Create a test file `test-db.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function test() {
  const { data, error } = await supabase.from('conversations').select('*').limit(1);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Success! Found conversations:', data);
  }
}

test();
```

Run: `tsx test-db.ts`

## Alternative: Managed PostgreSQL

Use any hosted PostgreSQL database that can provide a standard connection string, such as Supabase, Neon, or Vercel Postgres.

### Environment Variables

```bash
DATABASE_URL=postgresql://user:password@host:5432/graphini
```

Apply the checked-in SQL files from the project root:

```bash
psql "$DATABASE_URL" -f database/schema.sql
psql "$DATABASE_URL" -f database/performance-indexes.sql
```

### Install Dependencies

```bash
pnpm add pg
# or
pnpm add @vercel/postgres
```

## Database Schema Overview

### Tables

1. **conversations**

   - Stores chat conversation metadata
   - Fields: id, user_id, title, created_at, updated_at, metadata

2. **messages**

   - Stores individual messages
   - Fields: id, conversation_id, role, content, parts, created_at, metadata

3. **snapshots**

   - Stores diagram state snapshots
   - Fields: id, conversation_id, message_id, description, state, created_at

4. **usage_stats**
   - Tracks token usage and costs
   - Fields: id, conversation_id, message_id, model, tokens, cost, created_at

### Key Features

- **Automatic timestamps**: `created_at` and `updated_at` managed by triggers
- **Cascade deletes**: Deleting a conversation removes all related data
- **Indexes**: Optimized for common queries
- **Constraints**: Data validation at database level
- **Functions**: Built-in cleanup and statistics functions

## Maintenance

### Cleanup Old Data

```sql
-- Delete conversations older than 30 days
SELECT * FROM cleanup_old_conversations(30);
```

### View Statistics

```sql
-- Get stats for a conversation
SELECT * FROM get_conversation_stats('conversation-uuid-here');

-- View database size
SELECT pg_size_pretty(pg_database_size(current_database()));

-- View table sizes
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size('public.'||tablename) DESC;
```

### Scheduled Cleanup

#### Supabase (using Edge Functions)

Create a Supabase Edge Function:

```typescript
// supabase/functions/cleanup/index.ts
import { createClient } from '@supabase/supabase-js';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data, error } = await supabase.rpc('cleanup_old_conversations', { days_to_keep: 30 });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ success: true, ...data }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

Schedule via cron: `0 0 * * *` (daily at midnight)

## Security

### Row Level Security (RLS)

The schema includes RLS policies. Currently set to allow all operations.

When you add authentication:

1. Uncomment the auth-based policies in `schema.sql`
2. Update policies to use `auth.uid()`
3. Test with different users

### Best Practices

1. **Never expose service_role key** to client
2. **Use anon key** for client-side operations
3. **Validate input** at API level (already done)
4. **Rate limit** database operations
5. **Monitor** query performance
6. **Backup** regularly (Supabase does this automatically)

## Monitoring

### Supabase Dashboard

- **Database**: View tables, run queries
- **API**: Monitor API usage
- **Logs**: View real-time logs
- **Performance**: Query performance insights

### Custom Monitoring

```sql
-- Slow queries
SELECT
  query,
  calls,
  total_time,
  mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- Active connections
SELECT count(*) FROM pg_stat_activity;

-- Table bloat
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  n_live_tup,
  n_dead_tup
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Troubleshooting

### Connection Issues

```typescript
// Test connection
const { data, error } = await supabase.from('conversations').select('count');

if (error) {
  console.error('Connection error:', error);
  // Check: URL, API keys, network, firewall
}
```

### Migration Issues

```sql
-- Check if tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Check if functions exist
SELECT proname FROM pg_proc WHERE proname LIKE 'cleanup%';

-- Drop and recreate if needed
DROP TABLE IF EXISTS conversations CASCADE;
-- Then re-run schema.sql
```

### Performance Issues

```sql
-- Rebuild indexes
REINDEX TABLE conversations;
REINDEX TABLE messages;

-- Vacuum tables
VACUUM ANALYZE conversations;
VACUUM ANALYZE messages;

-- Update statistics
ANALYZE;
```

## Cost Estimation

### Supabase Free Tier

- **Database**: 500MB
- **Bandwidth**: 2GB/month
- **API requests**: Unlimited

### Estimated Usage

- Average conversation: ~50KB (50 messages × 1KB)
- 500MB = ~10,000 conversations
- With 30-day cleanup: sustainable for moderate usage

### Paid Tier ($25/month)

- **Database**: 8GB
- **Bandwidth**: 50GB/month
- **Backups**: Point-in-time recovery
- **Support**: Email support

## Next Steps

1. ✅ Set up database (you are here)
2. ⏭️ Create API endpoints (`/src/routes/api/chat/conversations/`)
3. ⏭️ Create database client (`/src/lib/server/db.ts`)
4. ⏭️ Update Chat component to use API
5. ⏭️ Add conversation management UI
6. ⏭️ Test and deploy

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
