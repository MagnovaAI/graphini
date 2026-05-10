import { validateSessionOrGuest } from '$lib/server/auth';
import { extractProviderKeys, missingProviderKeyError } from '$lib/server/auth/provider-keys';
import { graphiniMcpTools } from '$lib/server/agents/tool-catalog';
import { getDb } from '$lib/server/db';
import type { NeonAdapter } from '$lib/server/db/neon-adapter';
import { workspaceFiles } from '$lib/server/db/schema';
import { hasProviderKey, normalizeChatModelId, resolveChatModelFor } from '$lib/server/chat/model';
import type { ChatProvider } from '$lib/server/chat/model';
import { isToolInventoryRequest } from '$lib/server/chat/tool-gating';
import { createDiagramTools } from '$lib/server/chat/tools';
import { error } from '@sveltejs/kit';
import type { ToolSet } from 'ai';
import { and, eq } from 'drizzle-orm';
import {
  buildChatContext,
  chatHistoryBudgetTokens,
  contextWindowForModel,
  estimateTokens,
  usableInputBudgetTokens
} from './context-window';
import { formatStreamError } from './error-format';
import { runChatStream } from './loop';
import { getPersistedDisabledTools } from './settings';
import { buildLeanSystemPrompt } from './system-prompt';
import { trackUsage } from './usage';
import type {
  ActiveFileContext,
  PersonalizationContext,
  PersonalizationRuleContext,
  PersonalizationSkillContext,
  WorkspaceToolContext
} from './types';

interface ChatRequestBody {
  message?: string;
  model?: string;
  messages?: unknown;
  sessionId?: string;
  conversationId?: string;
  enabledTools?: unknown;
  personalization?: unknown;
  engine?: string;
  activeTabId?: string;
  activeTabName?: string;
  activeTabEngine?: string;
  workspaceTabs?: unknown;
  /** ID of a workspace file the user has selected. When present, file-aware
   *  tools route reads and writes through that file. */
  activeFileId?: string | null;
}

const COMPACTED_HISTORY_HEADER = 'Compacted prior chat history:';

interface ContextUsageEvent {
  breakdown: {
    messages: number;
    summary: number;
    system: number;
    tools: number;
  };
  budgetTokens: number;
  compacted: boolean;
  contextWindow: number;
  contextWindowPercent: number;
  estimated: boolean;
  historyBudgetTokens: number;
  percent: number;
  type: 'context-usage';
  usedTokens: number;
}

interface FinalUsageEvent {
  budgetTokens: number;
  compacted: boolean;
  contextWindow: number;
  contextWindowPercent: number;
  estimatedUsedTokens: number;
  historyBudgetTokens: number;
  inputTokens: number;
  outputTokens: number;
  percent: number;
  totalTokens: number;
  type: 'context-usage-final';
  usedTokens: number;
}

function readString(value: unknown, max = 1200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function parsePersonalization(value: unknown): PersonalizationContext {
  if (!value || typeof value !== 'object') return { personas: [], rules: [], skills: [] };
  const record = value as Record<string, unknown>;
  const personas = Array.isArray(record.personas)
    ? record.personas
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const row = item as Record<string, unknown>;
          const name = readString(row.name, 120);
          const body = readString(row.body, 1600);
          if (!name || !body) return null;
          return { body, name };
        })
        .filter((item): item is { body: string; name: string } => Boolean(item))
        .slice(0, 8)
    : [];
  const rules: PersonalizationRuleContext[] = Array.isArray(record.rules)
    ? record.rules
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const row = item as Record<string, unknown>;
          const name = readString(row.name, 120);
          const body = readString(row.body, 1600);
          if (!name || !body) return null;
          return { body, name };
        })
        .filter((item): item is PersonalizationRuleContext => Boolean(item))
        .slice(0, 12)
    : [];
  const skills: PersonalizationSkillContext[] = Array.isArray(record.skills)
    ? record.skills
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const row = item as Record<string, unknown>;
          const name = readString(row.name, 120);
          const description = readString(row.description, 1600);
          if (!name || !description) return null;
          return { description, name };
        })
        .filter((item): item is PersonalizationSkillContext => Boolean(item))
        .slice(0, 12)
    : [];
  const availableSkills: PersonalizationSkillContext[] = Array.isArray(record.availableSkills)
    ? record.availableSkills
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const row = item as Record<string, unknown>;
          const name = readString(row.name, 120);
          const description = readString(row.description, 8000);
          if (!name || !description) return null;
          return { description, name };
        })
        .filter((item): item is PersonalizationSkillContext => Boolean(item))
        .slice(0, 30)
    : skills;
  return { availableSkills, personas, rules, skills };
}

