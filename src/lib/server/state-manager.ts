/**
 * Server-side State Manager
 * Manages app states, settings, and provides admin access to state data.
 * Uses the DatabaseAdapter (Neon/Drizzle) instead of direct Supabase calls.
 */

import { getDb } from '$lib/server/db';
import { getCache } from './cache';
import { NeonAdapter } from '$lib/server/db/neon-adapter';
import * as schema from '$lib/server/db/schema';
import { and, asc, desc, eq, gt, gte, sql } from 'drizzle-orm';

// Settings cache helper
const settingsCache = {
  key: (userId: string | null, category: string, key: string) =>
    ['settings', userId || 'global', category, key].filter(Boolean).join(':'),
  async getSetting<T>(userId: string | null, category: string, key: string): Promise<T | null> {
    return getCache().get<T>(this.key(userId, category, key));
  },
  async setSetting<T>(userId: string | null, category: string, key: string, value: T) {
    await getCache().set(this.key(userId, category, key), value, { ttlSeconds: 3600 });
  },
  async invalidateUser(userId: string | null) {
    await getCache().deleteByTag(`settings:${userId || 'global'}`);
  }
};

// ============================================================================
// TYPES
// ============================================================================

export type StateType = 'ui' | 'chat' | 'editor' | 'streaming' | 'error' | 'debug' | 'analytics';

