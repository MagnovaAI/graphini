/**
 * Workspace files — CRUD for the per-user file tree.
 *
 * - Flat list: each row owns a forward-slash `path` ("notes/foo.md"); folders
 *   are derived client-side from the path strings, no folder rows.
 * - Quotas: 15 files for guest users, 30 for signed-in users; checked before
 *   insert. Updates and renames don't count against quota.
 * - Allowed kinds: md, json, yaml, mermaid. Determined from extension.
 */

import { validateSessionOrGuest } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import type { NeonAdapter } from '$lib/server/db/neon-adapter';
import { workspaceFiles } from '$lib/server/db/schema';
import { apiLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { PATH_RE, deriveKind } from '$lib/server/workspace-paths';
import { json } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const drizzleDb = () => (getDb() as NeonAdapter).db;

const GUEST_QUOTA = 15;
const USER_QUOTA = 30;

function quotaFor(user: { is_guest?: boolean | null }): number {
  return user.is_guest ? GUEST_QUOTA : USER_QUOTA;
}

const createSchema = z.object({
  path: z.string().min(1).max(200).optional(),
  content: z.string().default('')
});

const DEFAULT_NAME_RE = /^Untitled(?: (\d+))?\.mermaid$/;

/**
 * Pick the next free `Untitled[N].mermaid` for this user.
 * Done in the same connection so two concurrent POSTs see each other's
 * inserts via the unique-path index — the second loses to a 409 and the
 * client retries.
 */
async function nextDefaultName(db: ReturnType<typeof drizzleDb>, userId: string): Promise<string> {
  const rows = await db
    .select({ path: workspaceFiles.path })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.user_id, userId));
  let max = 0;
  let hasFirst = false;
  for (const r of rows as { path: string }[]) {
    const m = DEFAULT_NAME_RE.exec(r.path);
    if (!m) continue;
    if (m[1] === undefined) {
      hasFirst = true;
      if (max < 1) max = 1;
    } else {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  if (!hasFirst) return 'Untitled.mermaid';
  return `Untitled ${max + 1}.mermaid`;
}

/** GET /api/workspace-files — flat list of files for the current user. */
export const GET: RequestHandler = async ({ request }) => {
  const rl = apiLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await drizzleDb()
    .select({
      content: workspaceFiles.content,
      created_at: workspaceFiles.created_at,
      id: workspaceFiles.id,
      kind: workspaceFiles.kind,
      path: workspaceFiles.path,
      updated_at: workspaceFiles.updated_at
    })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.user_id, user.id))
    .orderBy(asc(workspaceFiles.path));

  return json({
    files: rows.map(
      (r: {
        id: string;
        path: string;
        kind: string;
        content: string;
        created_at: Date;
        updated_at: Date;
      }) => ({
        ...r,
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString()
      })
    ),
    quota: { used: rows.length, total: quotaFor(user) }
  });
};

/** POST /api/workspace-files — create a new file. */
export const POST: RequestHandler = async ({ request }) => {
  const rl = apiLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }
  const { content } = parsed.data;
  const db = drizzleDb();

  // Quota: count existing files for this user.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.user_id, user.id));
  const cap = quotaFor(user);
  if (count >= cap) {
    return json(
      { error: `File quota reached (${count}/${cap}). Delete a file to make room.` },
      { status: 409 }
    );
  }

  const path = parsed.data.path ?? (await nextDefaultName(db, user.id));

  if (!PATH_RE.test(path)) {
    return json(
      { error: 'Invalid path. Use letters, digits, dot, dash, underscore, slash.' },
      { status: 400 }
    );
  }
  const kind = deriveKind(path);
  if (!kind) {
    return json(
      { error: 'Unsupported file kind. Allowed: .md, .json, .yaml/.yml, .mermaid/.mmd' },
      { status: 400 }
    );
  }

  try {
    const [inserted] = await db
      .insert(workspaceFiles)
      .values({ user_id: user.id, path, kind, content })
      .returning();
    return json(
      {
        content: inserted.content,
        created_at: inserted.created_at.toISOString(),
        id: inserted.id,
        kind: inserted.kind,
        path: inserted.path,
        updated_at: inserted.updated_at.toISOString()
      },
      { status: 201 }
    );
  } catch (err) {
    // Drizzle wraps the real Postgres error in `err.cause`; the outer message
    // is just "Failed query: INSERT ...". Surface the cause so we can tell the
    // difference between a unique-violation, FK miss, missing-table, etc.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null;
    const causeMsg = cause?.message ?? '';
    const wrapperMsg = err instanceof Error ? err.message : 'Unknown error';
    const combined = causeMsg || wrapperMsg;
    console.error('[workspace-files POST] insert failed', {
      cause: causeMsg,
      code: (cause as { code?: string } | null)?.code,
      detail: (cause as { detail?: string } | null)?.detail,
      kind,
      path,
      userId: user.id,
      wrapper: wrapperMsg
    });
    if (combined.includes('idx_workspace_files_user_path') || combined.includes('duplicate')) {
      return json({ error: 'A file with that path already exists.' }, { status: 409 });
    }
    if (combined.includes('foreign key') || combined.includes('violates foreign key')) {
      return json({ error: 'Your account session is stale. Sign in again.' }, { status: 401 });
    }
    if (combined.includes('relation "workspace_files" does not exist')) {
      return json(
        { error: 'workspace_files table is missing — run the latest DB migration.' },
        { status: 500 }
      );
    }
    return json({ error: combined }, { status: 500 });
  }
};
