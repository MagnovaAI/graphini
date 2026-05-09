/**
 * Auth utilities — magnova-auth cookie-based authentication
 *
 * magnova-auth sets a `magnova_session` httpOnly cookie containing the Firebase UID.
 * This module reads that cookie, looks up / auto-creates the local user, and applies
 * admin overrides. Follows the same pattern as Astrova.
 */

import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { getCache, userCacheKeys } from '$lib/server/cache';
import type { User } from '$lib/server/db';
import { getDb } from '$lib/server/db';

const SESSION_COOKIE_NAME = 'magnova_session';
const LOCAL_COOKIE_NAME = 'graphini_session';
const GUEST_COOKIE_NAME = 'graphini_guest_id';
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** Comma-separated emails that should be treated as admin when the DB still has role `user`. */
const ADMIN_EMAIL_OVERRIDES = (env.ADMIN_EMAIL_OVERRIDES || env.ADMIN_ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// ── Cookie helpers ────────────────────────────────────────────────────────

function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return {};

  return Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [key, ...rest] = c.trim().split('=');
      return [key, decodeURIComponent(rest.join('='))];
    })
  );
}

/**
 * Extract the Firebase UID from the magnova_session cookie.
 * magnova-auth sets this cookie (HttpOnly, Secure, Domain=.magnova.ai) after
 * verifying the Firebase ID token server-side.
 */
function extractFirebaseUid(request: Request): string | null {
  const raw = parseCookies(request)[SESSION_COOKIE_NAME];
  if (!raw) return null;
  // Firebase UIDs are short alphanumeric strings — sanity check
  if (raw.length < 5 || raw.length > 128) return null;
  return raw;
}

/**
 * Extract the graphini_session cookie value (local/dev auth).
 */
function extractLocalSession(request: Request): string | null {
  return parseCookies(request)[LOCAL_COOKIE_NAME] || null;
}

// ── HMAC signing for local sessions ───────────────────────────────────────

function getCookieSecret(): string {
  const secret = env.COOKIE_SECRET;
  if (!secret) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        '[auth] COOKIE_SECRET must be set in production. Refusing to start with an insecure default.'
      );
    }
    return 'graphini-dev-secret-do-not-use-in-production';
  }
  return secret;
}

