import { validateSessionOrGuest } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';

/** Schema for workspace metadata updates */
const patchWorkspaceSchema = z.object({
  title: z.string().max(200, 'Title must be 200 characters or less').optional(),
  description: z
    .string()
    .max(2000, 'Description must be 2000 characters or less')
    .optional()
    .nullable(),
  is_starred: z.boolean().optional(),
  tags: z.array(z.string()).optional()
});

/** GET /api/workspaces/[id] — get full workspace with document */
export const GET: RequestHandler = async ({ request, params }) => {
  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const workspace = await db.getDiagramWorkspace(params.id);
  if (!workspace || workspace.user_id !== user.id) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  return json(workspace);
};

/** PATCH /api/workspaces/[id] — update metadata (title, description, starred, tags) */
export const PATCH: RequestHandler = async ({ request, params }) => {
  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const existing = await db.getDiagramWorkspace(params.id);
  if (!existing || existing.user_id !== user.id) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = patchWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const updated = await db.updateDiagramWorkspace(params.id, parsed.data);

  return json(updated);
};

/** DELETE /api/workspaces/[id] — delete workspace */
export const DELETE: RequestHandler = async ({ request, params }) => {
  const user = await validateSessionOrGuest(request);
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const existing = await db.getDiagramWorkspace(params.id);
  if (!existing || existing.user_id !== user.id) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  await db.deleteDiagramWorkspace(params.id);
  return json({ success: true });
};