function buildWorkspaceContext(body: ChatRequestBody): {
  activeEngine: string;
  workspaceContext: WorkspaceToolContext;
} {
  const activeEngine =
    typeof body.activeTabEngine === 'string'
      ? body.activeTabEngine
      : typeof body.engine === 'string'
        ? body.engine
        : 'mermaid';

  const workspaceContext: WorkspaceToolContext = {
    activeEngine,
    activeTabId: typeof body.activeTabId === 'string' ? body.activeTabId : undefined,
    activeTabName: typeof body.activeTabName === 'string' ? body.activeTabName : undefined,
    tabs: Array.isArray(body.workspaceTabs)
      ? body.workspaceTabs
          .filter(
            (tab: Record<string, unknown>) =>
              typeof tab.title === 'string' && typeof tab.engine === 'string'
          )
          .map((tab: Record<string, unknown>) => ({
            engine: tab.engine as string,
            id: typeof tab.id === 'string' ? tab.id : undefined,
            title: tab.title as string
          }))
      : undefined
  };

  return { activeEngine, workspaceContext };
}

/**
 * Resolve `activeFileId` to a row this user owns. Returns null when the id is
 * missing, malformed, or doesn't belong to the user — file-aware tools then
 * have nothing to operate on.
 */
async function resolveActiveFile(
  userId: string,
  activeFileId: string | null | undefined
): Promise<{ context: ActiveFileContext; content: string } | null> {
  if (!activeFileId) return null;
  const db = (getDb() as NeonAdapter).db;
  const [row] = await db
    .select({
      id: workspaceFiles.id,
      path: workspaceFiles.path,
      kind: workspaceFiles.kind,
      content: workspaceFiles.content
    })
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.id, activeFileId), eq(workspaceFiles.user_id, userId)));
  if (!row) return null;
  return {
    context: {
      id: row.id,
      path: row.path,
      kind: row.kind as ActiveFileContext['kind']
    },
    content: row.content
  };
}

function estimatePayloadMessageTokens(messages: Record<string, unknown>[]): number {
  return messages.reduce((total, message) => {
    const role = String(message.role ?? '');
    const content =
      typeof message.content === 'string' ? message.content : String(message.content ?? '');
    return total + estimateTokens(`${role}: ${content}`) + 8;
  }, 0);
}

function estimateToolSchemaTokens(toolNames: Set<string>): number {
  const descriptors = graphiniMcpTools
    .filter((tool) => toolNames.has(tool.name))
    .map((tool) => ({
      description: tool.description,
      inputSchema: tool.inputSchema,
      name: tool.name
    }));
  return estimateTokens(JSON.stringify(descriptors));
}

function usagePercent(usedTokens: number, budgetTokens: number): number {
  return budgetTokens > 0 ? Math.min(100, Math.round((usedTokens / budgetTokens) * 100)) : 0;
}

function buildContextUsageEvent(options: {
  budgetTokens: number;
  compacted: boolean;
  contextWindow: number;
  historyBudgetTokens: number;
  messages: Record<string, unknown>[];
  system: string;
  summary: string;
  toolSchemaTokens: number;
}): ContextUsageEvent {
  const breakdown = {
    messages: estimatePayloadMessageTokens(options.messages),
    summary: options.summary
      ? estimateTokens(`${COMPACTED_HISTORY_HEADER}\n${options.summary}`)
      : 0,
    system: estimateTokens(options.system),
    tools: options.toolSchemaTokens
  };
  const usedTokens = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return {
    breakdown,
    budgetTokens: options.budgetTokens,
    compacted: options.compacted,
    contextWindow: options.contextWindow,
    contextWindowPercent: usagePercent(usedTokens, options.contextWindow),
    estimated: true,
    historyBudgetTokens: options.historyBudgetTokens,
    percent: usagePercent(usedTokens, options.budgetTokens),
    type: 'context-usage',
    usedTokens
  };
}

