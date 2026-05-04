import { getDevBypassEmail, validateSessionOrGuest } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { authLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  // Skip rate limiting when dev bypass is active (including implicit localhost dev)
  if (!getDevBypassEmail(request)) {
    const rl = authLimiter.check(getClientKey(request));
    if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);
  }

  try {
    const user = await validateSessionOrGuest(request);
    if (!user) {
      return json({ user: null, credits: null }, { status: 401 });
    }

    let credits: {
      balance: number;
      lifetime_earned: number;
      lifetime_spent: number;
    } | null = null;
    try {
      const db = getDb();
      const row = await db.getCreditBalance(user.id);
      credits = row
        ? {
            balance: row.balance,
            lifetime_earned: row.lifetime_earned,
            lifetime_spent: row.lifetime_spent
          }
        : null;
    } catch {
      /* e.g. DATABASE_URL unset or dev fallback user id — still return session */
    }

    return json({
      user: {
        avatar_url: user.avatar_url,
        created_at: user.created_at,
        display_name: user.display_name,
        email: user.email,
        id: user.id,
        is_guest: user.is_guest === true,
        role: user.role
      },
      credits
    });
  } catch (e) {
    console.error('[auth/me] Error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
