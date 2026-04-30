import {
  a2aJsonRpcRequestSchema,
  a2aSendMessageParamsSchema,
  jsonRpcError,
  jsonRpcResult,
  textFromMessage,
  type A2AArtifact,
  type A2AMessage,
  type A2ATask
} from '$lib/server/agents/a2a';
import { listMcpToolsForAgent, type GraphiniAgentId } from '$lib/server/agents/tool-catalog';
import type { RequestHandler } from './$types';

interface AgentRoute {
  agentId: GraphiniAgentId;
  reason: string;
}

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INVALID_REQUEST = -32600;

function routeToAgent(prompt: string): AgentRoute {
  const normalized = prompt.toLowerCase();

  if (/\b(csv|xlsx|spreadsheet|table|rows|columns|uploaded file|attachment)\b/.test(normalized)) {
    return { agentId: 'data-agent', reason: 'The request references files or tabular data.' };
  }

  if (
    /\b(json|yaml|yml|toml|typescript|javascript|svelte|html|css|config|code artifact)\b/.test(
      normalized
    )
  ) {
    return { agentId: 'code-agent', reason: 'The request asks for non-Mermaid code output.' };
  }

  if (/\b(review|critique|quality|missing|best practice|validate|check)\b/.test(normalized)) {
    return { agentId: 'critic', reason: 'The request asks for quality or correctness review.' };
  }

  if (/\b(document|docs|markdown|notes|summary|plan document|write up)\b/.test(normalized)) {
    return { agentId: 'document-agent', reason: 'The request targets prose documentation.' };
  }

  if (/\b(style|color|icon|polish|readable|layout|pretty|visual)\b/.test(normalized)) {
    return { agentId: 'visual-polish', reason: 'The request asks for visual refinement.' };
  }

  if (
    /\b(plan|design|architecture|system|multi-step|think|trade-off|tradeoff)\b/.test(normalized)
  ) {
    return {
      agentId: 'planner',
      reason: 'The request needs planning or architecture decomposition.'
    };
  }

  return { agentId: 'diagram-engineer', reason: 'The request is best handled as diagram work.' };
}

function agentMessage(
  messageId: string,
  text: string,
  taskId: string,
  contextId: string
): A2AMessage {
  return {
    contextId,
    kind: 'message',
    messageId,
    parts: [{ kind: 'text', text }],
    role: 'agent',
    taskId
  };
}

function createRoutingTask(userMessage: A2AMessage): A2ATask {
  const prompt = textFromMessage(userMessage);
  const route = routeToAgent(prompt);
  const taskId = userMessage.taskId ?? crypto.randomUUID();
  const contextId = userMessage.contextId ?? crypto.randomUUID();
  const now = new Date().toISOString();

  const artifact: A2AArtifact = {
    artifactId: crypto.randomUUID(),
    name: 'agent-routing',
    parts: [
      {
        data: {
          agentId: route.agentId,
          mcpTools: listMcpToolsForAgent(route.agentId).map((tool) => tool.name),
          reason: route.reason
        },
        kind: 'data'
      }
    ]
  };

  return {
    artifacts: [artifact],
    contextId,
    history: [
      userMessage,
      agentMessage(
        crypto.randomUUID(),
        `Routed to ${route.agentId}. ${route.reason}`,
        taskId,
        contextId
      )
    ],
    id: taskId,
    kind: 'task',
    metadata: {
      selectedAgent: route.agentId
    },
    status: {
      message: agentMessage(
        crypto.randomUUID(),
        `Accepted by ${route.agentId}. Execution wiring is ready for the specialist runtime.`,
        taskId,
        contextId
      ),
      state: 'completed',
      timestamp: now
    }
  };
}

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, INVALID_REQUEST, 'Request body must be valid JSON.');
  }

  const rpc = a2aJsonRpcRequestSchema.safeParse(body);
  if (!rpc.success) {
    return jsonRpcError(
      null,
      INVALID_REQUEST,
      'Invalid JSON-RPC 2.0 request.',
      rpc.error.flatten()
    );
  }

  if (rpc.data.method !== 'message/send') {
    return jsonRpcError(
      rpc.data.id,
      METHOD_NOT_FOUND,
      `Unsupported A2A method: ${rpc.data.method}`
    );
  }

  const params = a2aSendMessageParamsSchema.safeParse(rpc.data.params);
  if (!params.success) {
    return jsonRpcError(
      rpc.data.id,
      INVALID_PARAMS,
      'Invalid message/send params.',
      params.error.flatten()
    );
  }

  return jsonRpcResult(rpc.data.id, createRoutingTask(params.data.message));
};
