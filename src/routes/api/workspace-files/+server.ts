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
import { getDrizzle } from '$lib/server/db';
import { workspaceFiles } from '$lib/server/db/schema';
import { apiLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { PATH_RE, deriveKind } from '$lib/server/workspace-paths';
import { validateContentForKind } from '$lib/server/workspace-content-validation';
import { json } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const drizzleDb = () => {
  const db = getDrizzle();
  if (!db) throw new Error('Workspace files require a Drizzle-backed database adapter.');
  return db;
};

const GUEST_QUOTA = 15;
const USER_QUOTA = 30;

function quotaFor(user: { is_guest?: boolean | null }): number {
  return user.is_guest ? GUEST_QUOTA : USER_QUOTA;
}

const createSchema = z.object({
  path: z.string().min(1).max(200).optional(),
  content: z.string().default('')
});

const DEFAULT_EXTS = ['mermaid', 'md', 'json', 'yaml', 'yml'] as const;
const DEFAULT_NAME_RE_FOR_EXT = (ext: string) => new RegExp(`^Untitled(?: (\\d+))?\\.${ext}$`);
const ANY_DEFAULT_NAME_RE = new RegExp(`^Untitled(?: \\d+)?\\.(${DEFAULT_EXTS.join('|')})$`, 'i');

/**
 * Pick the next free `Untitled[N].<ext>` for this user.
 * Done in the same connection so two concurrent POSTs see each other's
 * inserts via the unique-path index — the second loses to a 409 and the
 * client retries.
 */
async function nextDefaultName(
  db: ReturnType<typeof drizzleDb>,
  userId: string,
  ext = 'mermaid'
): Promise<string> {
  const rows = await db
    .select({ path: workspaceFiles.path })
    .from(workspaceFiles)
    .where(eq(workspaceFiles.user_id, userId));
  const re = DEFAULT_NAME_RE_FOR_EXT(ext);
  let max = 0;
  let hasFirst = false;
  for (const r of rows as { path: string }[]) {
    const m = re.exec(r.path);
    if (!m) continue;
    if (m[1] === undefined) {
      hasFirst = true;
      if (max < 1) max = 1;
    } else {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  if (!hasFirst) return `Untitled.${ext}`;
  return `Untitled ${max + 1}.${ext}`;
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

  // If the client supplies a bare "Untitled.<ext>" (or "Untitled N.<ext>") at
  // the root, treat it as a default and pick the next free slot for that
  // extension. This prevents 409s when the user spams "New file" and accepts
  // the default name. Explicit non-default paths still collide normally.
  let path: string;
  const suppliedPath = parsed.data.path;
  if (suppliedPath && ANY_DEFAULT_NAME_RE.test(suppliedPath)) {
    const ext = suppliedPath.slice(suppliedPath.lastIndexOf('.') + 1).toLowerCase();
    path = await nextDefaultName(db, user.id, ext);
  } else {
    path = suppliedPath ?? (await nextDefaultName(db, user.id));
  }

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
  // Same content rules as the chat tool path. Without this guard a client
  // could POST markdown into a `.mermaid` (rendering as raw text) or a
  // mermaid declaration into `.md` (breaking the prose renderer).
  const validation = validateContentForKind(kind, content);
  if (!validation.ok) {
    return json({ error: validation.error, hint: validation.hint }, { status: 400 });
  }

  // Default-pattern names (Untitled.<ext>) get retry-on-conflict: two
  // concurrent POSTs racing for the same slot is the common case (Enter +
  // blur fires both) and the SELECT-then-INSERT auto-suffix is inherently
  // racy without a transaction. Bound retries to keep this from looping.
  const isDefaultName = ANY_DEFAULT_NAME_RE.test(path);
  let attempt = 0;
  const maxAttempts = isDefaultName ? 5 : 1;

  while (attempt < maxAttempts) {
    attempt++;
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
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null;
      const causeMsg = cause?.message ?? '';
      const wrapperMsg = err instanceof Error ? err.message : 'Unknown error';
      const combined = causeMsg || wrapperMsg;
      const isDuplicate =
        combined.includes('idx_workspace_files_user_path') || combined.includes('duplicate');

      // Default-pattern collision under a race — recompute the next slot
      // (which now sees the row that beat us) and try again.
      if (isDuplicate && isDefaultName && attempt < maxAttempts) {
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        path = await nextDefaultName(db, user.id, ext);
        continue;
      }

      console.error('[workspace-files POST] insert failed', {
        attempt,
        cause: causeMsg,
        code: (cause as { code?: string } | null)?.code,
        detail: (cause as { detail?: string } | null)?.detail,
        kind,
        path,
        userId: user.id,
        wrapper: wrapperMsg
      });
      if (isDuplicate) {
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
  }

  // Exhausted retries — concurrent contention on default names.
  return json(
    { error: 'Could not allocate a free filename. Try renaming manually.' },
    {
      status: 409
    }
  );
};