function encodeSse(data: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

async function usageWithTimeout(
  usagePromise: PromiseLike<{ inputTokens?: number; outputTokens?: number } | undefined>
): Promise<{ inputTokens?: number; outputTokens?: number } | undefined> {
  return Promise.race([
    Promise.resolve(usagePromise).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(resolve, 1500))
  ]);
}

function withContextUsageEvents(
  response: Response,
  initialUsage: ContextUsageEvent,
  usagePromise: PromiseLike<{ inputTokens?: number; outputTokens?: number } | undefined>
): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
    },
    async start(controller) {
      controller.enqueue(encodeSse(initialUsage));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
        const usage = await usageWithTimeout(usagePromise);
        const inputTokens = usage?.inputTokens ?? 0;
        if (inputTokens > 0) {
          const outputTokens = usage?.outputTokens ?? 0;
          const finalUsage: FinalUsageEvent = {
            budgetTokens: initialUsage.budgetTokens,
            compacted: initialUsage.compacted,
            contextWindow: initialUsage.contextWindow,
            contextWindowPercent: usagePercent(inputTokens, initialUsage.contextWindow),
            estimatedUsedTokens: initialUsage.usedTokens,
            historyBudgetTokens: initialUsage.historyBudgetTokens,
            inputTokens,
            outputTokens,
            percent: usagePercent(inputTokens, initialUsage.budgetTokens),
            totalTokens: inputTokens + outputTokens,
            type: 'context-usage-final',
            usedTokens: inputTokens
          };
          controller.enqueue(encodeSse(finalUsage));
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    }
  });
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/event-stream; charset=utf-8');
  headers.delete('content-length');
  return new Response(stream, {
    headers,
    status: response.status,
    statusText: response.statusText
  });
}