async function signValue(value: string): Promise<string> {
  const secret = getCookieSecret();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  const sigHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${value}.${sigHex}`;
}

async function verifySignedValue(signedValue: string): Promise<string | null> {
  const lastDot = signedValue.lastIndexOf('.');
  if (lastDot === -1) return null;

  const value = signedValue.substring(0, lastDot);
  const providedSig = signedValue.substring(lastDot + 1);

  const secret = getCookieSecret();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const sigBytes = new Uint8Array(
    providedSig.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
  );

  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(value));
  return valid ? value : null;
}

// ── Admin overrides ───────────────────────────────────────────────────────

/** Promote configured emails to admin when the DB role is still `user` (matches session validation). */
export function applyAdminEmailRoleOverrides(user: User): User {
  if (ADMIN_EMAIL_OVERRIDES.length === 0) return user;
  if (ADMIN_EMAIL_OVERRIDES.includes(user.email.toLowerCase()) && user.role === 'user') {
    return { ...user, role: 'admin' };
  }
  return user;
}

// ── Session validation ────────────────────────────────────────────────────

let _cachedDevUser: User | null = null;

/** Loopback hosts only — safe with `dev`; never enabled in production builds. */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * `DEV_BYPASS_AUTH` value, or implicit `'true'` when running `vite dev` against localhost.
 * Use for rate limits and any other dev-bypass checks.
 */
export function getDevBypassEmail(request: Request): string | undefined {
  const explicit = env.DEV_BYPASS_AUTH;
  if (explicit) return explicit;
  if (!dev) return undefined;
  const host = new URL(request.url).hostname;
  if (isLoopbackHost(host)) return 'true';
  return undefined;
}

/**
 * `vite dev` + dev bypass often resolves to the first DB user with role `user`, which blocks /admin.
 * Promote to `admin` in that mode only (`dev` is false in production builds).
 */
function liftRoleForDevBypassSession(user: User): User {
  if (!dev) return user;
  if (user.role === 'superadmin') return user;
  return { ...user, role: 'admin' };
}

/**
 * Validate the current session. Tries methods in order:
 * 0. DEV_BYPASS_AUTH (or auto localhost bypass in `vite dev`) — auto-login as first user or by email
 * 1. magnova_session cookie (Firebase UID → user lookup, auto-create if needed)
 * 2. graphini_session cookie (signed email → user lookup, for local/dev auth)
 */
export async function validateSession(request: Request): Promise<User | null> {
  // Method 0: Dev bypass — skip all auth, auto-login
  const bypassEmail = getDevBypassEmail(request);
  if (bypassEmail) {
    if (_cachedDevUser) {
      return liftRoleForDevBypassSession(applyAdminEmailRoleOverrides(_cachedDevUser));
    }

    try {
      const db = getDb();
      let user: User | null = null;
      if (bypassEmail === 'true') {
        const result = await db.listUsers({ limit: 1, offset: 0 });
        user = result.users[0] || null;
      } else {
        user = await db.getUserByEmail(bypassEmail);
      }
      if (user) {
        _cachedDevUser = user;
        return liftRoleForDevBypassSession(applyAdminEmailRoleOverrides(user));
      }
    } catch (e) {
      console.warn('[auth] DEV_BYPASS_AUTH: DB lookup failed, using fallback dev user:', e);
      const fallback: User = {
        avatar_url: null,
        created_at: new Date().toISOString(),
        display_name: 'Dev User',
        email: 'dev@localhost',
        id: '00000000-0000-0000-0000-000000000000',
        is_active: true,
        role: 'admin'
      } as User;
      _cachedDevUser = fallback;
      return liftRoleForDevBypassSession(applyAdminEmailRoleOverrides(fallback));
    }
  }

  // Method 1: magnova-auth (Firebase UID cookie)
  const firebaseUid = extractFirebaseUid(request);
  if (firebaseUid) {
    // Check cache first
    const cache = getCache();
    const cacheKey = userCacheKeys.session(`firebase:${firebaseUid}`);
    const cached = await cache.get<User>(cacheKey);
    if (cached) return applyAdminEmailRoleOverrides(cached);

    const db = getDb();
    let user = await db.getUserByFirebaseUid(firebaseUid);

    // Auto-sync from magnova-auth in two cases:
    //   1. user row doesn't exist yet (first-time Google login)
    //   2. user row exists but is missing display name OR avatar — happens
    //      to legacy rows that were created before we started reading those
    //      fields off the upstream session response. Refilling them on the
    //      first authenticated request after the fix lands means existing
    //      users see their Google profile without having to log out + back in.
    const needsBackfill = !!user && (!user.avatar_url || !user.display_name);
    if (!user || needsBackfill) {
      const synced = await syncUserFromMagnovaAuth(firebaseUid);
      if (synced) {
        user = synced;
        // Bust the cache hit we'd otherwise get on the next request — the
        // cached `cached` value above was an older row without avatar/name.
        await cache.delete(cacheKey).catch(() => {
          /* cache delete failure is non-fatal */
        });
      }
    }

    if (user && user.is_active) {
      const result = applyAdminEmailRoleOverrides(user);
      await cache.set(cacheKey, result, { ttlSeconds: 300 });
      return result;
    }
  }

  // Method 2: Local session (signed email)
  const localSession = extractLocalSession(request);
  if (localSession) {
    const email = await verifySignedValue(localSession);
    if (email) {
      const db = getDb();
      const user = await db.getUserByEmail(email);
      if (user && user.is_active) return applyAdminEmailRoleOverrides(user);
    }
  }

  return null;
}

// ── magnova-auth user sync ────────────────────────────────────────────────

/**
 * Fetch user profile from magnova-auth by Firebase UID and upsert into graphini's DB.
 * This handles first-time Google login — magnova-auth has the user, graphini doesn't yet.
 * Takes email, display name, and avatar from magnova-auth's session endpoint.
 */
async function syncUserFromMagnovaAuth(firebaseUid: string): Promise<User | null> {
  const baseUrl = env.MAGNOVA_AUTH_URL || 'https://auth.magnova.ai';
  try {
    const res = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'GET',
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(firebaseUid)}` }
    });
    if (!res.ok) {
      console.warn(`[auth] magnova-auth /api/auth/session returned ${res.status}`);
      return null;
    }
    const data = await res.json();
    const remote = data.user;
    if (!remote?.email) {
      console.warn('[auth] magnova-auth session has no user.email; payload keys:', {
        topLevel: Object.keys(data ?? {}),
        userKeys: remote ? Object.keys(remote) : null
      });
      return null;
    }

    // magnova-auth (auth.magnova.ai) federates Google OAuth. Different
    // versions of the upstream service return the avatar under different
    // names — accept all of them so the user's Google profile picture
    // shows up in the sidebar regardless of which key the gateway emits.
    const avatarUrl =
      (typeof remote.avatar_url === 'string' && remote.avatar_url) ||
      (typeof remote.picture === 'string' && remote.picture) ||
      (typeof remote.photoURL === 'string' && remote.photoURL) ||
      (typeof remote.photo_url === 'string' && remote.photo_url) ||
      (typeof remote.image === 'string' && remote.image) ||
      null;
    const displayName =
      remote.display_name ?? remote.name ?? remote.given_name ?? remote.full_name ?? null;

    // First call diagnostic so we can see what fields the gateway actually
    // sent us. If avatar/name are still empty, paste this log line and we
    // know which field to add to the resolver above.
    console.log('[auth] magnova-auth user sync', {
      email: remote.email,
      keys: Object.keys(remote),
      resolvedAvatar: avatarUrl,
      resolvedName: displayName
    });

    const db = getDb();
    return db.upsertUserFromFirebase({
      avatar_url: avatarUrl,
      display_name: displayName,
      email: remote.email,
      firebase_uid: firebaseUid
    });
  } catch (e) {
    console.error('[auth] Failed to sync user from magnova-auth:', e);
    return null;
  }
}

