import { validateSessionOrGuest } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { apiLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';

const MAX_PAGINATION_LIMIT = 100;

/** GET /api/workspaces — list user's diagram workspaces */
export const GET: RequestHandler = async ({ request, url }) => {
  const rl = apiLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const rawLimit = parseInt(url.searchParams.get('limit') || '50');
  const paginationLimit = Math.min(Math.max(1, rawLimit), MAX_PAGINATION_LIMIT);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0'));
  const starred = url.searchParams.get('starred') === 'true';
  const search = url.searchParams.get('search') || undefined;

  const db = getDb();
  const result = await db.listDiagramWorkspaces(user.id, {
    limit: paginationLimit,
    offset,
    starred_only: starred,
    search
  });

  return json(result);
};

/** Schema for workspace creation */
const createWorkspaceSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be 200 characters or less')
    .default('Untitled Workspace'),
  description: z
    .string()
    .max(2000, 'Description must be 2000 characters or less')
    .optional()
    .nullable(),
  document: z.record(z.string(), z.unknown()).optional(),
  engine: z.enum(['mermaid', 'json', 'yaml', 'markdown']).default('mermaid')
});

/** POST /api/workspaces — create a new diagram workspace */
export const POST: RequestHandler = async ({ request }) => {
  const rl = apiLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = createWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const engine = parsed.data.engine;

    const workspace = await db.createDiagramWorkspace({
      description: parsed.data.description ?? undefined,
      document: parsed.data.document,
      engine,
      title: parsed.data.title,
      user_id: user.id
    });

    return json(workspace, { status: 201 });
  } catch {
    return json({ error: 'Failed to create workspace' }, { status: 500 });
  }
};
