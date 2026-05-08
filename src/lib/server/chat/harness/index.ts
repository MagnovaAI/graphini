import { validateSessionOrGuest } from '$lib/server/auth';
import { getDb } from '$lib/server/db';
import {
  hasProviderCredentialFor,
  loadProviderApiKeys,
  missingProviderCredentialMessage,
  normalizeChatModelId,
  resolveChatModelFor
} from '$lib/server/chat/model';
import type { ChatProvider } from '$lib/server/chat/model';
import { codeStore, diagramStore, markdownStore } from '$lib/server/chat/state';
import { isToolInventoryRequest } from '$lib/server/chat/tool-gating';
import { createDiagramTools } from '$lib/server/chat/tools';
import { error } from '@sveltejs/kit';
import type { ToolSet } from 'ai';
import { buildChatContext, contextWindowForModel, estimateTokens } from './context-window';
import { runChatStream } from './loop';
import { getPersistedEnabledTools } from './settings';
import { buildLeanSystemPrompt } from './system-prompt';
import { trackUsage } from './usage';
import type { WorkspaceToolContext } from './types';

interface ChatRequestBody {
  message?: string;
  model?: string;
  currentDiagram?: string;
  currentCode?: string;
  currentMarkdown?: string;
  messages?: unknown;
  sessionId?: string;
  conversationId?: string;
  enabledTools?: unknown;
  engine?: string;
  activeTabId?: string;
  activeTabName?: string;
  activeTabEngine?: string;
  workspaceTabs?: unknown;
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

function persistActiveTabSource(
  sessionId: string,
  activeEngine: string,
  body: ChatRequestBody
): string {
  const activeSource =
    typeof body.currentCode === 'string'
      ? body.currentCode
      : typeof body.currentDiagram === 'string'
        ? body.currentDiagram
        : '';
  if (activeEngine === 'mermaid') {
    diagramStore.set(sessionId, activeSource);
  } else {
    codeStore.set(sessionId, activeSource);
  }
  if (body.currentMarkdown !== undefined) {
    markdownStore.set(sessionId, body.currentMarkdown);
  }
  return activeSource;
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
    throw error(400, `Model "${model}" is not enabled. Pick a different model and try again.`);
  }
  const providerHint = enabledModel.provider || undefined;
  const normalizedModel = normalizeChatModelId(model, providerHint);
  const { modelId: actualModelId } = normalizedModel;
  await loadProviderApiKeys();
  const normalizedProvider = normalizedModel.provider as ChatProvider;
  if (!(await hasProviderCredentialFor(normalizedProvider, userId))) {
    throw error(400, missingProviderCredentialMessage(normalizedProvider));
  }

  const { activeEngine, workspaceContext } = buildWorkspaceContext(body);
  const activeSource = persistActiveTabSource(turnSessionId, activeEngine, body);

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
  const toolCatalog = createDiagramTools(turnSessionId, actualModelId, workspaceContext);
  const clientEnabledSet = Array.isArray(enabledTools) ? new Set(enabledTools as string[]) : null;
  const persistedEnabledSet = await getPersistedEnabledTools(userId);
  const enabledSet = persistedEnabledSet ?? clientEnabledSet;
  const filteredTools: Partial<typeof toolCatalog> = {};
  for (const [key, value] of Object.entries(toolCatalog)) {
    if (!toolInventoryRequest && enabledSet && !enabledSet.has(key)) continue;
    (filteredTools as Record<string, typeof value>)[key] = value;
  }
  const allTools = filteredTools as typeof toolCatalog;
  const exposedToolNames = new Set(Object.keys(allTools));

  const systemPrompt = buildLeanSystemPrompt(workspaceContext, exposedToolNames, {
    includeFullToolCatalog: true,
    mermaidSourceIsEmpty: activeEngine === 'mermaid' && !activeSource.trim()
  });

  const chatContext = await buildChatContext(uiMessages, message, {
    contextWindowTokens: contextWindowForModel(enabledModel),
    fallbackModel: model,
    systemPromptTokens: estimateTokens(systemPrompt)
  });
  const system = chatContext.summary
    ? `${systemPrompt}\n\nCompacted prior chat history:\n${chatContext.summary}`
    : systemPrompt;

  const resolvedModel = await resolveChatModelFor(userId, model, providerHint);
  const result = runChatStream({
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

  return result.toUIMessageStreamResponse({
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    sendReasoning: true
  });
}
