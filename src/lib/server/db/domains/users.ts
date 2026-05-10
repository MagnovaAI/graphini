/**
 * Domain helper — Users & Auth (sessions included)
 */

import { and, desc, eq, gt, ilike, or, sql } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type { PaginationOptions, Session, User } from '../types';
import * as schema from '../schema';

// ── Row Mappers ────────────────────────────────────────────────────────────

export function mapUser(row: typeof schema.users.$inferSelect): User {
  return {
    avatar_url: row.avatar_url,
    created_at: row.created_at.toISOString(),
    display_name: row.display_name,
    email: row.email,
    email_verified: row.email_verified,
    firebase_uid: row.firebase_uid,
    id: row.id,
    ip_address: row.ip_address,
    is_active: row.is_active,
    last_login_at: row.last_login_at?.toISOString() ?? null,
    last_seen_at: row.last_seen_at.toISOString(),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    role: row.role as User['role'],
    updated_at: row.updated_at.toISOString()
  };
}

export function mapSession(row: typeof schema.sessions.$inferSelect): Session {
  return {
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    id: row.id,
    ip_address: row.ip_address,
    token: row.token,
    user_agent: row.user_agent,
    user_id: row.user_id
  };
}

// ── User CRUD ──────────────────────────────────────────────────────────────

export async function createUser(
  db: NeonHttpDatabase<typeof schema>,
  data: { email: string; password_hash: string; display_name?: string }
): Promise<User> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: data.email,
      password_hash: data.password_hash,
      display_name: data.display_name ?? null
    })
    .returning();
  return mapUser(user);
}

export async function getUserById(
  db: NeonHttpDatabase<typeof schema>,
  id: string
): Promise<User | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return user ? mapUser(user) : null;
}

export async function getUserByEmail(
  db: NeonHttpDatabase<typeof schema>,
  email: string
): Promise<User | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  return user ? mapUser(user) : null;
}

export async function getUserByFirebaseUid(
  db: NeonHttpDatabase<typeof schema>,
  firebase_uid: string
): Promise<User | null> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.firebase_uid, firebase_uid));
  return user ? mapUser(user) : null;
}

export async function upsertUserFromFirebase(
  db: NeonHttpDatabase<typeof schema>,
  data: {
    firebase_uid: string;
    email: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
  }
): Promise<User> {
  const [user] = await db
    .insert(schema.users)
    .values({
      avatar_url: data.avatar_url ?? null,
      display_name: data.display_name ?? null,
      email: data.email,
      email_verified: true,
      firebase_uid: data.firebase_uid,
      last_login_at: new Date()
    })
    .onConflictDoUpdate({
      target: schema.users.firebase_uid,
      set: {
        // Upstream wins when it sends a value, DB value wins when upstream
        // sends null. COALESCE(new, old) — `new` is checked first, so a
        // freshly-synced display_name/avatar from magnova-auth overwrites
        // a stale row, but we don't clobber existing data during a sync
        // that didn't include those fields.
        display_name: sql`COALESCE(${data.display_name ?? null}, ${schema.users.display_name})`,
        avatar_url: sql`COALESCE(${data.avatar_url ?? null}, ${schema.users.avatar_url})`,
        last_login_at: new Date()
      }
    })
    .returning();
  return mapUser(user);
}

export async function linkFirebaseUser(
  db: NeonHttpDatabase<typeof schema>,
  id: string,
  data: {
    firebase_uid: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }
): Promise<User> {
  const [user] = await db
    .update(schema.users)
    .set({
      avatar_url: data.avatar_url ?? null,
      display_name: data.display_name ?? null,
      email_verified: true,
      firebase_uid: data.firebase_uid,
      last_login_at: new Date(),
      updated_at: new Date()
    })
    .where(eq(schema.users.id, id))
    .returning();
  return mapUser(user);
}

