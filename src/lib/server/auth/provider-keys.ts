/**
 * Per-request provider key plumbing.
 *
 * The server holds zero AI provider credentials. Each user keeps their own
 * keys in browser localStorage and sends them on every request via x-provider-*
 * headers. This module reads those headers, returns a typed `ProviderKeys`
 * object, and exposes a clean error helper for missing-key cases.
 *
 * Keys travel as headers (not body fields) so request logging middleware can
 * redact them by header name without touching JSON bodies, and so the same
 * helper works across REST/JSON, multipart uploads, and streaming responses.
 */

import { error } from '@sveltejs/kit';

export interface ProviderKeys {
  openrouter: string;
  openai: string;
  anthropic: string;
  /**
   * Magnova/Anthropic OAuth-style token (`sk-ant-oat*` / `sk-ant-oauth*`).
   * Takes precedence over `anthropic` when present, since OAuth tokens can be
   * issued per-user with narrower scope than a raw API key.
   */
  anthropicAuthToken: string;
  gemini: string;
  braveSearch: string;
  tavily: string;
}

const HEADER_BY_FIELD: Record<keyof ProviderKeys, string> = {
  anthropic: 'x-provider-anthropic',
  anthropicAuthToken: 'x-provider-anthropic-auth',
  braveSearch: 'x-provider-brave-search',
  gemini: 'x-provider-gemini',
  openai: 'x-provider-openai',
  openrouter: 'x-provider-openrouter',
  tavily: 'x-provider-tavily'
};

/** Pull every supported `x-provider-*` header off the request. */
export function extractProviderKeys(request: Request): ProviderKeys {
  const read = (name: string) => (request.headers.get(name) ?? '').trim();
  return {
    anthropic: read(HEADER_BY_FIELD.anthropic),
    anthropicAuthToken: read(HEADER_BY_FIELD.anthropicAuthToken),
    braveSearch: read(HEADER_BY_FIELD.braveSearch),
    gemini: read(HEADER_BY_FIELD.gemini),
    openai: read(HEADER_BY_FIELD.openai),
    openrouter: read(HEADER_BY_FIELD.openrouter),
    tavily: read(HEADER_BY_FIELD.tavily)
  };
}

/** Empty object used when an endpoint doesn't take a request (testing, etc). */
export function emptyProviderKeys(): ProviderKeys {
  return {
    anthropic: '',
    anthropicAuthToken: '',
    braveSearch: '',
    gemini: '',
    openai: '',
    openrouter: '',
    tavily: ''
  };
}

/** Friendly label for missing-key error messages. */
const LABEL_BY_FIELD: Record<keyof ProviderKeys, string> = {
  anthropic: 'Anthropic',
  anthropicAuthToken: 'Anthropic OAuth',
  braveSearch: 'Brave Search',
  gemini: 'Gemini',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  tavily: 'Tavily'
};

/**
 * Throw a SvelteKit 400 carrying a structured error a client can detect and
 * route to "open Settings, add the key" UX. The shape stays in the message
 * field because SvelteKit's `error()` doesn't carry custom payloads through
 * its standard handler, but the prefix is stable.
 */
export function missingProviderKeyError(field: keyof ProviderKeys): never {
  const label = LABEL_BY_FIELD[field];
  throw error(
    400,
    `${label} API key is not set. Add your key in Settings > Models & Keys, then retry.`
  );
}
