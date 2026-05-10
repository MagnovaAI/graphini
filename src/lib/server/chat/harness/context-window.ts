import { getDb } from '$lib/server/db';
import { settingsManager } from '$lib/server/state-manager';
import { generateText } from 'ai';
import { getChatProviderOptions, resolveChatModelFor } from '$lib/server/chat/model';
import type { ProviderKeys } from '$lib/server/auth/provider-keys';

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
export const INPUT_CONTEXT_BUDGET_RATIO = 0.82;
export const MIN_RECENT_CONTEXT_TOKENS = 12000;
const SUMMARY_TARGET_TOKENS = 1800;
const CHAT_COMPACTION_CATEGORY = 'chat_compaction';
const CHAT_COMPACTION_MODEL_KEY = 'model';

export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function estimateMessageTokens(message: { content: string; role: unknown }): number {
  return estimateTokens(`${String(message.role)}: ${message.content}`) + 8;
}

export function contextWindowForModel(enabledModel: { max_tokens?: number | null } | null): number {
  const configured = enabledModel?.max_tokens;
  return typeof configured === 'number' && configured > 8000
    ? configured
    : DEFAULT_CONTEXT_WINDOW_TOKENS;
}

export function usableInputBudgetTokens(contextWindowTokens: number): number {
  return Math.floor(contextWindowTokens * INPUT_CONTEXT_BUDGET_RATIO);
}

export function chatHistoryBudgetTokens(options: {
  contextWindowTokens: number;
  fixedPromptTokens: number;
}): number {
  return Math.max(
    MIN_RECENT_CONTEXT_TOKENS,
    usableInputBudgetTokens(options.contextWindowTokens) - options.fixedPromptTokens
  );
}

async function getChatCompactionModel(fallbackModel: string): Promise<string> {
  const configured = await settingsManager.get<string | null>(
    null,
    CHAT_COMPACTION_CATEGORY,
    CHAT_COMPACTION_MODEL_KEY,
    null
  );
  return configured?.trim() || fallbackModel;
}

function transcriptForSummary(messages: { content: string; role: unknown }[]): string {
  return messages
    .map((message) => `${String(message.role).toUpperCase()}: ${message.content}`)
    .join('\n\n');
}

async function summarizeOverflowingHistory(options: {
  fallbackModel: string;
  messages: { content: string; role: unknown }[];
  keys: ProviderKeys;
}): Promise<string> {
  if (options.messages.length === 0) return '';

  const summaryModel = await getChatCompactionModel(options.fallbackModel);
  const summaryEnabledModel = await getDb()
    .getEnabledModel(summaryModel)
    .catch(() => null);
  const providerHint = summaryEnabledModel?.provider || undefined;
  const transcript = transcriptForSummary(options.messages);

  const result = await generateText({
    maxOutputTokens: SUMMARY_TARGET_TOKENS,
    model: resolveChatModelFor(summaryModel, providerHint, options.keys),
    prompt: `Summarize this older conversation history so a later assistant can continue seamlessly.\n\n${transcript}`,
    providerOptions: getChatProviderOptions(summaryModel, providerHint),
    system:
      'You compact chat history for Graphini. Preserve user goals, decisions, constraints, named files, model/tool outcomes, unresolved errors, and any current diagram/code facts. Be concise but complete. Do not invent anything.',
    temperature: 0.2
  });

  return result.text.trim();
}

function truncateMessageContent(content: unknown, maxChars: number): string {
  const text = typeof content === 'string' ? content : String(content ?? '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]`;
}

function scrubAssistantTranscript(content: unknown): string {
  return typeof content === 'string' ? content : String(content ?? '');
}

export async function buildChatContext(
  uiMessages: unknown,
  userContent: string,
  options: {
    contextWindowTokens: number;
    fallbackModel: string;
    fixedPromptTokens: number;
    keys: ProviderKeys;
  }
): Promise<{ compacted: boolean; messages: Record<string, unknown>[]; summary: string }> {
  let history = Array.isArray(uiMessages) ? uiMessages : [];
  const lastUiMessage = history.at(-1);
  if (
    lastUiMessage &&
    typeof lastUiMessage === 'object' &&
    (lastUiMessage as Record<string, unknown>).role === 'user' &&
    String((lastUiMessage as Record<string, unknown>).content ?? '') === userContent
  ) {
    history = history.slice(0, -1);
  }

  const historyMessages = history
    .filter((message): message is Record<string, unknown> => {
      if (!message || typeof message !== 'object') return false;
      return message.role === 'user' || message.role === 'assistant';
    })
    .map((message) => ({
      role: message.role,
      content: truncateMessageContent(
        message.role === 'assistant' ? scrubAssistantTranscript(message.content) : message.content,
        message.role === 'assistant' ? 20000 : 32000
      )
    }))
    .filter((message) => message.content.trim().length > 0);

  const lastHistoryMessage = historyMessages.at(-1);
  const fullMessages =
    lastHistoryMessage?.role === 'user' && lastHistoryMessage.content === userContent
      ? historyMessages
      : [...historyMessages, { role: 'user', content: userContent }];

  const usableBudget = chatHistoryBudgetTokens({
    contextWindowTokens: options.contextWindowTokens,
    fixedPromptTokens: options.fixedPromptTokens
  });

  let recentTokenCount = 0;
  let recentStart = fullMessages.length;
  for (let i = fullMessages.length - 1; i >= 0; i--) {
    const nextTokens = estimateMessageTokens(fullMessages[i]);
    if (recentStart < fullMessages.length && recentTokenCount + nextTokens > usableBudget) {
      break;
    }
    recentTokenCount += nextTokens;
    recentStart = i;
  }

  const olderMessages = fullMessages.slice(0, recentStart);
  const recentMessages = fullMessages.slice(recentStart);
  if (olderMessages.length === 0) {
    return { compacted: false, messages: recentMessages, summary: '' };
  }

  try {
    const summary = await summarizeOverflowingHistory({
      fallbackModel: options.fallbackModel,
      keys: options.keys,
      messages: olderMessages
    });
    return { compacted: true, messages: recentMessages, summary };
  } catch (summaryError) {
    console.warn('[chat] Failed to summarize overflowing history:', summaryError);
    return {
      compacted: true,
      messages: recentMessages,
      summary:
        'Older chat history exceeded the context budget, but automatic summarization failed. Continue using the recent messages only.'
    };
  }
}
