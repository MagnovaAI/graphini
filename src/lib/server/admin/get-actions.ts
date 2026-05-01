import { getDb } from '$lib/server/db';
import {
  adminDashboard,
  analyticsManager,
  settingsManager,
  stateManager,
  type StateType
} from '$lib/server/state-manager';
import { json } from '@sveltejs/kit';

const ALLOWED_TABLES = [
  'users',
  'sessions',
  'workspaces',
  'credit_balances',
  'credit_transactions',
  'model_pricing',
  'enabled_models',
  'conversations',
  'messages',
  'usage_stats',
  'cache_entries',
  'app_settings'
] as const;

export async function handleAdminGet(url: URL) {
  const action = url.searchParams.get('action') || 'stats';
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  switch (action) {
    case 'stats': {
      const stats = await adminDashboard.getStats();
      return json({ success: true, data: stats });
    }

    case 'conversations': {
      const conversations = await adminDashboard.getAllConversations({ limit, offset });
      return json({ success: true, data: conversations });
    }

    case 'conversation_messages': {
      const conversationId = url.searchParams.get('conversationId');
      if (!conversationId) {
        return json({ success: false, error: 'conversationId required' }, { status: 400 });
      }
      const messages = await adminDashboard.getConversationMessages(conversationId);
      return json({ success: true, data: messages });
    }

    case 'activity': {
      const activity = await adminDashboard.getRecentActivity(limit);
      return json({ success: true, data: activity });
    }

    case 'settings': {
      const category = url.searchParams.get('category');
      const userId = url.searchParams.get('userId');
      const settings = category
        ? await settingsManager.getAll(userId, category)
        : await settingsManager.getGrouped(userId);
      return json({ success: true, data: settings });
    }

    case 'errors': {
      const errors = await adminDashboard.getErrors(limit);
      return json({ success: true, data: errors });
    }

    case 'states': {
      const stateType = url.searchParams.get('type');
      const sessionId = url.searchParams.get('sessionId');
      let states;
      if (sessionId) {
        states = await stateManager.getBySession(sessionId, limit);
      } else if (stateType) {
        states = await stateManager.getByType(stateType as StateType, limit);
      } else {
        states = await stateManager.getByType('debug', limit);
      }
      return json({ success: true, data: states });
    }

    case 'cache': {
      const cacheInfo = await adminDashboard.getCacheInfo();
      return json({ success: true, data: cacheInfo });
    }

    case 'analytics': {
      const eventType = url.searchParams.get('eventType');
      const since = url.searchParams.get('since');
      if (eventType) {
        const events = await analyticsManager.getByType(eventType, limit);
        return json({ success: true, data: events });
      }

      const counts = await analyticsManager.getEventCounts(since ? new Date(since) : undefined);
      return json({ success: true, data: counts });
    }

    case 'models': {
      const db = getDb();
      const allModels = await db.listEnabledModels(false);
      return json({ success: true, data: allModels });
    }

    case 'providers': {
      const providers = await settingsManager.getAll(null, 'providers');
      return json({ success: true, data: providers });
    }

    case 'users': {
      const search = url.searchParams.get('search') || undefined;
      const db = getDb();
      const result = await db.listUsers({ limit, offset, search });
      const usersWithCredits = await Promise.all(
        result.users.map(async (user) => {
          const balance = await db.getCreditBalance(user.id);
          return {
            ...user,
            credits: balance ? balance.balance : 0,
            lifetime_earned: balance?.lifetime_earned || 0,
            lifetime_spent: balance?.lifetime_spent || 0
          };
        })
      );
      return json({ success: true, data: { users: usersWithCredits, total: result.total } });
    }

    case 'user_details': {
      const userId = url.searchParams.get('userId');
      if (!userId) return json({ success: false, error: 'userId required' }, { status: 400 });
      const db = getDb();
      const user = await db.getUserById(userId);
      if (!user) return json({ success: false, error: 'User not found' }, { status: 404 });
      const balance = await db.getCreditBalance(userId);
      const transactions = await db.getCreditTransactions(userId, { limit: 50 });
      const conversations = await db.listConversations({ user_id: userId, limit: 20 });
      return json({ success: true, data: { user, balance, transactions, conversations } });
    }

    case 'openrouter_models': {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/models?supported_parameters=tools');
        if (!res.ok) throw new Error(`OpenRouter API error: ${res.status}`);
        const data = await res.json();
        return json({ success: true, data: data.data || [] });
      } catch (e) {
        return json(
          {
            success: false,
            error: e instanceof Error ? e.message : 'Failed to fetch OpenRouter models'
          },
          { status: 500 }
        );
      }
    }

    case 'app_data': {
      const db = getDb();
      try {
        const client = (db as unknown as { client?: unknown }).client as
          | {
              from: (table: string) => {
                select: (columns: string) => {
                  order: (
                    column: string,
                    options: { ascending: boolean }
                  ) => { limit: (count: number) => Promise<{ data?: unknown[]; error?: Error }> };
                };
              };
            }
          | undefined;
        if (!client) {
          return json({ success: false, error: 'Direct DB access not available' }, { status: 500 });
        }
        const { data: rows, error: dbErr } = await client
          .from('app_settings')
          .select('user_id, category, key, value, updated_at')
          .order('updated_at', { ascending: false })
          .limit(500);
        if (dbErr) throw new Error(dbErr.message);
        return json({
          success: true,
          data: (rows || []).map((r) => {
            const row = r as Record<string, unknown>;
            return {
              category: row.category,
              key: row.key,
              updated_at: row.updated_at,
              user_id: row.user_id,
              value: row.value
            };
          })
        });
      } catch (e) {
        return json(
          { success: false, error: e instanceof Error ? e.message : 'Failed to load app data' },
          { status: 500 }
        );
      }
    }

    case 'db_table': {
      const table = url.searchParams.get('table');
      if (!table) return json({ success: false, error: 'table required' }, { status: 400 });
      if (!ALLOWED_TABLES.includes(table as (typeof ALLOWED_TABLES)[number])) {
        return json({ success: false, error: 'Table not allowed' }, { status: 400 });
      }
      try {
        const db = getDb();
        const { rows, total } = await db.adminBrowseTable(table, { limit, offset });
        return json({ success: true, data: { rows, total } });
      } catch (e) {
        return json(
          { success: false, error: e instanceof Error ? e.message : 'DB query failed' },
          { status: 500 }
        );
      }
    }

    default:
      return json({ success: false, error: 'Invalid action' }, { status: 400 });
  }
}
