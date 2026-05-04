import { dev } from '$app/environment';
import { guestCookieHeader } from '$lib/server/auth';
import type { Handle } from '@sveltejs/kit';

const GUEST_COOKIE_NAME = 'graphini_guest_id';

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

export const handle: Handle = async ({ event, resolve }) => {
  // Issue a guest session cookie on first hit so anonymous users can persist a
  // chat across requests. The cookie is upgraded to a real magnova session on
  // sign-in by the app code.
  let guestToken = event.cookies.get(GUEST_COOKIE_NAME);
  let setGuestCookie = false;
  if (!guestToken) {
    guestToken = generateGuestToken();
    setGuestCookie = true;
  }

  const response = await resolve(event, {});

  if (setGuestCookie) {
    response.headers.append('Set-Cookie', guestCookieHeader(guestToken, !dev));
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
