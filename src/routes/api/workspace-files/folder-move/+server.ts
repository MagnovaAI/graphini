/**
 * Bulk-rename every file under a folder prefix. Atomic in one query so a
 * partial rename can't leave the tree inconsistent.
 */

import { validateSessionOrGuest } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import type { NeonAdapter } from '$lib/server/db/neon-adapter';
import { workspaceFiles } from '$lib/server/db/schema';
import { apiLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { FOLDER_RE } from '$lib/server/workspace-paths';
import { json } from '@sveltejs/kit';
import { and, eq, like, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const drizzleDb = () => (getDb() as NeonAdapter).db;

const moveSchema = z.object({
  from: z.string().min(1).max(200),
  to: z.string().min(1).max(200)
});

export const POST: RequestHandler = async ({ request }) => {
  const rl = apiLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }
  let { from, to } = parsed.data;
  // Normalize: strip leading and trailing slashes.
  from = from.replace(/^\/+|\/+$/g, '');
  to = to.replace(/^\/+|\/+$/g, '');
  if (!FOLDER_RE.test(from) || !FOLDER_RE.test(to)) {
    return json({ error: 'Invalid folder path' }, { status: 400 });
  }
  if (from === to) return json({ ok: true, moved: 0 });

  const fromPrefix = `${from}/`;
  const toPrefix = `${to}/`;
  // Single UPDATE rewrites every matching path in one round-trip.
  const result = await drizzleDb()
    .update(workspaceFiles)
    .set({
      path: sql`${toPrefix} || substring(${workspaceFiles.path} from ${fromPrefix.length + 1})`,
      updated_at: new Date()
    })
    .where(and(eq(workspaceFiles.user_id, user.id), like(workspaceFiles.path, `${fromPrefix}%`)))
    .returning({ id: workspaceFiles.id });

  return json({ ok: true, moved: result.length });
};
