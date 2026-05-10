import { getLogger } from './logger';
import { createHash } from 'node:crypto';

const log = getLogger('rate-limit');
const WARN_COOLDOWN_MS = 10_000;

interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}

interface SlidingWindowEntry {
  timestamps: number[];
}

function createRateLimiter(name: string, config: RateLimitConfig) {
  const store = new Map<string, SlidingWindowEntry>();
  const warningState = new Map<string, { lastLoggedAt: number; suppressed: number }>();

  // Cleanup stale entries every 60s
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of store) {
      // Remove timestamps outside the window
      entry.timestamps = entry.timestamps.filter((t) => now - t < config.windowMs);
      if (entry.timestamps.length === 0) {
        store.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      log.debug(`Cleaned ${cleaned} stale entries from ${name} limiter`);
    }
  }, 60 * 1000);

  // Allow cleanup interval to not prevent process exit
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      let entry = store.get(key);

      if (!entry) {
        entry = { timestamps: [] };
        store.set(key, entry);
      }

      // Remove timestamps outside the sliding window
      entry.timestamps = entry.timestamps.filter((t) => now - t < config.windowMs);

      if (entry.timestamps.length >= config.maxRequests) {
        const oldest = entry.timestamps[0];
        const retryAfterMs = oldest + config.windowMs - now;
        const warning = warningState.get(key);
        if (!warning || now - warning.lastLoggedAt >= WARN_COOLDOWN_MS) {
          const suppressed = warning?.suppressed ?? 0;
          log.warn(
            `Rate limit exceeded for ${name}: key=${key}, retryAfterMs=${Math.max(
              0,
              Math.ceil(retryAfterMs)
            )}${suppressed > 0 ? `, suppressed=${suppressed}` : ''}`
          );
          warningState.set(key, { lastLoggedAt: now, suppressed: 0 });
        } else {
          warning.suppressed++;
        }
        return { allowed: false, retryAfterMs };
      }

      entry.timestamps.push(now);
      return { allowed: true };
    }
  };
}

/** 30 requests per minute */
export const chatLimiter = createRateLimiter('chat', { maxRequests: 30, windowMs: 60_000 });

/** 20 requests per minute */
export const uploadLimiter = createRateLimiter('upload', { maxRequests: 20, windowMs: 60_000 });

/**
 * Audio transcription is heavier per request (multi-MB upload, paid speech
 * model) so it gets a tighter cap than upload.
 *
 * 10 requests per minute */
export const audioLimiter = createRateLimiter('audio', { maxRequests: 10, windowMs: 60_000 });

/** 120 requests per minute */
export const apiLimiter = createRateLimiter('api', { maxRequests: 120, windowMs: 60_000 });

/** 10 requests per minute */
export const authLimiter = createRateLimiter('auth', { maxRequests: 10, windowMs: 60_000 });

/**
 * Extract a stable client identifier for rate-limit keying.
 *
 * Priority order:
 *   1. cf-connecting-ip — Cloudflare-set, not client-controllable.
 *   2. x-real-ip — set by trusted reverse proxies (Vercel, nginx).
 *   3. x-forwarded-for, when the app is in dev, Vercel, or TRUST_PROXY=true.
 *      Falls through otherwise because clients can spoof XFF when the app is
 *      reachable directly.
 *   4. A hashed Graphini/Magnova session cookie. This keeps local/dev API
 *      requests from collapsing into the global "unknown" bucket when proxy IP
 *      headers are absent. We hash because cookie values are secrets.
 *   5. 'unknown' fallback. Effectively keys all unknown clients into the
 *      same bucket — strict but safe; legitimate clients are identified by
 *      one of the headers/cookies above.
 *
 * Set TRUST_PROXY=true only when the deployment is fronted by a proxy that
 * overwrites x-forwarded-for. Do NOT set it when the app is reachable
 * directly from the public Internet.
 */
export function getClientKey(request: Request): string {
  const cf = request.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = request.headers.get('x-forwarded-for');
  if (
    forwarded &&
    (process.env.TRUST_PROXY === 'true' ||
      process.env.VERCEL === '1' ||
      process.env.NODE_ENV !== 'production')
  ) {
    const firstForwarded = forwarded.split(',')[0].trim();
    if (firstForwarded) return firstForwarded;
  }

  const cookieHeader = request.headers.get('cookie') ?? '';
  for (const name of ['magnova_session', 'graphini_session', 'graphini_guest_id']) {
    const value = readCookie(cookieHeader, name);
    if (value) return `cookie:${name}:${hashKey(value)}`;
  }
  return 'unknown';
}

function readCookie(cookieHeader: string, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName !== name) continue;
    const value = rawValue.join('=').trim();
    return value ? value : null;
  }
  return null;
}

function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/**
 * Return a 429 Too Many Requests JSON response.
 */
export function rateLimitResponse(retryAfterMs: number): Response {
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
  return new Response(
    JSON.stringify({
      error: 'Too many requests',
      retryAfterMs,
      retryAfterSeconds
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds)
      },
      status: 429
    }
  );
}