export async function updateUser(
  db: NeonHttpDatabase<typeof schema>,
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
  const updateData: Record<string, unknown> = {};
  if (data.display_name !== undefined) updateData.display_name = data.display_name;
  if (data.avatar_url !== undefined) updateData.avatar_url = data.avatar_url;
  if (data.role !== undefined) updateData.role = data.role;
  if (data.is_active !== undefined) updateData.is_active = data.is_active;
  if (data.email_verified !== undefined) updateData.email_verified = data.email_verified;
  if (data.last_login_at !== undefined)
    updateData.last_login_at = new Date(data.last_login_at as string);
  if (data.metadata !== undefined) updateData.metadata = data.metadata;

  const [user] = await db
    .update(schema.users)
    .set(updateData)
    .where(eq(schema.users.id, id))
    .returning();
  return mapUser(user);
}

export async function deleteUser(db: NeonHttpDatabase<typeof schema>, id: string): Promise<void> {
  await db.delete(schema.users).where(eq(schema.users.id, id));
}

export async function touchUser(
  db: NeonHttpDatabase<typeof schema>,
  id: string,
  data?: { ip_address?: string }
): Promise<void> {
  const updates: Record<string, unknown> = { last_seen_at: new Date() };
  if (data?.ip_address !== undefined) updates.ip_address = data.ip_address;
  await db.update(schema.users).set(updates).where(eq(schema.users.id, id));
}

const GUEST_FIREBASE_UID_PATTERN = sql`${schema.users.firebase_uid} LIKE 'guest:%'`;

export async function listExpiredGuestUserIds(
  db: NeonHttpDatabase<typeof schema>,
  olderThan: Date
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(GUEST_FIREBASE_UID_PATTERN, sql`${schema.users.last_seen_at} < ${olderThan}`));
  return rows.map((r) => r.id);
}

/**
 * Re-parent every row owned by `fromUserId` to `toUserId`, then delete
 * `fromUserId`. Tables touched (in dependency order, safe under FK cascades):
 *   conversations.user_id, workspaces.owner_id, diagram_workspaces.user_id,
 *   files.user_id, app_settings.user_id, usage_stats.user_id,
 *   credit_transactions.user_id, credit_balances.user_id (merged additively).
 *
 * Note: Neon HTTP serverless does NOT support multi-statement transactions,
 * so we run each statement sequentially and accept eventual consistency in the
 * extremely rare case of a mid-merge failure. If you need full atomicity,
 * promote this to a stored procedure or run via a pooled connection.
 */
