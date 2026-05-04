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
    is_active: row.is_active,
    last_login_at: row.last_login_at?.toISOString() ?? null,
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
        display_name: sql`COALESCE(${data.display_name ?? null}, ${schema.users.display_name})`,
        avatar_url: sql`COALESCE(${data.avatar_url ?? null}, ${schema.users.avatar_url})`,
        last_login_at: new Date()
      }
    })
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
