import { randomBytes, scrypt } from 'node:crypto';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  applyAdminEmailRoleOverrides,
  clearLoggedOutCookieHeader,
  clearGuestCookieHeader,
  createLocalSession,
  findGuestUserForRequest,
  localSessionCookie
} from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { authLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';

/**
 * POST /api/auth/register — local/dev registration with email + password
 */
export const POST: RequestHandler = async ({ request, url }) => {
  const rl = authLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  try {
    const { email, password, displayName } = await request.json();
    if (!email || !password) {
      return json({ error: 'Email and password required' }, { status: 400 });
    }

    if (password.length < 8) {
      return json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const db = getDb();

    // Check if user already exists
    const existing = await db.getUserByEmail(email);
    if (existing) {
      return json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    // Hash password
    const salt = randomBytes(16).toString('hex');
    const hash = await new Promise<string>((resolve, reject) => {
      scrypt(password, salt, 64, (err, derived) => {
        if (err) return reject(err);
        resolve(`${derived.toString('hex')}:${salt}`);
      });
    });

    // Create user
    const user = await db.createUser({
      email,
      password_hash: hash,
      display_name: displayName || email.split('@')[0]
    });

    // Create signed session
    const signed = await createLocalSession(email);
    const effective = applyAdminEmailRoleOverrides(user);
    const secureCookie = url.protocol === 'https:';

    // If this request also carries a guest cookie, migrate that guest's data
    // into the new account.
    let guestClear: string | null = null;
    try {
      const guest = await findGuestUserForRequest(request);
      if (guest && guest.id !== effective.id) {
        await db.mergeUsers(guest.id, effective.id);
        guestClear = clearGuestCookieHeader(secureCookie);
      }
    } catch (err) {
      console.error('[auth/register] guest merge failed:', err);
    }

    const headers = new Headers({ 'Content-Type': 'application/json' });
    headers.append('Set-Cookie', localSessionCookie(signed, secureCookie));
    headers.append('Set-Cookie', clearLoggedOutCookieHeader(secureCookie));
    if (guestClear) headers.append('Set-Cookie', guestClear);

    return new Response(
      JSON.stringify({
        user: {
          avatar_url: effective.avatar_url,
          created_at: effective.created_at,
          display_name: effective.display_name,
          email: effective.email,
          id: effective.id,
          role: effective.role
        }
      }),
      { status: 201, headers }
    );
  } catch {
    return json({ error: 'Registration failed' }, { status: 500 });
  }
};