export async function mergeUsers(
  db: NeonHttpDatabase<typeof schema>,
  fromUserId: string,
  toUserId: string
): Promise<void> {
  if (fromUserId === toUserId) return;

  await db
    .update(schema.conversations)
    .set({ user_id: toUserId })
    .where(eq(schema.conversations.user_id, fromUserId));

  await db
    .update(schema.workspaces)
    .set({ owner_id: toUserId })
    .where(eq(schema.workspaces.owner_id, fromUserId));

  await db
    .update(schema.diagramWorkspaces)
    .set({ user_id: toUserId })
    .where(eq(schema.diagramWorkspaces.user_id, fromUserId));

  // workspace_files has unique (user_id, path). Keep same paths when the
  // target account does not have them; put conflicts under a deterministic
  // imported folder so neither side is lost.
  await db.execute(sql`
    UPDATE workspace_files AS guest
    SET
      user_id = ${toUserId},
      path = CASE
        WHEN EXISTS (
          SELECT 1 FROM workspace_files AS target
          WHERE target.user_id = ${toUserId}
            AND target.path = guest.path
        )
          THEN 'Imported from guest/' || left(guest.id::text, 8) || '/' || guest.path
        ELSE guest.path
      END
    WHERE guest.user_id = ${fromUserId};
  `);

  await db
    .update(schema.files)
    .set({ user_id: toUserId })
    .where(eq(schema.files.user_id, fromUserId));

  await db
    .update(schema.usageStats)
    .set({ user_id: toUserId })
    .where(eq(schema.usageStats.user_id, fromUserId));

  await db
    .update(schema.creditTransactions)
    .set({ user_id: toUserId })
    .where(eq(schema.creditTransactions.user_id, fromUserId));

  // app_settings has unique (user_id, category, key). Move same-key conflicts
  // under a deterministic guest suffix instead of dropping them.
  await db.execute(sql`
    UPDATE app_settings AS guest
    SET
      user_id = ${toUserId},
      key = CASE
        WHEN EXISTS (
          SELECT 1 FROM app_settings AS target
          WHERE target.user_id = ${toUserId}
            AND target.category = guest.category
            AND target.key = guest.key
        )
          THEN guest.key || '__guest_' || left(guest.id::text, 8)
        ELSE guest.key
      END
    WHERE guest.user_id = ${fromUserId};
  `);

  // Credit balance: add the guest's balance into the target's, then drop the
  // guest balance row. Single row per user_id (unique constraint).
  await db.execute(sql`
    INSERT INTO credit_balances (user_id, balance, lifetime_earned, lifetime_spent)
    SELECT ${toUserId}, balance, lifetime_earned, lifetime_spent
    FROM credit_balances WHERE user_id = ${fromUserId}
    ON CONFLICT (user_id) DO UPDATE SET
      balance = credit_balances.balance + EXCLUDED.balance,
      lifetime_earned = credit_balances.lifetime_earned + EXCLUDED.lifetime_earned,
      lifetime_spent = credit_balances.lifetime_spent + EXCLUDED.lifetime_spent,
      updated_at = NOW();
    DELETE FROM credit_balances WHERE user_id = ${fromUserId};
  `);

  // Sessions and analytics: cascade or set-null per their FK definitions when
  // we delete the user row.
  await db.delete(schema.users).where(eq(schema.users.id, fromUserId));
}

export async function listUsers(
  db: NeonHttpDatabase<typeof schema>,
  options?: PaginationOptions & { search?: string }
): Promise<{ users: User[]; total: number }> {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  let where = undefined;
  if (options?.search) {
    const pattern = `%${options.search}%`;
    where = or(ilike(schema.users.email, pattern), ilike(schema.users.display_name, pattern));
  }

  const rows = await db
    .select()
    .from(schema.users)
    .where(where)
    .orderBy(desc(schema.users.created_at))
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(where);

  return { users: rows.map((r) => mapUser(r)), total: count };
}

// ── Sessions ───────────────────────────────────────────────────────────────

export async function createSession(
  db: NeonHttpDatabase<typeof schema>,
  data: {
    user_id: string;
    token: string;
    expires_at: string;
    ip_address?: string;
    user_agent?: string;
  }
): Promise<Session> {
  const [session] = await db
    .insert(schema.sessions)
    .values({
      expires_at: new Date(data.expires_at),
      ip_address: data.ip_address ?? null,
      token: data.token,
      user_agent: data.user_agent ?? null,
      user_id: data.user_id
    })
    .returning();
  return mapSession(session);
}

export async function getSessionByToken(
  db: NeonHttpDatabase<typeof schema>,
  token: string
): Promise<Session | null> {
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.token, token), gt(schema.sessions.expires_at, new Date())));
  return session ? mapSession(session) : null;
}

export async function deleteSession(
  db: NeonHttpDatabase<typeof schema>,
  id: string
): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
}

export async function deleteUserSessions(
  db: NeonHttpDatabase<typeof schema>,
  user_id: string
): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.user_id, user_id));
}

export async function cleanupExpiredSessions(db: NeonHttpDatabase<typeof schema>): Promise<number> {
  const result = await db
    .delete(schema.sessions)
    .where(sql`${schema.sessions.expires_at} < NOW()`)
    .returning({ id: schema.sessions.id });
  return result.length;
}
