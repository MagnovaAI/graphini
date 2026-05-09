/**
 * Build the `x-provider-*` header bag the server expects.
 *
 * Reads keys from the user's localStorage-backed AI settings and emits one
 * header per non-empty value. Used by every client call that hits a paid
 * provider (chat, audio, upload, model-lab).
 *
 * Header names mirror src/lib/server/auth/provider-keys.ts. Any change here
 * must be matched there.
 *
 * Why headers (not body fields):
 *  - Logging middleware can redact by header name without touching JSON.
 *  - Works uniformly for JSON, multipart, and streaming bodies.
 *  - Keys never appear in URL query strings or referrer headers.
 */

interface AiSettingsLike {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  anthropicAuthToken?: string;
  openrouterApiKey?: string;
  geminiApiKey?: string;
  braveSearchApiKey?: string;
  tavilyApiKey?: string;
}

/**
 * Build a Record of x-provider-* headers from local AI settings.
 *
 * Empty / missing keys are omitted entirely so the server's missing-key
 * guard fires deterministically; sending empty headers would still register
 * as "key present" to a careless reader on the server.
 */
export function providerKeyHeaders(
  settings: AiSettingsLike | null | undefined
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!settings) return headers;

  const add = (name: string, value: string | undefined) => {
    const trimmed = (value ?? '').trim();
    if (trimmed) headers[name] = trimmed;
  };

  add('x-provider-openrouter', settings.openrouterApiKey);
  add('x-provider-openai', settings.openaiApiKey);
  add('x-provider-anthropic', settings.anthropicApiKey);
  add('x-provider-anthropic-auth', settings.anthropicAuthToken);
  add('x-provider-gemini', settings.geminiApiKey);
  add('x-provider-brave-search', settings.braveSearchApiKey);
  add('x-provider-tavily', settings.tavilyApiKey);

  return headers;
}
