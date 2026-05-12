import { dev } from '$app/environment';
import {
  clearGuestCookieHeader,
  clearLoggedOutCookieHeader,
  findGuestUserForRequest,
  guestCookieHeader,
  validateSession
} from '$lib/server/auth';
import { maybePruneExpiredGuests } from '$lib/server/auth/prune-guests';
import { getDb } from '$lib/server/db';
import type { Handle } from '@sveltejs/kit';

const GUEST_COOKIE_NAME = 'graphini_guest_id';
const LOGGED_OUT_COOKIE_NAME = 'graphini_logged_out';

function generateGuestToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return (
    Math.random().toString(36).slice(2) +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2)
  );
}

/**
 * If this request carries both a real session cookie AND a guest cookie,
 * fold the guest's data into the real account and clear the guest cookie.
 * Runs at most once per cookie-pair: once the guest cookie is cleared, the
 * next request can't retrigger this branch.
 *
 * Catches and swallows all errors so a merge failure can never block a
 * regular request — the periodic prune will eventually delete the orphan.
 */
async function maybeMergeGuestOnAuthenticatedRequest(
  request: Request,
  secure: boolean
): Promise<string | null> {
  if (!request.headers.get('cookie')?.includes(GUEST_COOKIE_NAME)) return null;
  try {
    const real = await validateSession(request);
    if (!real || real.is_guest === true) return null;
    const guest = await findGuestUserForRequest(request);
    if (!guest || guest.id === real.id) return null;
    await getDb().mergeUsers(guest.id, real.id);
    return clearGuestCookieHeader(secure);
  } catch (err) {
    console.error('[hooks] background guest merge failed:', err);
    return null;
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const loggedOut = event.cookies.get(LOGGED_OUT_COOKIE_NAME) === '1';
  const path = event.url.pathname;
  const shouldStartGuestSession = !loggedOut || path === '/app' || path.startsWith('/app/');

  // Issue a guest session cookie on first hit so anonymous users can persist a
  // chat across requests. The cookie is upgraded to a real session by the
  // background merge below once the user logs in.
  let guestToken = event.cookies.get(GUEST_COOKIE_NAME);
  let setGuestCookie = false;
  if (!guestToken && shouldStartGuestSession) {
    guestToken = generateGuestToken();
    setGuestCookie = true;
  }

  // Fire-and-await the background guest merge BEFORE resolving the request, so
  // any data write during this same request lands on the real user_id rather
  // than the guest one we're about to delete. This is the single hookpoint that
  // covers every login path (magnova OAuth callback, /api/auth/login,
  // /api/auth/register), since each of them lands the magnova/graphini session
  // cookie that this branch sees on the next-or-same request.
  const mergeClearCookie = setGuestCookie
    ? null
    : await maybeMergeGuestOnAuthenticatedRequest(event.request, !dev);

  // Fire-and-forget the lazy expired-guest prune; it's gated to once-per-hour
  // and never blocks request resolution. Swallow rejections so they don't
  // surface as unhandled promise warnings (or terminate the process).
  maybePruneExpiredGuests().catch((err) => {
    console.warn('[guests] expired-guest prune failed:', err);
  });

  const response = await resolve(event, {});

  if (setGuestCookie && guestToken) {
    response.headers.append('Set-Cookie', guestCookieHeader(guestToken, !dev));
    response.headers.append('Set-Cookie', clearLoggedOutCookieHeader(!dev));
  } else if (mergeClearCookie) {
    response.headers.append('Set-Cookie', mergeClearCookie);
  }

  // Security headers
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );

  return response;
};
