/**
 * Symmetric encryption for sensitive app_settings rows (API keys, tokens).
 *
 * Uses AES-256-GCM. Output format: `v1:<base64-iv>:<base64-ciphertext+tag>`.
 * The version prefix lets us rotate algorithms without breaking old rows.
 *
 * The key MUST be supplied via APP_SETTINGS_ENCRYPTION_KEY. We refuse to start
 * in production without it. In dev, we fall back to a deterministic key derived
 * from COOKIE_SECRET so a fresh checkout works, but never silently generate one
 * that would invalidate previously-stored ciphertext.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { env } from '$env/dynamic/private';

const ALGO = 'aes-256-gcm';
const KEY_LEN = 32;
const IV_LEN = 12;
const VERSION = 'v1';
const PREFIX = `${VERSION}:`;

let cachedKey: Buffer | null = null;

function deriveKey(secret: string): Buffer {
  // Fixed salt is fine here: the secret itself is the entropy. Rotating the
  // salt would invalidate every existing ciphertext.
  return scryptSync(secret, 'graphini-app-settings', KEY_LEN);
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const explicit = env.APP_SETTINGS_ENCRYPTION_KEY;
  if (explicit && explicit.length >= 16) {
    cachedKey = deriveKey(explicit);
    return cachedKey;
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      '[crypto] APP_SETTINGS_ENCRYPTION_KEY must be set in production (>= 16 chars).'
    );
  }

  const cookieSecret = env.COOKIE_SECRET;
  if (cookieSecret && cookieSecret.length >= 16) {
    cachedKey = deriveKey(`fallback:${cookieSecret}`);
    return cachedKey;
  }

  throw new Error(
    '[crypto] APP_SETTINGS_ENCRYPTION_KEY is missing. Set it in your env (>= 16 chars).'
  );
}

/** True when the value looks like a v1 ciphertext (i.e., already encrypted). */
function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([enc, tag]);
  return `${PREFIX}${iv.toString('base64')}:${payload.toString('base64')}`;
}

function decrypt(ciphertext: string): string {
  if (!isEncrypted(ciphertext)) {
    throw new Error('[crypto] decrypt() called on non-ciphertext value');
  }
  const body = ciphertext.slice(PREFIX.length);
  const [ivB64, payloadB64] = body.split(':');
  if (!ivB64 || !payloadB64) {
    throw new Error('[crypto] malformed ciphertext');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const payload = Buffer.from(payloadB64, 'base64');
  if (iv.length !== IV_LEN || payload.length < 16) {
    throw new Error('[crypto] ciphertext byte lengths are wrong');
  }
  const tag = payload.subarray(payload.length - 16);
  const enc = payload.subarray(0, payload.length - 16);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

const SENSITIVE_KEY_PATTERN = /(api_key|auth_token|access_token|refresh_token|secret|password)$/i;
const SENSITIVE_CATEGORIES = new Set(['ai_provider', 'secrets']);

/** Whether a (category, key) combo holds a secret that must be encrypted at rest. */
export function isSensitiveSetting(category: string, key: string): boolean {
  if (SENSITIVE_CATEGORIES.has(category)) return true;
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Wrap a value for storage. If the (category, key) is sensitive AND the value
 * is a string, return its ciphertext. Otherwise return the value unchanged.
 * Non-string values for sensitive fields are rejected — secrets are strings.
 */
export function encryptForStorage(category: string, key: string, value: unknown): unknown {
  if (!isSensitiveSetting(category, key)) return value;
  if (value === null || value === undefined || value === '') return value;
  if (typeof value !== 'string') {
    throw new Error(
      `[crypto] Refusing to store non-string value at sensitive setting ${category}/${key}`
    );
  }
  // Already-encrypted values pass through (idempotent on re-saves).
  if (isEncrypted(value)) return value;
  return encrypt(value);
}

/** Reverse of encryptForStorage. Tolerates legacy plaintext rows. */
export function decryptFromStorage(category: string, key: string, value: unknown): unknown {
  if (!isSensitiveSetting(category, key)) return value;
  if (typeof value !== 'string') return value;
  if (!isEncrypted(value)) return value; // legacy plaintext — caller may want to backfill
  try {
    return decrypt(value);
  } catch (err) {
    console.error(
      `[crypto] Failed to decrypt setting ${category}/${key}; returning null:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
