import { validateSession } from '$lib/server/auth';
import { json } from '@sveltejs/kit';

export async function requireAdmin(request: Request): Promise<{ userId: string } | Response> {
  const user = await validateSession(request);
  if (!user) {
    return json({ success: false, error: 'Authentication required' }, { status: 401 });
  }
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    return json({ success: false, error: 'Admin privileges required' }, { status: 403 });
  }
  return { userId: user.id };
}
