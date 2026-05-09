import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  applyAdminEmailRoleOverrides,
  clearGuestCookieHeader,
  createLocalSession,
  findGuestUserForRequest,
  getAuthUrl,
  getDevBypassEmail,
  localSessionCookie,
  safeReturnTo,
  validateSession
} from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import { authLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';

/**
 * If the request carries a guest cookie that maps to a different user than the
 * one we just logged in, merge guest data into the real account and return the
 * Set-Cookie header that clears the guest cookie. Otherwise null.
 */
async function maybeMergeGuestIntoUser(
  request: Request,
  realUserId: string,
  secureCookie: boolean
): Promise<string | null> {
  try {
    const guest = await findGuestUserForRequest(request);
    if (!guest || guest.id === realUserId) return null;
    await getDb().mergeUsers(guest.id, realUserId);
    return clearGuestCookieHeader(secureCookie);
  } catch (err) {
    console.error('[auth] guest merge failed:', err);
    // Don't block the login if merge fails — guest data simply stays orphaned
    // until the cleanup pass prunes it.
    return null;
  }
}

function withCookies(headers: Record<string, string>, ...cookies: (string | null)[]) {
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) h.set(k, v);
  for (const c of cookies) if (c) h.append('Set-Cookie', c);
  return h;
}

/**
 * GET /api/auth/login — redirect to magnova-auth for OAuth login.
 * If DEV_BYPASS_AUTH is active and user is already authenticated,
 * redirect back to the app instead of magnova-auth.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  // Coerce returnTo to a same-origin relative path. Without this,
  // /api/auth/login?returnTo=https://attacker.example becomes an open
  // redirect — both for already-authenticated users (302 below) and for
  // unauthenticated users via getAuthUrl()'s redirect param.
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'), url);

  // If dev bypass is active, user is already "logged in" — just go back
  const user = await validateSession(request);
  if (user) {
    throw redirect(302, returnTo);
  }

  throw redirect(302, getAuthUrl(returnTo, url));
};

/**
 * POST /api/auth/login — local/dev login with email + password
 * Creates a graphini_session cookie signed with COOKIE_SECRET.
 */
export const POST: RequestHandler = async ({ request, url }) => {
  const rl = authLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  try {
    // Dev bypass: set session without credentials (admin "Sign in" on localhost often POSTs empty)
    const bypass = getDevBypassEmail(request);
    if (bypass) {
      const devUser = await validateSession(request);
      if (devUser) {
        const signed = await createLocalSession(devUser.email);
        const secureCookie = url.protocol === 'https:';
        const guestClear = await maybeMergeGuestIntoUser(request, devUser.id, secureCookie);
        return new Response(
          JSON.stringify({
            user: {
              avatar_url: devUser.avatar_url,
              created_at: devUser.created_at,
              display_name: devUser.display_name,
              email: devUser.email,
              id: devUser.id,
              role: devUser.role
            }
          }),
          {
            headers: withCookies(
              { 'Content-Type': 'application/json' },
              localSessionCookie(signed, secureCookie),
              guestClear
            )
          }
        );
      }
    }

    let body: { email?: unknown; password?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Email and password required' }, { status: 400 });
    }
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      return json({ error: 'Email and password required' }, { status: 400 });
    }

    const db = getDb();
    const user = await db.getUserByEmail(email);
    if (!user) {
      return json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Verify password
    if (!user.password_hash) {
      return json(
        { error: 'This account uses OAuth login. Use Sign in with Google.' },
        { status: 401 }
      );
    }

    const { scrypt, timingSafeEqual } = await import('node:crypto');
    const parts = (user.password_hash ?? '').split(':');
    const hash = parts[0];
    const salt = parts.slice(1).join(':'); // salt is hex; guard against extra colons
    const valid =
      hash &&
      salt &&
      (await new Promise<boolean>((resolve) => {
        scrypt(password, salt, 64, (err, derived) => {
          if (err) return resolve(false);
          try {
            const hashBuf = Buffer.from(hash, 'hex');
            if (hashBuf.length !== derived.length) return resolve(false);
            resolve(timingSafeEqual(hashBuf, derived));
          } catch {
            resolve(false);
          }
        });
      }));

    if (!valid) {
      return json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Create signed session
    const signed = await createLocalSession(email);
    const effective = applyAdminEmailRoleOverrides(user);
    const secureCookie = url.protocol === 'https:';
    const guestClear = await maybeMergeGuestIntoUser(request, effective.id, secureCookie);

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
      {
        headers: withCookies(
          { 'Content-Type': 'application/json' },
          localSessionCookie(signed, secureCookie),
          guestClear
        )
      }
    );
  } catch {
    return json({ error: 'Login failed' }, { status: 500 });
  }
};
