/**
 * Delete every file under a folder prefix. Returns the number of deleted rows.
 */

import { validateSessionOrGuest } from '$lib/server/auth';
import { getDrizzle } from '$lib/server/db';
import { workspaceFiles } from '$lib/server/db/schema';
import { apiLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { FOLDER_RE } from '$lib/server/workspace-paths';
import { json } from '@sveltejs/kit';
import { and, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const drizzleDb = () => {
  const db = getDrizzle();
  if (!db) throw new Error('Workspace files require a Drizzle-backed database adapter.');
  return db;
};

const delSchema = z.object({ path: z.string().min(1).max(200) });

export const POST: RequestHandler = async ({ request }) => {
  const rl = apiLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = delSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }
  const path = parsed.data.path.replace(/^\/+|\/+$/g, '');
  if (!FOLDER_RE.test(path)) {
    return json({ error: 'Invalid folder path' }, { status: 400 });
  }

  const prefix = `${path}/`;
  const result = await drizzleDb()
    .delete(workspaceFiles)
    .where(and(eq(workspaceFiles.user_id, user.id), like(workspaceFiles.path, `${prefix}%`)))
    .returning({ id: workspaceFiles.id });
  return json({ ok: true, deleted: result.length });
};
