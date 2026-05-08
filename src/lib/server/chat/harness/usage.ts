import { getDb } from '$lib/server/db';

export function trackUsage(
  usagePromise: PromiseLike<{ inputTokens?: number; outputTokens?: number } | undefined>,
  options: { conversationId: string | null; model: string; userId: string | null }
): void {
  Promise.resolve(usagePromise)
    .then(async (usage) => {
      try {
        if (!options.userId) return;
        const db = getDb();
        const prompt = usage?.inputTokens || 0;
        const completion = usage?.outputTokens || 0;
        await db.createUsageStats({
          completion_tokens: completion,
          conversation_id: options.conversationId,
          credits_charged: 0,
          estimated_cost_usd: 0,
          message_id: null,
          model: options.model,
          prompt_tokens: prompt,
          total_tokens: prompt + completion,
          user_id: options.userId
        });
      } catch (e) {
        console.error('[Usage tracking] Error:', e);
      }
    })
    .catch(() => {
      /* no-op */
    });
}
