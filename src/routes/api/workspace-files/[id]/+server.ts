/**
 * Workspace files — update (rename / overwrite) and delete one file.
 */

import { validateSessionOrGuest } from '$lib/server/auth';
import { getDrizzle } from '$lib/server/db';
import { workspaceFiles } from '$lib/server/db/schema';
import { apiLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { PATH_RE, deriveKind } from '$lib/server/workspace-paths';
import { validateContentForKind } from '$lib/server/workspace-content-validation';
import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const drizzleDb = () => {
  const db = getDrizzle();
  if (!db) throw new Error('Workspace files require a Drizzle-backed database adapter.');
  return db;
};

const patchSchema = z.object({
  path: z.string().min(1).max(200).optional(),
  content: z.string().optional()
});

export const PATCH: RequestHandler = async ({ request, params }) => {
  const rl = apiLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const id = params.id;
  if (!id) return json({ error: 'Missing id' }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }
  const { path, content } = parsed.data;
  if (path === undefined && content === undefined) {
    return json({ error: 'Nothing to update' }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date() };
  if (content !== undefined) update.content = content;
  let nextKind: ReturnType<typeof deriveKind> = null;
  if (path !== undefined) {
    if (!PATH_RE.test(path)) {
      return json({ error: 'Invalid path' }, { status: 400 });
    }
    nextKind = deriveKind(path);
    if (!nextKind) {
      return json(
        { error: 'Unsupported file kind. Allowed: .md, .json, .yaml/.yml, .mermaid/.mmd' },
        { status: 400 }
      );
    }
    update.path = path;
    update.kind = nextKind;
  }

  const db = drizzleDb();

  // Same content rules as the chat tool path. When only content is changing
  // we need the current row's kind to validate against; when path is also
  // changing, we use the new kind. Either way: validate before writing.
  if (content !== undefined) {
    const [current] = await db
      .select({ kind: workspaceFiles.kind })
      .from(workspaceFiles)
      .where(and(eq(workspaceFiles.id, id), eq(workspaceFiles.user_id, user.id)));
    if (!current) return json({ error: 'Not found' }, { status: 404 });
    const effectiveKind = nextKind ?? (current.kind as ReturnType<typeof deriveKind>);
    if (effectiveKind) {
      const validation = validateContentForKind(effectiveKind, content);
      if (!validation.ok) {
        return json({ error: validation.error, hint: validation.hint }, { status: 400 });
      }
    }
  }

  try {
    const result = await db
      .update(workspaceFiles)
      .set(update)
      .where(and(eq(workspaceFiles.id, id), eq(workspaceFiles.user_id, user.id)))
      .returning();
    if (result.length === 0) return json({ error: 'Not found' }, { status: 404 });
    const r = result[0];
    return json({
      content: r.content,
      created_at: r.created_at.toISOString(),
      id: r.id,
      kind: r.kind,
      path: r.path,
      updated_at: r.updated_at.toISOString()
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('idx_workspace_files_user_path') || msg.includes('duplicate')) {
      return json({ error: 'A file with that path already exists.' }, { status: 409 });
    }
    return json({ error: msg }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  const rl = apiLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const id = params.id;
  if (!id) return json({ error: 'Missing id' }, { status: 400 });

  const db = drizzleDb();
  const result = await db
    .delete(workspaceFiles)
    .where(and(eq(workspaceFiles.id, id), eq(workspaceFiles.user_id, user.id)))
    .returning({ id: workspaceFiles.id });
  if (result.length === 0) return json({ error: 'Not found' }, { status: 404 });
  return json({ ok: true });
};
