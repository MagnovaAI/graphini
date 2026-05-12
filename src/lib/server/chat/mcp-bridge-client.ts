/**
 * Minimal MCP-over-Streamable-HTTP client for the graphini-bridge.
 *
 * One call per chat-tool invocation: open a session with `initialize`,
 * send the required `notifications/initialized`, run one `tools/call`,
 * then drop the session. Vercel functions are short-lived so caching
 * sessions across requests buys us little here.
 *
 * The bridge accepts the bearer token either as `?token=<...>` (matches
 * the paste-the-URL UX) or as `Authorization: Bearer <...>`. We honour
 * whatever is embedded in the user's saved URL — no parsing required.
 */
import { logger } from '$lib/server/logger';

const PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface BridgeCallResult {
  ok: true;
  /** Plain-text content joined from the MCP `content[]` blocks. */
  text: string;
  /** Parsed `structuredContent.result`, if the upstream tool emitted one. */
  structured: unknown;
}

export interface BridgeCallError {
  ok: false;
  /** Model-readable rejection — safe to surface as a tool error. */
  error: string;
  /** Internal hint for logs; not always present. */
  hint?: string;
}

export type BridgeResult = BridgeCallResult | BridgeCallError;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | string;
  result?: {
    content?: { type: string; text?: string }[];
    /**
     * FastMCP returns one of two shapes here depending on the tool's return
     * type. List/string/scalar tools come back as `{ result: <value> }`;
     * dict-returning tools embed their dict directly. Caller normalises.
     */
    structuredContent?: Record<string, unknown> | unknown[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

function pickStructured(envelope: NonNullable<JsonRpcResponse['result']>): unknown {
  const sc = envelope.structuredContent;
  if (sc && typeof sc === 'object' && !Array.isArray(sc) && 'result' in sc) {
    return (sc as { result?: unknown }).result;
  }
  return sc;
}

/**
 * Parse a Streamable-HTTP response body. The bridge returns either:
 *   - a plain JSON envelope, or
 *   - an SSE stream where the JSON-RPC response arrives as one `data:` frame.
 * For our single-shot calls, the first complete JSON object is the answer.
 */
function extractJsonRpcEnvelope(raw: string): JsonRpcResponse | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as JsonRpcResponse;
    } catch {
      return null;
    }
  }

  // SSE: pull the last `data:` line and JSON-parse it.
  let last: string | null = null;
  for (const line of trimmed.split('\n')) {
    const stripped = line.replace(/\r$/, '');
    if (stripped.startsWith('data:')) {
      last = stripped.slice(5).trim();
    }
  }
  if (!last) return null;
  try {
    return JSON.parse(last) as JsonRpcResponse;
  } catch {
    return null;
  }
}

/**
 * Per-bridge call. Opens a session, dispatches one tool, returns the result.
 * Network/parsing/auth errors are mapped into `{ok:false}` with a message
 * the chat tool can surface to the model.
 */
export async function callBridgeTool(
  bridgeUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  options: { timeoutMs?: number } = {}
): Promise<BridgeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const initRes = await fetch(bridgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'graphini', version: '1' }
        }
      })
    });

    if (initRes.status === 401) {
      return { ok: false, error: 'Local bridge rejected the token. Re-paste the URL in Settings.' };
    }
    if (!initRes.ok) {
      return {
        ok: false,
        error: `Local bridge unreachable (HTTP ${initRes.status}). Is the bridge still running on your machine?`
      };
    }

    const sessionId = initRes.headers.get('mcp-session-id');
    if (!sessionId) {
      return { ok: false, error: 'Local bridge did not return a session id.' };
    }
    // Drain the initialize body so the server can finalise the stream.
    await initRes.text();

    await fetch(bridgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': sessionId
      },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    });

    const callRes = await fetch(bridgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Session-Id': sessionId
      },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: toolName, arguments: args }
      })
    });

    if (!callRes.ok) {
      return {
        ok: false,
        error: `Local bridge call failed (HTTP ${callRes.status}).`
      };
    }

    const raw = await callRes.text();
    const envelope = extractJsonRpcEnvelope(raw);
    if (!envelope) {
      return { ok: false, error: 'Local bridge returned an unparseable response.' };
    }
    if (envelope.error) {
      return { ok: false, error: envelope.error.message };
    }
    const result = envelope.result;
    if (!result) {
      return { ok: false, error: 'Local bridge returned an empty result.' };
    }

    const text = (result.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('\n');

    if (result.isError) {
      return { ok: false, error: text || `Local bridge tool "${toolName}" failed.` };
    }

    return { ok: true, text, structured: pickStructured(result) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if ((err as { name?: string }).name === 'AbortError') {
      return { ok: false, error: 'Local bridge timed out.' };
    }
    logger.warn?.('mcp-bridge-client.network-error', { error: msg });
    return { ok: false, error: `Local bridge unreachable: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * One-shot validation used by the settings POST handler to verify a freshly
 * pasted URL before saving it. Returns the bridge's `serverInfo` on success.
 */
export async function probeBridge(
  bridgeUrl: string,
  timeoutMs = 8000
): Promise<
  | { ok: true; serverName: string; serverVersion: string; instructions?: string }
  | { ok: false; error: string }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream'
      },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'graphini', version: '1' }
        }
      })
    });
    if (res.status === 401) {
      return { ok: false, error: 'Bridge rejected the token. Check the URL.' };
    }
    if (!res.ok) {
      return { ok: false, error: `Bridge unreachable (HTTP ${res.status}).` };
    }
    const env = extractJsonRpcEnvelope(await res.text());
    if (!env || env.error) {
      return {
        ok: false,
        error: env?.error?.message ?? 'Bridge returned an unparseable response.'
      };
    }
    const info = (
      env.result as
        | { serverInfo?: { name?: string; version?: string }; instructions?: string }
        | undefined
    )?.serverInfo;
    return {
      ok: true,
      serverName: info?.name ?? 'bridge',
      serverVersion: info?.version ?? '?',
      instructions: (env.result as { instructions?: string } | undefined)?.instructions
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Bridge unreachable: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}