export interface AppState {
  id: string;
  userId: string | null;
  sessionId: string | null;
  stateType: StateType;
  stateData: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface AppSetting {
  id: string;
  userId: string | null;
  category: string;
  key: string;
  value: unknown;
  description: string | null;
  isSensitive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminDashboardStats {
  totalConversations: number;
  totalMessages: number;
  totalUsers: number;
  activeSessions: number;
  cacheEntriesCount: number;
  cacheHitRate: number;
  totalTokensUsed: number;
  estimatedCostUsd: number;
  conversationsToday: number;
  messagesToday: number;
  errorsToday: number;
}

export interface RecentActivity {
  activityType: string;
  activityId: string;
  description: string;
  userId: string | null;
  createdAt: Date;
}

export interface AnalyticsEvent {
  eventType: string;
  userId?: string | null;
  sessionId?: string | null;
  conversationId?: string | null;
  eventData?: Record<string, unknown>;
}

// ============================================================================
// HELPER: get Drizzle db instance from adapter
// ============================================================================

function getDrizzle() {
  const adapter = getDb();
  if (adapter instanceof NeonAdapter) {
    return adapter.db;
  }
  return null;
}

// ============================================================================
// SETTINGS MANAGER
// ============================================================================

export const settingsManager = {
  async get<T>(userId: string | null, category: string, key: string, defaultValue?: T): Promise<T> {
    const cached = await settingsCache.getSetting<T>(userId, category, key);
    if (cached !== null) return cached;

    try {
      const db = getDb();
      if (userId) {
        const value = await db.kvGet(userId, category, key);
        if (value !== null) {
          await settingsCache.setSetting(userId, category, key, value);
          return value as T;
        }
      }
      // Try global setting
      if (userId) {
        return this.get(null, category, key, defaultValue);
      }

      const drizzle = getDrizzle();
      if (drizzle) {
        const [row] = await drizzle
          .select({ value: schema.appSettings.value })
          .from(schema.appSettings)
          .where(
            and(
              sql`${schema.appSettings.user_id} is null`,
              eq(schema.appSettings.category, category),
              eq(schema.appSettings.key, key)
            )
          )
          .orderBy(desc(schema.appSettings.updated_at))
          .limit(1);

        if (row) {
          const raw = row.value as Record<string, unknown>;
          const value = raw && typeof raw === 'object' && '__kv' in raw ? raw.__kv : raw;
          await settingsCache.setSetting(userId, category, key, value);
          return value as T;
        }
      }

      return defaultValue as T;
    } catch {
      return defaultValue as T;
    }
  },

  async set(
    userId: string | null,
    category: string,
    key: string,
    value: unknown,
    _options?: { description?: string; isSensitive?: boolean }
  ): Promise<void> {
    try {
      if (userId) {
        await getDb().kvSet(userId, category, key, value);
      } else {
        const drizzle = getDrizzle();
        if (!drizzle) return;
        const jsonbValue =
          value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value
            : { __kv: value };

        await drizzle
          .delete(schema.appSettings)
          .where(
            and(
              sql`${schema.appSettings.user_id} is null`,
              eq(schema.appSettings.category, category),
              eq(schema.appSettings.key, key)
            )
          );
        await drizzle.insert(schema.appSettings).values({
          category,
          description: _options?.description,
          is_sensitive: _options?.isSensitive ?? false,
          key,
          user_id: null,
          value: jsonbValue as Record<string, unknown>
        });
      }
      await settingsCache.invalidateUser(userId);
    } catch (e) {
      console.error('Failed to set setting:', e);
    }
  },

  async getAll(userId: string | null, category?: string): Promise<AppSetting[]> {
    const drizzle = getDrizzle();
    if (!drizzle) return [];

    try {
      const conditions = [];
      if (userId) {
        conditions.push(eq(schema.appSettings.user_id, userId));
      }
      if (category) {
        conditions.push(eq(schema.appSettings.category, category));
      }

      const rows = await drizzle
        .select()
        .from(schema.appSettings)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(schema.appSettings.category), asc(schema.appSettings.key));

      return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        category: row.category,
        key: row.key,
        value: row.value,
        description: row.description,
        isSensitive: row.is_sensitive ?? false,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at)
      }));
    } catch {
      return [];
    }
  },

  async delete(userId: string | null, category: string, key: string): Promise<boolean> {
    try {
      if (userId) {
        await getDb().kvDelete(userId, category, key);
        await settingsCache.invalidateUser(userId);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  async getGrouped(userId: string | null): Promise<Record<string, AppSetting[]>> {
    const settings = await this.getAll(userId);
    return settings.reduce(
      (acc, setting) => {
        if (!acc[setting.category]) acc[setting.category] = [];
        acc[setting.category].push(setting);
        return acc;
      },
      {} as Record<string, AppSetting[]>
    );
  }
};

// ============================================================================
// STATE MANAGER
// ============================================================================

export const stateManager = {
  async save(state: Omit<AppState, 'id' | 'createdAt'>): Promise<string | null> {
    const drizzle = getDrizzle();
    if (!drizzle) return null;

    try {
      const [row] = await drizzle
        .insert(schema.appStates)
        .values({
          user_id: state.userId,
          session_id: state.sessionId,
          state_type: state.stateType,
          state_data: state.stateData,
          metadata: state.metadata || {},
          expires_at: state.expiresAt
        })
        .returning({ id: schema.appStates.id });
      return row?.id ?? null;
    } catch {
      return null;
    }
  },

  async get(id: string): Promise<AppState | null> {
    const drizzle = getDrizzle();
    if (!drizzle) return null;

    try {
      const [row] = await drizzle
        .select()
        .from(schema.appStates)
        .where(eq(schema.appStates.id, id));
      if (!row) return null;
      return mapAppState(row);
    } catch {
      return null;
    }
  },

  async getBySession(sessionId: string, limit = 100): Promise<AppState[]> {
    const drizzle = getDrizzle();
    if (!drizzle) return [];

    try {
      const rows = await drizzle
        .select()
        .from(schema.appStates)
        .where(eq(schema.appStates.session_id, sessionId))
        .orderBy(desc(schema.appStates.created_at))
        .limit(limit);
      return rows.map(mapAppState);
    } catch {
      return [];
    }
  },

  async getByType(stateType: StateType, limit = 100): Promise<AppState[]> {
    const drizzle = getDrizzle();
    if (!drizzle) return [];

    try {
      const rows = await drizzle
        .select()
        .from(schema.appStates)
        .where(eq(schema.appStates.state_type, stateType))
        .orderBy(desc(schema.appStates.created_at))
        .limit(limit);
      return rows.map(mapAppState);
    } catch {
      return [];
    }
  },

  async logError(
    error: Error | string,
    context: { userId?: string; sessionId?: string; metadata?: Record<string, unknown> } = {}
  ): Promise<string | null> {
    return this.save({
      userId: context.userId || null,
      sessionId: context.sessionId || null,
      stateType: 'error',
      stateData: {
        message: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      },
      metadata: context.metadata || {},
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
  },

  async cleanup(): Promise<number> {
    const drizzle = getDrizzle();
    if (!drizzle) return 0;

    try {
      const result = await drizzle
        .delete(schema.appStates)
        .where(
          and(
            sql`${schema.appStates.expires_at} IS NOT NULL`,
            sql`${schema.appStates.expires_at} < NOW()`
          )
        )
        .returning({ id: schema.appStates.id });
      return result.length;
    } catch {
      return 0;
    }
  }
};

// ============================================================================
// ANALYTICS MANAGER
// ============================================================================

export const analyticsManager = {
  async track(event: AnalyticsEvent): Promise<void> {
    const drizzle = getDrizzle();
    if (!drizzle) return;

    try {
      await drizzle.insert(schema.analyticsEvents).values({
        event_type: event.eventType,
        user_id: event.userId ?? null,
        session_id: event.sessionId ?? null,
        conversation_id: event.conversationId ?? null,
        event_data: event.eventData ?? {}
      });
    } catch (e) {
      console.error('Failed to track event:', e);
    }
  },

  async getByType(eventType: string, limit = 100): Promise<AnalyticsEvent[]> {
    const drizzle = getDrizzle();
    if (!drizzle) return [];

    try {
      const rows = await drizzle
        .select()
        .from(schema.analyticsEvents)
        .where(eq(schema.analyticsEvents.event_type, eventType))
        .orderBy(desc(schema.analyticsEvents.created_at))
        .limit(limit);

      return rows.map((row) => ({
        eventType: row.event_type,
        userId: row.user_id,
        sessionId: row.session_id,
        conversationId: row.conversation_id,
        eventData: row.event_data as Record<string, unknown>
      }));
    } catch {
      return [];
    }
  },

  async getEventCounts(since?: Date): Promise<Record<string, number>> {
    const drizzle = getDrizzle();
    if (!drizzle) return {};

    try {
      const conditions = since ? gte(schema.analyticsEvents.created_at, since) : undefined;

      const rows = await drizzle
        .select({ event_type: schema.analyticsEvents.event_type })
        .from(schema.analyticsEvents)
        .where(conditions);

      return rows.reduce(
        (acc, row) => {
          acc[row.event_type] = (acc[row.event_type] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );
    } catch {
      return {};
    }
  }
};

// ============================================================================
// ADMIN DASHBOARD
// ============================================================================

export const adminDashboard = {
  async getStats(): Promise<AdminDashboardStats> {
    const drizzle = getDrizzle();
    const empty: AdminDashboardStats = {
      totalConversations: 0,
      totalMessages: 0,
      totalUsers: 0,
      activeSessions: 0,
      cacheEntriesCount: 0,
      cacheHitRate: 0,
      totalTokensUsed: 0,
      estimatedCostUsd: 0,
      conversationsToday: 0,
      messagesToday: 0,
      errorsToday: 0
    };
    if (!drizzle) return empty;

    try {
      const [convCount] = await drizzle
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.conversations);
      const [msgCount] = await drizzle
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.messages);
      const [userCount] = await drizzle
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.users);
      const [sessionCount] = await drizzle
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.sessions)
        .where(gt(schema.sessions.expires_at, new Date()));

      const cacheStats = await getCache().getStats();

      return {
        totalConversations: convCount.count,
        totalMessages: msgCount.count,
        totalUsers: userCount.count,
        activeSessions: sessionCount.count,
        cacheEntriesCount: cacheStats.entries,
        cacheHitRate: cacheStats.hitRate,
        totalTokensUsed: 0,
        estimatedCostUsd: 0,
        conversationsToday: 0,
        messagesToday: 0,
        errorsToday: 0
      };
    } catch (e) {
      console.error('Failed to get dashboard stats:', e);
      return empty;
    }
  },

  async getRecentActivity(_limit = 50): Promise<RecentActivity[]> {
    // Simplified — can be expanded later with a SQL function
    return [];
  },

  async getAllConversations(options: { limit?: number; offset?: number } = {}): Promise<any[]> {
    const drizzle = getDrizzle();
    if (!drizzle) return [];
    const { limit = 50, offset = 0 } = options;

    try {
      const rows = await drizzle
        .select()
        .from(schema.conversations)
        .orderBy(desc(schema.conversations.updated_at))
        .limit(limit)
        .offset(offset);
      return rows;
    } catch {
      return [];
    }
  },

  async getAllSettings(): Promise<AppSetting[]> {
    return settingsManager.getAll(null);
  },

  async getErrors(limit = 100): Promise<AppState[]> {
    return stateManager.getByType('error', limit);
  },

  async getCacheInfo() {
    const stats = getCache().getStats();
    return { stats, entries: [] };
  },

  async getConversationMessages(conversationId: string): Promise<any[]> {
    try {
      return await getDb().listMessages(conversationId);
    } catch {
      return [];
    }
  },

  async logAction(
    adminUserId: string | null,
    action: string,
    resourceType: string,
    resourceId?: string,
    details?: { oldValue?: unknown; newValue?: unknown; ipAddress?: string; userAgent?: string }
  ): Promise<void> {
    const drizzle = getDrizzle();
    if (!drizzle) return;

    try {
      await drizzle.insert(schema.adminAuditLog).values({
        admin_user_id: adminUserId,
        action,
        resource_type: resourceType,
        resource_id: resourceId ?? null,
        old_value: details?.oldValue as Record<string, unknown>,
        new_value: details?.newValue as Record<string, unknown>,
        ip_address: details?.ipAddress ?? null,
        user_agent: details?.userAgent ?? null
      });
    } catch (e) {
      console.error('Failed to log admin action:', e);
    }
  }
};

// ============================================================================
// HELPERS
// ============================================================================

function mapAppState(row: typeof schema.appStates.$inferSelect): AppState {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    stateType: row.state_type as StateType,
    stateData: (row.state_data as Record<string, unknown>) ?? {},
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

export { getCache } from './cache';
