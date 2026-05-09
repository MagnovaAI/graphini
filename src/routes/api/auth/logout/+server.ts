import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearGuestCookieHeader, clearLocalSessionCookie, getSignoutUrl } from '$lib/server/auth';

export const GET: RequestHandler = async () => {
  // Federated (magnova-auth) signout flow. Reserved for OAuth users who
  // want their upstream session terminated too. Local clients should use
  // POST so guests and password-login users don't get bounced through an
  // external auth provider that has no session for them.
  throw redirect(302, getSignoutUrl());
};

export const POST: RequestHandler = async ({ url }) => {
  // Local logout — clears both the password-session cookie and the guest
  // cookie. Either may be present (or both, if a guest was migrated into
  // a real account mid-session); clearing both is idempotent.
  const secureCookie = url.protocol === 'https:';
  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie', clearLocalSessionCookie(secureCookie));
  headers.append('Set-Cookie', clearGuestCookieHeader(secureCookie));
  return new Response(null, { status: 302, headers });
};