// ── Local session helpers ─────────────────────────────────────────────────

export async function createLocalSession(email: string): Promise<string> {
  return signValue(email);
}

export function localSessionCookie(signedValue: string, secure = false): string {
  const maxAge = 7 * 24 * 60 * 60; // 7 days
  const secureFlag = secure ? '; Secure' : '';
  return `graphini_session=${signedValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`;
}

/** Clear-graphini_session Set-Cookie value (must match attributes used when setting the cookie). */
export function clearLocalSessionCookie(secure = false): string {
  const secureFlag = secure ? '; Secure' : '';
  return `graphini_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
}

// ── magnova-auth URLs ─────────────────────────────────────────────────────

/**
 * Get the magnova-auth login URL for graphini-branded login page.
 * The redirect must be an absolute URL — relative paths resolve against
 * auth.magnova.ai, not graphini.magnova.ai.
 */
export function getAuthUrl(returnTo?: string, requestUrl?: URL): string {
  const baseUrl = env.MAGNOVA_AUTH_URL || 'https://auth.magnova.ai';
  const loginUrl = `${baseUrl}/graphini`;
  if (returnTo) {
    const absoluteRedirect =
      returnTo.startsWith('http://') || returnTo.startsWith('https://')
        ? returnTo
        : requestUrl
          ? `${requestUrl.origin}${returnTo}`
          : returnTo;
    return `${loginUrl}?redirect=${encodeURIComponent(absoluteRedirect)}`;
  }
  return loginUrl;
}

export function getSignoutUrl(redirectTo?: string): string {
  const baseUrl = env.MAGNOVA_AUTH_URL || 'https://auth.magnova.ai';
  const redirect = redirectTo || '/';
  return `${baseUrl}/api/auth/signout?redirect=${encodeURIComponent(redirect)}`;
}

// ── Guest sessions ────────────────────────────────────────────────────────

function readGuestCookie(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === GUEST_COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function guestCookieHeader(token: string, secure = false): string {
  const attrs = [
    `${GUEST_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${GUEST_COOKIE_MAX_AGE}`,
    'SameSite=Lax',
    'HttpOnly'
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

const GUEST_FIREBASE_PREFIX = 'guest:';

/**
 * Best-effort IP extraction from the request. Trusts standard reverse-proxy
 * headers in priority order. Returns null if nothing usable is present (e.g.
 * a direct request in dev with no proxy in front).
 */
function extractClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  const cfConn = request.headers.get('cf-connecting-ip');
  if (cfConn) return cfConn.trim();
  return null;
}

/**
 * Get-or-create the synthetic users row that backs a guest cookie token.
 * The token is reused as `firebase_uid = guest:<token>` so each browser maps
 * to exactly one stable user_id, satisfying every existing FK constraint.
 */
async function ensureGuestUser(token: string, ip: string | null): Promise<User | null> {
  if (!token) return null;
  const db = getDb();
  const firebaseUid = `${GUEST_FIREBASE_PREFIX}${token}`;
  const user = await db.getUserByFirebaseUid(firebaseUid);
  if (user) {
    // Refresh last_seen_at and IP on every hit so expiry is based on activity.
    await db.touchUser(user.id, { ip_address: ip ?? undefined }).catch(() => {
      /* non-fatal */
    });
    return { ...user, is_guest: true };
  }

  const inserted = await db.upsertUserFromFirebase({
    firebase_uid: firebaseUid,
    email: null,
    display_name: 'Guest'
  });
  if (inserted && ip) {
    await db.touchUser(inserted.id, { ip_address: ip }).catch(() => {
      /* non-fatal */
    });
  }
  return inserted ? { ...inserted, is_guest: true } : null;
}

/**
 * Validate a session, falling back to the guest cookie. Returns the resolved
 * user (which may be a guest-backed row) or null if neither is present.
 */
export async function validateSessionOrGuest(request: Request): Promise<User | null> {
  const real = await validateSession(request);
  if (real) return real;
  const guestToken = readGuestCookie(request);
  if (!guestToken) return null;
  return ensureGuestUser(guestToken, extractClientIp(request));
}

/**
 * Look up the guest user (if any) bound to the request's guest cookie.
 * Returns null when no cookie is set or the cookie doesn't map to a row yet.
 * Does NOT auto-create — used when we want to migrate an existing guest into
 * a real account without ever upserting a fresh one.
 */
export async function findGuestUserForRequest(request: Request): Promise<User | null> {
  const token = readGuestCookie(request);
  if (!token) return null;
  const db = getDb();
  const user = await db.getUserByFirebaseUid(`${GUEST_FIREBASE_PREFIX}${token}`);
  return user ? { ...user, is_guest: true } : null;
}

/**
 * Header value that clears the guest cookie on the client. Use after a
 * successful guest -> real-account merge.
 */
export function clearGuestCookieHeader(secure = false): string {
  const attrs = [`${GUEST_COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'SameSite=Lax', 'HttpOnly'];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
