#!/usr/bin/env node
/**
 * One-shot migration: encrypt every plaintext sensitive app_settings row in place.
 *
 * Reads every row whose (category, key) is sensitive per the same predicate the
 * runtime uses, and writes back the AES-GCM ciphertext if the value is still
 * plaintext. Idempotent — re-running is safe; already-encrypted rows are left
 * alone.
 *
 * Usage:  pnpm node scripts/encrypt-existing-secrets.mjs        (dry-run)
 *         pnpm node scripts/encrypt-existing-secrets.mjs --apply
 */
import 'dotenv/config';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

const APPLY = process.argv.includes('--apply');

const DATABASE_URL = process.env.DATABASE_URL;
const KEY_SECRET = process.env.APP_SETTINGS_ENCRYPTION_KEY;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}
if (!KEY_SECRET || KEY_SECRET.length < 16) {
  console.error('APP_SETTINGS_ENCRYPTION_KEY missing or too short (>= 16 chars).');
  process.exit(1);
}

// Mirrors src/lib/server/crypto/index.ts — keep in sync.
const KEY = scryptSync(KEY_SECRET, 'graphini-app-settings', 32);
const PREFIX = 'v1:';
const SENSITIVE_KEY_PATTERN = /(api_key|auth_token|access_token|refresh_token|secret|password)$/i;
const SENSITIVE_CATEGORIES = new Set(['ai_provider', 'secrets']);

function isSensitive(category, key) {
  return SENSITIVE_CATEGORIES.has(category) || SENSITIVE_KEY_PATTERN.test(key);
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${Buffer.concat([enc, tag]).toString('base64')}`;
}

function unwrapKv(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && '__kv' in raw) return raw.__kv;
  return raw;
}

function wrap(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
  return { __kv: value };
}

const sql = neon(DATABASE_URL);

const rows = await sql`SELECT id, category, key, value, is_sensitive FROM app_settings`;

let touched = 0;
let already = 0;
let skipped = 0;
let nonString = 0;

for (const row of rows) {
  if (!isSensitive(row.category, row.key)) {
    skipped++;
    continue;
  }
  const inner = unwrapKv(row.value);
  if (typeof inner !== 'string') {
    nonString++;
    continue;
  }
  if (isEncrypted(inner)) {
    already++;
    continue;
  }
  if (inner === '') {
    skipped++;
    continue;
  }
  const ct = encrypt(inner);
  console.log(
    `${APPLY ? 'ENCRYPT' : 'PLAN'}  ${row.category}/${row.key}  (${row.id})  ${inner.length}b -> ${ct.length}b`
  );
  if (APPLY) {
    await sql`UPDATE app_settings
              SET value = ${wrap(ct)}::jsonb,
                  is_sensitive = TRUE,
                  updated_at = NOW()
              WHERE id = ${row.id}`;
  }
  touched++;
}

console.log('---');
console.log(`Total rows scanned:     ${rows.length}`);
console.log(`Sensitive plaintext:    ${touched}  ${APPLY ? '(updated)' : '(would update)'}`);
console.log(`Already ciphertext:     ${already}`);
console.log(`Sensitive non-string:   ${nonString}`);
console.log(`Non-sensitive skipped:  ${skipped}`);
if (!APPLY) console.log('\n(dry run — re-run with --apply to write)');
