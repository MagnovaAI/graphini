import type { RequestHandler } from './$types';
import {
  clearGuestCookieHeader,
  clearLocalSessionCookie,
  getSignoutUrl,
  loggedOutCookieHeader,
  safeReturnTo
} from '$lib/server/auth';

function hasCookie(request: Request, name: string): boolean {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .some((part) => part.trim().startsWith(`${name}=`)) === true
  );
}

function appendClearCookies(headers: Headers, secureCookie: boolean): Headers {
  headers.append('Set-Cookie', clearLocalSessionCookie(secureCookie));
  headers.append('Set-Cookie', clearGuestCookieHeader(secureCookie));
  headers.append('Set-Cookie', loggedOutCookieHeader(secureCookie));
  return headers;
}

export const GET: RequestHandler = async ({ request, url }) => {
  // Browser-driven account logout. OAuth users are sent through upstream
  // magnova-auth signout; local/password users just have app cookies cleared.
  const secureCookie = url.protocol === 'https:';
  const redirectTo = safeReturnTo(url.searchParams.get('redirect') ?? '/', url);
  const location = hasCookie(request, 'magnova_session')
    ? getSignoutUrl(`${url.origin}${redirectTo}`)
    : redirectTo;
  const headers = appendClearCookies(new Headers({ Location: location }), secureCookie);
  return new Response(null, { status: 302, headers });
};

export const POST: RequestHandler = async ({ url }) => {
  // Local logout — clears both the password-session cookie and the guest
  // cookie. Either may be present (or both, if a guest was migrated into
  // a real account mid-session); clearing both is idempotent.
  const secureCookie = url.protocol === 'https:';
  const headers = appendClearCookies(new Headers({ Location: '/' }), secureCookie);
  return new Response(null, { status: 302, headers });
};
