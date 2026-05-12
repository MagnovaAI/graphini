import { runChatTurn } from '$lib/server/chat/harness';
import { getDb } from '$lib/server/db';
import { chatLimiter, getClientKey, rateLimitResponse } from '$lib/server/rate-limit';
import { stateManager } from '$lib/server/state-manager';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
  const rl = chatLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  try {
    const db = getDb();
    const enabledModels = await db.listEnabledModels(true);

    const models = enabledModels.map((m) => ({
      category: m.category || 'General',
      description: m.description || '',
      gemsPerMessage: m.gems_per_message ?? 2,
      id: m.model_id,
      isEnabled: true,
      isFree: m.is_free || false,
      maxTokens: m.max_tokens || 4000,
      name: m.model_name,
      provider: m.provider || 'openrouter',
      toolSupport: m.tool_support || false
    }));

    return json({ success: true, data: models });
  } catch (err) {
    console.error('Failed to fetch models:', err);
    return error(500, 'Failed to fetch models');
  }
};

export const POST: RequestHandler = async ({ request }) => {
  const rl = chatLimiter.check(getClientKey(request));
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs ?? 0);

  try {
    return await runChatTurn(request);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    console.error('Chat server error:', err);
    const errorMessage = err instanceof Error ? err.message : 'Internal server error';
    console.error('Error details:', errorMessage);
    stateManager
      .logError(err instanceof Error ? err : new Error(errorMessage), {
        metadata: { endpoint: '/api/chat', model: 'unknown' }
      })
      .catch(() => {
        /* no-op */
      });
    return error(500, errorMessage);
  }
};

// CORS preflight handler intentionally removed. The chat endpoint is
// only consumed by the same-origin app shell. A wildcard CORS preflight
// combined with credentialed cookies would let cross-origin sites trigger
// chat actions on behalf of signed-in users.
