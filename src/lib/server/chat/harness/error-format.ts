/**
 * Format an error of unknown shape into a `[CODE] message` string the chat
 * client can render. Covers every shape we've seen in practice:
 *
 *  - `AI_APICallError` from the Vercel AI SDK
 *      → `error.data.error.message` + `error.data.error.code` (parsed body)
 *      → fallback `error.responseBody` (raw upstream JSON)
 *      → fallback `error.statusCode`
 *  - `Error` instances  → `error.message`, `error.cause?.message`
 *  - Plain strings      → returned as-is
 *  - Plain objects      → `error.message`, `error.error.message`, JSON dump
 *  - Anything else      → "Unknown error" (never the empty string)
 *
 * Returning a non-empty string is critical: the AI SDK's `onError` result is
 * sent on the wire as `errorText`, and an empty string makes the chat fall
 * through to a generic "Something went wrong" placeholder.
 *
 * The first call also logs the full raw error to the server console so we
 * can debug shapes that don't extract cleanly.
 */

interface ApiCallErrorShape {
  data?: { error?: { message?: string; code?: number | string; type?: string } };
  responseBody?: string;
  statusCode?: number;
  url?: string;
  message?: string;
  cause?: unknown;
  name?: string;
}

const FALLBACK = 'Unknown error';

function tryParseJson(s: string): { message?: string; code?: number | string } | null {
  try {
    const parsed = JSON.parse(s) as {
      error?: { message?: string; code?: number | string };
      message?: string;
    };
    if (parsed.error?.message) {
      return { message: parsed.error.message, code: parsed.error.code };
    }
    if (parsed.message) return { message: parsed.message };
    return null;
  } catch {
    return null;
  }
}

function extract(error: unknown): { message: string; code?: number | string } {
  if (error == null) return { message: FALLBACK };
  if (typeof error === 'string') return { message: error || FALLBACK };

  // Error instances first — covers built-in errors and most thrown things.
  if (error instanceof Error) {
    const e = error as Error & ApiCallErrorShape;

    // AI_APICallError: parsed `data` is the cleanest source.
    const upstream = e.data?.error?.message;
    if (upstream) {
      return { message: upstream, code: e.data?.error?.code ?? e.statusCode };
    }

    // Try the raw response body if data didn't parse for us.
    if (typeof e.responseBody === 'string' && e.responseBody.trim()) {
      const parsed = tryParseJson(e.responseBody);
      if (parsed?.message) return { message: parsed.message, code: parsed.code ?? e.statusCode };
    }

    // Inspect the cause chain (one level — most useful in practice).
    if (e.cause instanceof Error && e.cause.message) {
      const causeMsg = e.cause.message;
      if (e.message && e.message !== causeMsg) {
        return { message: `${e.message}: ${causeMsg}`, code: e.statusCode };
      }
      return { message: causeMsg, code: e.statusCode };
    }

    // Plain Error.message — last for AI SDK errors because their default
    // `.message` is verbose ("invalid response body" etc.).
    if (e.message) return { message: e.message, code: e.statusCode };

    if (e.statusCode) return { message: `HTTP ${e.statusCode}`, code: e.statusCode };
    return { message: FALLBACK };
  }

  // Plain object (e.g. Vercel AI SDK error symbol-tagged plain object).
  if (typeof error === 'object') {
    const e = error as Record<string, unknown> & ApiCallErrorShape;

    const upstream = e.data?.error?.message;
    if (upstream) {
      return { message: upstream, code: e.data?.error?.code ?? e.statusCode };
    }
    if (typeof e.responseBody === 'string' && e.responseBody.trim()) {
      const parsed = tryParseJson(e.responseBody);
      if (parsed?.message) return { message: parsed.message, code: parsed.code ?? e.statusCode };
    }
    if (typeof e.message === 'string' && e.message) {
      return { message: e.message, code: e.statusCode };
    }
    // Last-ditch: dump a short JSON snippet so the user at least sees something
    // diagnostic instead of a blank red banner.
    try {
      const dump = JSON.stringify(error).slice(0, 400);
      if (dump && dump !== '{}') return { message: dump };
    } catch {
      /* ignore */
    }
  }

  return { message: FALLBACK };
}

export function formatStreamError(error: unknown): string {
  const { message, code } = extract(error);
  // Server log so we can debug shapes we haven't anticipated. Cause chain
  // included because most useful info hides one level deep.
  try {
    console.warn('[chat] stream error:', {
      name: (error as { name?: string } | null)?.name,
      message: (error as { message?: string } | null)?.message,
      code,
      summary: message
    });
  } catch {
    /* ignore */
  }
  const trimmed = message.trim() || FALLBACK;
  return code !== undefined && code !== null && code !== '' ? `[${code}] ${trimmed}` : trimmed;
}
