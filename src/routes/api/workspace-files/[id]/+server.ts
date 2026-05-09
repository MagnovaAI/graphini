/**
 * Workspace files — update (rename / overwrite) and delete one file.
 */

import { validateSessionOrGuest } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import type { NeonAdapter } from '$lib/server/db/neon-adapter';
import { workspaceFiles } from '$lib/server/db/schema';
import { apiLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { PATH_RE, deriveKind } from '$lib/server/workspace-paths';
import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const drizzleDb = () => (getDb() as NeonAdapter).db;

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
  if (path !== undefined) {
    if (!PATH_RE.test(path)) {
      return json({ error: 'Invalid path' }, { status: 400 });
    }
    const kind = deriveKind(path);
    if (!kind) {
      return json(
        { error: 'Unsupported file kind. Allowed: .md, .json, .yaml/.yml, .mermaid/.mmd' },
        { status: 400 }
      );
    }
    update.path = path;
    update.kind = kind;
  }

  const db = drizzleDb();
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