export async function runChatTurn(request: Request): Promise<Response> {
  const body = (await request.clone().json()) as ChatRequestBody;
  const { message, model, conversationId, sessionId, enabledTools, messages: uiMessages } = body;

  if (!message || !model) {
    throw error(400, 'Message and model are required');
  }

  const turnSessionId = sessionId ?? conversationId ?? 'default';

  const user = await validateSessionOrGuest(request).catch((authErr) => {
    console.warn('Auth check during chat:', authErr);
    return null;
  });
  if (!user) {
    throw error(401, 'Authentication required. Please sign in to use the chat.');
  }
  const userId = user.id;

  const db = getDb();
  const enabledModel = await db.getEnabledModel(model).catch(() => null);
  if (!enabledModel || !enabledModel.is_enabled) {
    const hasUserProviderPrefix = /^(openrouter|openai|anthropic)[/:]/.test(model);
    if (!hasUserProviderPrefix) {
      throw error(400, `Model "${model}" is not enabled. Pick a different model and try again.`);
    }
  }
  const providerHint = enabledModel?.provider || undefined;
  const normalizedModel = normalizeChatModelId(model, providerHint);
  const { modelId: actualModelId } = normalizedModel;
  const keys = extractProviderKeys(request);
  const normalizedProvider = normalizedModel.provider as ChatProvider;
  if (!hasProviderKey(normalizedProvider, keys)) {
    // Throws a 400 with a Settings-routable message keyed by provider.
    missingProviderKeyError(
      normalizedProvider === 'anthropic'
        ? 'anthropic'
        : normalizedProvider === 'openai'
          ? 'openai'
          : 'openrouter'
    );
  }

  const { activeEngine, workspaceContext } = buildWorkspaceContext(body);
  const personalization = parsePersonalization(body.personalization);
  // Active file (when set) is the source of truth for file-aware tools.
  const activeFile = await resolveActiveFile(user.id, body.activeFileId).catch(() => null);
  if (activeFile) workspaceContext.activeFile = activeFile.context;
  const activeSource = activeFile?.content ?? '';

  const recentMessages = Array.isArray(uiMessages)
    ? uiMessages
        .filter(
          (item: unknown): item is { content?: unknown; role?: unknown } =>
            Boolean(item) && typeof item === 'object'
        )
        .slice(-4)
    : undefined;
  // The model picks which tools to use. We expose the entire catalog and only
  // honor an explicit per-user opt-out from the settings panel — except when
  // the user is asking us to inventory our tools, in which case we override
  // the disables for that one turn so we can answer truthfully.
  const toolInventoryRequest = isToolInventoryRequest(message, { recentMessages });
  // Per-turn guard for the unified fileSystem tool (read-before-line-edit).
  // Reset every chat turn.
  const fileSystemGuard = { listed: false, readPaths: new Set<string>() };
  const toolCatalog = createDiagramTools(
    turnSessionId,
    actualModelId,
    workspaceContext,
    userId,
    fileSystemGuard,
    keys,
    personalization.availableSkills ?? []
  );
  // Denylist semantics: any tool the user has explicitly disabled is
  // filtered out. Tools that are missing from the persisted config (because
  // they shipped after the user last touched settings — e.g. `fileSystem`
  // after the diagram*/markdown* consolidation) default to enabled. The
  // client `enabledTools` array is treated as the inverse: tools NOT in
  // that array are considered explicitly disabled by the current session.
  const persistedDisabledSet = await getPersistedDisabledTools(userId);
  const allToolNames = Object.keys(toolCatalog);
  const clientDisabledSet =
    Array.isArray(enabledTools) && enabledTools.every((t) => typeof t === 'string')
      ? new Set(allToolNames.filter((name) => !(enabledTools as string[]).includes(name)))
      : null;
  const disabledSet = persistedDisabledSet ?? clientDisabledSet ?? new Set<string>();
  const filteredTools: Partial<typeof toolCatalog> = {};
  for (const [key, value] of Object.entries(toolCatalog)) {
    if (!toolInventoryRequest && disabledSet.has(key)) continue;
    (filteredTools as Record<string, typeof value>)[key] = value;
  }
  const allTools = filteredTools as typeof toolCatalog;
  const exposedToolNames = new Set(Object.keys(allTools));

  const systemPrompt = buildLeanSystemPrompt(workspaceContext, exposedToolNames, {
    includeFullToolCatalog: true,
    mermaidSourceIsEmpty: activeEngine === 'mermaid' && !activeSource.trim(),
    personalization
  });

  const contextWindow = contextWindowForModel(enabledModel);
  const budgetTokens = usableInputBudgetTokens(contextWindow);
  const systemPromptTokens = estimateTokens(systemPrompt);
  const toolSchemaTokens = estimateToolSchemaTokens(exposedToolNames);
  const fixedPromptTokens = systemPromptTokens + toolSchemaTokens;
  const historyBudgetTokens = chatHistoryBudgetTokens({
    contextWindowTokens: contextWindow,
    fixedPromptTokens
  });
  const chatContext = await buildChatContext(uiMessages, message, {
    contextWindowTokens: contextWindow,
    fallbackModel: model,
    fixedPromptTokens,
    keys
  });
  const system = chatContext.summary
    ? `${systemPrompt}\n\n${COMPACTED_HISTORY_HEADER}\n${chatContext.summary}`
    : systemPrompt;
  const contextUsage = buildContextUsageEvent({
    budgetTokens,
    compacted: chatContext.compacted,
    contextWindow,
    historyBudgetTokens,
    messages: chatContext.messages,
    summary: chatContext.summary,
    system: systemPrompt,
    toolSchemaTokens
  });

  const resolvedModel = resolveChatModelFor(model, providerHint, keys);
  const result = runChatStream({
    abortSignal: request.signal,
    messages: chatContext.messages,
    model: resolvedModel,
    modelId: model,
    providerHint,
    system,
    tools: allTools as unknown as ToolSet
  });

  trackUsage(result.usage, {
    conversationId: conversationId ?? null,
    model,
    userId
  });

  const streamResponse = result.toUIMessageStreamResponse({
    // No CORS headers — same-origin only. See /api/chat/+server.ts comment.
    sendReasoning: true,
    // The AI SDK's default error handler scrubs provider errors to a generic
    // "An error occurred" string. Surface the real message instead — most
    // upstream failures (model deprecated, paid model gated, rate limit,
    // bad API key) carry a useful, user-actionable line in error.data /
    // error.responseBody. Falling back to message keeps generic Errors
    // intact (e.g. fetch aborts).
    onError: (error) => formatStreamError(error)
  });
  return withContextUsageEvents(streamResponse, contextUsage, result.usage);
}
