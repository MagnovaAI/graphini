import { describe, expect, it, vi } from 'vitest';
import { generateText, stepCountIs, tool } from 'ai';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  getChatProviderOptions,
  loadAnthropicApiKey,
  loadAnthropicAuthToken,
  loadOpenRouterApiKey,
  normalizeChatModelId,
  resolveChatModel,
  type ChatProvider
} from '../../src/lib/server/chat/model';
import {
  defaultOpenRouterDiagramModel,
  searchProviderModels
} from '../../src/lib/server/model-lab';
import { selectToolNamesForRequest } from '../../src/lib/server/chat/tool-gating';
import { applyDiagramLinePatch } from '../../src/lib/server/chat/tools/diagramPatch';
import { findMermaidSyntaxErrors } from '../../src/lib/server/chat/tools/errorChecker';
import { createIconSearchTool } from '../../src/lib/server/chat/tools/iconSearch';
import {
  classifySvgColorMode,
  resolveIconCandidatesForNode,
  resolveIconForNode
} from '../../src/lib/server/chat/tools/icon-resolver';
import { diagramStore } from '../../src/lib/server/chat/state';
import {
  agentToolNames,
  graphiniMcpTools,
  listMcpTools,
  listMcpToolsForAgent,
  type GraphiniAgentId
} from '../../src/lib/server/agents/tool-catalog';
import { GET as getMcpTools, POST as postMcpTools } from '../../src/routes/api/mcp/tools/+server';
import { POST as postA2A } from '../../src/routes/api/a2a/+server';

type TestJsonBody = Record<string, unknown> & {
  error: {
    data: {
      fieldErrors: {
        message: unknown;
      };
    };
  };
  result: {
    artifacts: [
      {
        artifactId: unknown;
        parts: [{ data: unknown; text?: string }, ...{ data?: unknown; text?: string }[]];
      },
      ...{ artifactId?: unknown; parts: { data?: unknown; text?: string }[] }[]
    ];
    contextId: unknown;
    history: unknown[];
    id: unknown;
    metadata: {
      selectedAgent: unknown;
    };
    status: {
      message: {
        parts: [{ text: string }, ...{ text?: string }[]];
      };
      state: unknown;
    };
    tools: unknown;
  };
};

interface LiveIntentCase {
  expectedTools: string[];
  forbiddenTools: string[];
  id: string;
  intent: string;
  prompt: string;
  requiredOutputPattern?: RegExp;
  seededDiagram?: string;
}

interface LiveModelTraceResult {
  finishReason: unknown;
  response: {
    messages: unknown;
  };
  steps: {
    content: unknown;
    finishReason: unknown;
    stepNumber: number;
    text: string;
    toolCalls: { toolName: string }[];
    toolResults: unknown;
    usage: unknown;
  }[];
  text: string;
  toolCalls: unknown;
  toolResults: unknown;
  totalUsage: unknown;
  usage: unknown;
  warnings: unknown;
}

interface IconSearchTestResult {
  colorMode?: string;
  queryFallback?: string;
  success: boolean;
  suggestions: { colorMode?: string; source?: string; status: 'matched' | 'skipped' }[];
  summary: string;
}

async function readJson(response: Response): Promise<TestJsonBody> {
  return (await response.json()) as TestJsonBody;
}

function toolNamesForAgent(agentId: GraphiniAgentId): string[] {
  return listMcpToolsForAgent(agentId).map((tool) => tool.name);
}

async function mcpPost(body: unknown): Promise<Response> {
  return await postMcpTools({
    request: new Request('http://localhost/api/mcp/tools', {
      body: JSON.stringify(body),
      method: 'POST'
    })
  } as Parameters<typeof postMcpTools>[0]);
}

async function a2aPost(body: string | Record<string, unknown>): Promise<Response> {
  return await postA2A({
    request: new Request('http://localhost/api/a2a', {
      body: typeof body === 'string' ? body : JSON.stringify(body),
      method: 'POST'
    })
  } as Parameters<typeof postA2A>[0]);
}

function messageSendRequest(
  text: string,
  id: string | number = 'route-test'
): Record<string, unknown> {
  return {
    id,
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: {
        messageId: `message-${id}`,
        parts: [{ kind: 'text', text }],
        role: 'user'
      }
    }
  };
}

const liveHarnessTrace = process.env.RUN_LIVE_MODEL_TRACE === 'true' ? it : it.skip;
const testLogsDir = path.resolve(process.cwd(), 'tests/logs');
const expectedAgentIds = [
  'code-agent',
  'critic',
  'data-agent',
  'diagram-engineer',
  'document-agent',
  'orchestrator',
  'planner',
  'research-agent',
  'visual-polish'
] satisfies GraphiniAgentId[];
const expectedMcpToolNames = [
  'actionItemExtractor',
  'askQuestions',
  'diagramRead',
  'codeRead',
  'codeWrite',
  'codePatch',
  'diagramWrite',
  'diagramPatch',
  'dataAnalyzer',
  'diagramDelete',
  'errorChecker',
  'styleSearch',
  'iconSearch',
  'longTermMemory',
  'markdownRead',
  'markdownWrite',
  'webSearch',
  'planWithProgress',
  'planner',
  'thinking',
  'selfCritique',
  'fileManager',
  'sequentialThinking',
  'gitGuard',
  'subagentFanout',
  'subagentAssemble',
  'tableAnalytics'
] as const;
const expectedToolRequiredInputs = {
  actionItemExtractor: ['source'],
  askQuestions: ['context', 'questions'],
  codePatch: ['content', 'endLine', 'startLine'],
  codeRead: [],
  codeWrite: ['content', 'language'],
  dataAnalyzer: ['fileId', 'operation'],
  diagramDelete: [],
  diagramPatch: ['content', 'endLine', 'startLine'],
  diagramRead: [],
  diagramWrite: ['content'],
  errorChecker: [],
  fileManager: ['operation'],
  gitGuard: ['operation'],
  iconSearch: [],
  longTermMemory: ['operation'],
  markdownRead: [],
  markdownWrite: ['content'],
  planner: ['task'],
  planWithProgress: ['operation'],
  selfCritique: ['target'],
  sequentialThinking: ['thought', 'thoughtNumber', 'totalThoughts'],
  subagentAssemble: ['outputs', 'runId'],
  subagentFanout: ['agents', 'task'],
  styleSearch: [],
  tableAnalytics: ['source'],
  thinking: ['focus', 'summary'],
  webSearch: ['query']
} satisfies Record<(typeof expectedMcpToolNames)[number], string[]>;
const expectedAgentToolNames = {
  'code-agent': ['codeRead', 'codeWrite', 'codePatch', 'gitGuard'],
  critic: ['diagramRead', 'markdownRead', 'selfCritique', 'errorChecker'],
  'data-agent': ['fileManager', 'tableAnalytics', 'dataAnalyzer'],
  'diagram-engineer': [
    'diagramRead',
    'diagramWrite',
    'diagramPatch',
    'diagramDelete',
    'errorChecker'
  ],
  'document-agent': ['markdownRead', 'markdownWrite', 'fileManager', 'actionItemExtractor'],
  orchestrator: [
    'askQuestions',
    'thinking',
    'planner',
    'planWithProgress',
    'sequentialThinking',
    'longTermMemory',
    'gitGuard',
    'subagentFanout',
    'subagentAssemble'
  ],
  planner: ['thinking', 'planner', 'planWithProgress', 'sequentialThinking'],
  'research-agent': ['webSearch', 'fileManager'],
  'visual-polish': ['diagramRead', 'diagramPatch', 'styleSearch', 'iconSearch', 'errorChecker']
} satisfies Record<GraphiniAgentId, string[]>;
const routingExamples = [
  {
    agentId: 'data-agent',
    reason: 'The request references files or tabular data.',
    text: 'Analyze this uploaded CSV table with rows and columns'
  },
  {
    agentId: 'code-agent',
    reason: 'The request asks for non-Mermaid code output.',
    text: 'Generate a TypeScript code artifact'
  },
  {
    agentId: 'critic',
    reason: 'The request asks for quality or correctness review.',
    text: 'Review and validate this diagram for missing best practices'
  },
  {
    agentId: 'document-agent',
    reason: 'The request targets prose documentation.',
    text: 'Write a markdown summary document for these notes'
  },
  {
    agentId: 'visual-polish',
    reason: 'The request asks for visual refinement.',
    text: 'Polish the colors and layout'
  },
  {
    agentId: 'planner',
    reason: 'The request needs planning or architecture decomposition.',
    text: 'Plan a multi-step system architecture trade-off'
  },
  {
    agentId: 'diagram-engineer',
    reason: 'The request is best handled as diagram work.',
    text: 'Create a flowchart for account signup'
  }
] satisfies { agentId: GraphiniAgentId; reason: string; text: string }[];
const liveIntentCases: LiveIntentCase[] = [
  {
    expectedTools: ['diagramWrite'],
    forbiddenTools: ['codeWrite', 'markdownWrite'],
    id: 'new-diagram',
    intent: 'new_diagram',
    prompt: 'Create a signup flow with email verification and workspace setup.',
    requiredOutputPattern:
      /\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)\b/i
  },
  {
    expectedTools: ['codeWrite'],
    forbiddenTools: ['diagramWrite', 'markdownWrite'],
    id: 'code-config',
    intent: 'code_artifact',
    prompt:
      'Create a JSON config for signup states with started, email_entered, verified, workspace_created, and done.',
    requiredOutputPattern: /^\s*[{[]/
  },
  {
    expectedTools: [],
    forbiddenTools: ['diagramWrite', 'codeWrite'],
    id: 'plain-explanation',
    intent: 'prose_answer',
    prompt: 'Explain the signup flow in one short paragraph.',
    requiredOutputPattern: /\bsignup\b/i
  },
  {
    expectedTools: ['errorChecker'],
    forbiddenTools: ['codeWrite', 'markdownWrite'],
    id: 'syntax-check',
    intent: 'diagram_validation',
    prompt: 'Check the current diagram for syntax issues.',
    seededDiagram: 'flowchart TD\n  Start --> Email\n  Email --> Verify\n  Verify --> Done'
  }
];

function timestampForFilename(date = new Date()): string {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function selectedLiveIntentCases(): LiveIntentCase[] {
  const selected = process.env.HARNESS_TRACE_CASE ?? 'new-diagram';
  if (selected === 'all') return liveIntentCases;
  return liveIntentCases.filter((intentCase) => intentCase.id === selected);
}

function liveTraceProvider(): Extract<ChatProvider, 'anthropic' | 'openrouter'> {
  return process.env.HARNESS_TRACE_PROVIDER === 'anthropic' ? 'anthropic' : 'openrouter';
}

async function loadLiveTraceApiKey(provider: Extract<ChatProvider, 'anthropic' | 'openrouter'>) {
  if (provider === 'anthropic') {
    const [apiKey, authToken] = await Promise.all([
      loadAnthropicApiKey(),
      loadAnthropicAuthToken()
    ]);
    return authToken || apiKey;
  }
  return await loadOpenRouterApiKey();
}

function defaultLiveTraceModel(provider: Extract<ChatProvider, 'anthropic' | 'openrouter'>) {
  return provider === 'anthropic' ? 'claude-3-5-haiku-latest' : defaultOpenRouterDiagramModel;
}

describe('server harness MCP catalog', () => {
  it('publishes the complete expected MCP tool surface in order', () => {
    expect(listMcpTools().map((tool) => tool.name)).toEqual(expectedMcpToolNames);
  });

  it('publishes unique MCP tools with object input schemas', () => {
    const tools = listMcpTools();
    const names = tools.map((tool) => tool.name);

    expect(tools.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(tools).toBe(graphiniMcpTools);

    for (const tool of tools) {
      expect(tool.description).not.toBe('');
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('keeps every tool schema contract explicit and closed to extra input', () => {
    for (const tool of listMcpTools()) {
      const expectedRequired =
        expectedToolRequiredInputs[tool.name as keyof typeof expectedToolRequiredInputs];

      expect(
        expectedRequired,
        `${tool.name} must be listed in expectedToolRequiredInputs`
      ).toBeDefined();
      expect(tool.title, `${tool.name} title`).toBeTruthy();
      expect(tool.inputSchema.required ?? [], `${tool.name} required inputs`).toEqual(
        expectedRequired
      );
      expect(
        Object.keys(tool.inputSchema.properties ?? {}),
        `${tool.name} exposes schema properties for each required input`
      ).toEqual(expect.arrayContaining(expectedRequired));
      expect(tool.inputSchema.additionalProperties, `${tool.name} closes extra input`).toBe(false);
    }
  });

  it('keeps the complete expected agent roster and tool allowlists', () => {
    expect(Object.keys(agentToolNames).sort()).toEqual([...expectedAgentIds].sort());
    expect(agentToolNames).toEqual(expectedAgentToolNames);
  });

  it('keeps every agent tool allowlist resolvable through the catalog', () => {
    const catalogNames = new Set(listMcpTools().map((tool) => tool.name));

    for (const [agentId, allowedNames] of Object.entries(agentToolNames) as [
      GraphiniAgentId,
      string[]
    ][]) {
      const tools = listMcpToolsForAgent(agentId);

      expect(tools.map((tool) => tool.name)).toEqual(
        listMcpTools()
          .filter((tool) => allowedNames.includes(tool.name))
          .map((tool) => tool.name)
      );

      for (const name of allowedNames) {
        expect(catalogNames.has(name), `${agentId} references ${name}`).toBe(true);
      }
    }
  });

  it('keeps every agent allowlist free of duplicate tool names', () => {
    for (const [agentId, allowedNames] of Object.entries(agentToolNames) as [
      GraphiniAgentId,
      string[]
    ][]) {
      expect(new Set(allowedNames).size, `${agentId} has duplicate tools`).toBe(
        allowedNames.length
      );
      expect(new Set(toolNamesForAgent(agentId)), `${agentId} returned tools`).toEqual(
        new Set(allowedNames)
      );
    }
  });

  it('marks mutating and read-only tools with consistent annotations', () => {
    const toolsByName = new Map(listMcpTools().map((tool) => [tool.name, tool]));

    for (const name of [
      'diagramWrite',
      'diagramPatch',
      'diagramDelete',
      'codeWrite',
      'codePatch',
      'markdownWrite'
    ]) {
      expect(toolsByName.get(name)?.annotations?.destructiveHint, `${name} mutates`).toBe(true);
    }

    for (const name of [
      'diagramRead',
      'codeRead',
      'markdownRead',
      'errorChecker',
      'selfCritique'
    ]) {
      expect(toolsByName.get(name)?.annotations?.readOnlyHint, `${name} reads`).toBe(true);
    }
  });
});

describe('server harness MCP endpoint', () => {
  it('lists tools over GET', async () => {
    const response = await getMcpTools({} as Parameters<typeof getMcpTools>[0]);
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.tools).toEqual(listMcpTools());
  });

  it('returns a JSON-RPC tools/list result over POST and preserves request id', async () => {
    const response = await mcpPost({ id: 'tools-1', jsonrpc: '2.0', method: 'tools/list' });
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'tools-1',
      jsonrpc: '2.0',
      result: { tools: listMcpTools() }
    });
  });

  it('preserves numeric and null JSON-RPC ids over POST', async () => {
    await expect(readJson(await mcpPost({ id: 7, jsonrpc: '2.0', method: 'tools/list' }))).resolves;

    const numericBody = await readJson(
      await mcpPost({ id: 7, jsonrpc: '2.0', method: 'tools/list' })
    );
    const nullBody = await readJson(
      await mcpPost({ id: null, jsonrpc: '2.0', method: 'tools/list' })
    );

    expect(numericBody.id).toBe(7);
    expect(nullBody.id).toBeNull();
  });

  it('treats malformed POST bodies as anonymous tools/list requests', async () => {
    const response = await postMcpTools({
      request: new Request('http://localhost/api/mcp/tools', {
        body: '{',
        method: 'POST'
      })
    } as Parameters<typeof postMcpTools>[0]);
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.id).toBeNull();
    expect(body.result.tools).toEqual(listMcpTools());
  });
});

describe('server harness A2A endpoint', () => {
  it('rejects invalid JSON-RPC requests', async () => {
    const response = await a2aPost('{');
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: -32600,
        message: 'Request body must be valid JSON.'
      },
      id: null,
      jsonrpc: '2.0'
    });
  });

  it('rejects unsupported methods with a JSON-RPC method-not-found error', async () => {
    const response = await a2aPost({
      id: 'bad-method',
      jsonrpc: '2.0',
      method: 'tasks/get',
      params: {}
    });
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      error: {
        code: -32601,
        message: 'Unsupported A2A method: tasks/get'
      },
      id: 'bad-method',
      jsonrpc: '2.0'
    });
  });

  it('rejects message/send requests with invalid params', async () => {
    const response = await a2aPost({
      id: 'invalid-params',
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'message-invalid',
          parts: [],
          role: 'user'
        }
      }
    });
    const body = await readJson(response);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: -32602,
        message: 'Invalid message/send params.'
      },
      id: 'invalid-params',
      jsonrpc: '2.0'
    });
    expect(body.error.data.fieldErrors.message).toEqual([
      'Too small: expected array to have >=1 items'
    ]);
  });

  it('routes code requests to the code agent and returns its MCP tools', async () => {
    const response = await a2aPost({
      id: 42,
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          contextId: 'context-1',
          messageId: 'message-1',
          parts: [{ kind: 'text', text: 'Generate a TypeScript code artifact' }],
          role: 'user',
          taskId: 'task-1'
        }
      }
    });
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.id).toBe(42);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.result).toMatchObject({
      contextId: 'context-1',
      id: 'task-1',
      kind: 'task',
      metadata: { selectedAgent: 'code-agent' },
      status: { state: 'completed' }
    });
    expect(body.result.artifacts[0].parts[0].data).toEqual({
      agentId: 'code-agent',
      mcpTools: toolNamesForAgent('code-agent'),
      reason: 'The request asks for non-Mermaid code output.'
    });
  });

  it('generates task and context ids when the caller omits them', async () => {
    const response = await a2aPost({
      id: 'generated-ids',
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'message-generated-ids',
          parts: [{ kind: 'text', text: 'Create a flowchart for account signup' }],
          role: 'user'
        }
      }
    });
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.result).toMatchObject({
      kind: 'task',
      metadata: { selectedAgent: 'diagram-engineer' },
      status: { state: 'completed' }
    });
    expect(body.result.id).toEqual(expect.any(String));
    expect(body.result.contextId).toEqual(expect.any(String));
    expect(body.result.artifacts[0].artifactId).toEqual(expect.any(String));
    expect(body.result.history).toHaveLength(2);
  });

  it.each(routingExamples)(
    'routes $agentId prompts with matching tool access',
    async ({ agentId, reason, text }) => {
      const response = await a2aPost(messageSendRequest(text, agentId));
      const body = await readJson(response);

      expect(response.status).toBe(200);
      expect(body.result.metadata.selectedAgent).toBe(agentId);
      expect(body.result.artifacts[0].parts[0].data).toEqual({
        agentId,
        mcpTools: toolNamesForAgent(agentId),
        reason
      });
      expect(body.result.status.message.parts[0].text).toContain(`Accepted by ${agentId}`);
    }
  );

  it('extracts text only from mixed message parts when routing', async () => {
    const response = await a2aPost({
      id: 'mixed-parts',
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          messageId: 'message-mixed-parts',
          parts: [
            { data: { hint: 'json should not win without text' }, kind: 'data' },
            { kind: 'text', text: 'Please polish the visual layout' }
          ],
          role: 'user'
        }
      }
    });
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(body.result.metadata.selectedAgent).toBe('visual-polish');
  });
});

describe('server harness model routing', () => {
  it('normalizes provider-prefixed model ids', () => {
    expect(normalizeChatModelId('openrouter/anthropic/claude-sonnet-4.5')).toEqual({
      modelId: 'anthropic/claude-sonnet-4.5',
      provider: 'openrouter'
    });
    expect(normalizeChatModelId('openai:gpt-5.1')).toEqual({
      modelId: 'gpt-5.1',
      provider: 'openai'
    });
    expect(normalizeChatModelId('anthropic/claude-sonnet-4.5')).toEqual({
      modelId: 'claude-sonnet-4.5',
      provider: 'anthropic'
    });
  });

  it('uses provider hints for unprefixed native provider models', () => {
    expect(normalizeChatModelId('gpt-5.1', 'OpenAI')).toEqual({
      modelId: 'gpt-5.1',
      provider: 'openai'
    });
    expect(normalizeChatModelId('claude-sonnet-4.5', 'anthropic')).toEqual({
      modelId: 'claude-sonnet-4.5',
      provider: 'anthropic'
    });
    expect(normalizeChatModelId('openai/gpt-5.1', 'openrouter')).toEqual({
      modelId: 'gpt-5.1',
      provider: 'openai'
    });
  });

  it('defaults unknown or unhinted models to OpenRouter', () => {
    expect(normalizeChatModelId('google/gemini-2.5-pro')).toEqual({
      modelId: 'google/gemini-2.5-pro',
      provider: 'openrouter'
    });
    expect(normalizeChatModelId('gpt-5.1', 'local')).toEqual({
      modelId: 'gpt-5.1',
      provider: 'openrouter'
    });
  });

  it('returns native provider options only for native providers', () => {
    expect(getChatProviderOptions('openai/gpt-5.1')).toEqual({
      openai: {
        reasoningEffort: 'medium',
        reasoningSummary: 'auto',
        store: false
      }
    });
    expect(getChatProviderOptions('claude-sonnet-4.5', 'anthropic')).toEqual({
      anthropic: {
        contextManagement: {
          edits: [
            {
              keep: { type: 'thinking_turns', value: 1 },
              type: 'clear_thinking_20251015'
            }
          ]
        },
        sendReasoning: true,
        thinking: { display: 'summarized', type: 'adaptive' },
        toolStreaming: true
      }
    });
    expect(getChatProviderOptions('claude-haiku-4-5-20251001', 'anthropic')).toEqual({
      anthropic: {
        toolStreaming: true
      }
    });
    expect(getChatProviderOptions('openrouter/openai/gpt-5.1')).toBeUndefined();
  });
});

describe('chat request tool gating', () => {
  it('keeps casual turns tool-free', () => {
    expect([...selectToolNamesForRequest('Hey', { activeEngine: 'mermaid' })]).toEqual([]);
  });

  it('exposes standard Mermaid editing tools for non-casual diagram turns', () => {
    const tools = selectToolNamesForRequest('Please fix this Mermaid syntax error', {
      activeEngine: 'mermaid'
    });

    expect(tools.has('diagramRead')).toBe(true);
    expect(tools.has('diagramPatch')).toBe(true);
    expect(tools.has('errorChecker')).toBe(true);
    expect(tools.has('styleSearch')).toBe(true);
    expect(tools.has('iconSearch')).toBe(true);
  });

  it('keeps icon discovery available for ordinary Mermaid edits', () => {
    const plainDiagramTools = selectToolNamesForRequest('Add more nodes and connections', {
      activeEngine: 'mermaid'
    });
    const iconTools = selectToolNamesForRequest('Add icons to this architecture diagram', {
      activeEngine: 'mermaid'
    });

    expect(plainDiagramTools.has('iconSearch')).toBe(true);
    expect(iconTools.has('iconSearch')).toBe(true);
    expect(iconTools.has('diagramPatch')).toBe(true);
    expect(iconTools.has('diagramWrite')).toBe(false);
  });

  it('exposes icon tooling for short color icon follow-ups', () => {
    const colouredIconTools = selectToolNamesForRequest('Coloured icons?', {
      activeEngine: 'mermaid'
    });
    const bareIconTools = selectToolNamesForRequest('icons?', {
      activeEngine: 'mermaid'
    });

    expect(colouredIconTools.has('iconSearch')).toBe(true);
    expect(colouredIconTools.has('styleSearch')).toBe(true);
    expect(colouredIconTools.has('diagramRead')).toBe(true);
    expect(colouredIconTools.has('diagramPatch')).toBe(true);
    expect(bareIconTools.has('iconSearch')).toBe(true);
    expect(bareIconTools.has('diagramPatch')).toBe(true);
  });

  it('exposes diagram edit tooling for implementation follow-ups', () => {
    for (const prompt of ['Lets implement the improvements', 'go ahead', 'do it', 'WTF']) {
      const tools = selectToolNamesForRequest(prompt, {
        activeEngine: 'mermaid'
      });

      expect(tools.has('diagramRead')).toBe(true);
      expect(tools.has('diagramPatch')).toBe(true);
      expect(tools.has('errorChecker')).toBe(true);
    }
  });

  it('uses full diagram writes only for new diagrams', () => {
    const createTools = selectToolNamesForRequest('Create a new architecture diagram', {
      activeEngine: 'mermaid'
    });
    const editTools = selectToolNamesForRequest('Add a Redis cache node', {
      activeEngine: 'mermaid'
    });

    expect(createTools.has('diagramWrite')).toBe(true);
    expect(editTools.has('diagramWrite')).toBe(false);
    expect(editTools.has('diagramPatch')).toBe(true);
  });

  it('exposes self critique and edit tools for review requests', () => {
    const tools = selectToolNamesForRequest('Use self critique tool to review this diagram', {
      activeEngine: 'mermaid'
    });

    expect(tools.has('selfCritique')).toBe(true);
    expect(tools.has('diagramRead')).toBe(true);
    expect(tools.has('diagramPatch')).toBe(true);
    expect(tools.has('errorChecker')).toBe(true);
  });

  it('exposes the requestable catalog for tool inventory questions', () => {
    const tools = selectToolNamesForRequest('What tools do you have available?', {
      activeEngine: 'mermaid'
    });

    expect(tools.has('selfCritique')).toBe(true);
    expect(tools.has('longTermMemory')).toBe(true);
    expect(tools.has('fileManager')).toBe(true);
    expect(tools.has('diagramRead')).toBe(true);
  });

  it('treats tool inventory follow-ups as inventory questions', () => {
    const tools = selectToolNamesForRequest('thats it ?', {
      activeEngine: 'mermaid',
      recentMessages: [
        {
          content:
            'The tools available to me are diagramRead, diagramPatch, errorChecker, iconSearch, and styleSearch.',
          role: 'assistant'
        }
      ]
    });

    expect(tools.has('selfCritique')).toBe(true);
    expect(tools.has('longTermMemory')).toBe(true);
    expect(tools.has('webSearch')).toBe(true);
  });

  it('exposes explicitly named advanced tools', () => {
    const namedTools = selectToolNamesForRequest(
      'Use autoStyler, iconifier, sequentialThinking, and planWithProgress',
      {
        activeEngine: 'mermaid'
      }
    );

    expect(namedTools.has('autoStyler')).toBe(true);
    expect(namedTools.has('iconifier')).toBe(true);
    expect(namedTools.has('sequentialThinking')).toBe(true);
    expect(namedTools.has('planWithProgress')).toBe(true);
  });

  it('exposes specialized diagram tools for visual and delete requests', () => {
    const styleTools = selectToolNamesForRequest('Polish the visual style and add icons', {
      activeEngine: 'mermaid'
    });
    const deleteTools = selectToolNamesForRequest('Clear the whole diagram', {
      activeEngine: 'mermaid'
    });

    expect(styleTools.has('autoStyler')).toBe(true);
    expect(styleTools.has('iconifier')).toBe(true);
    expect(deleteTools.has('diagramDelete')).toBe(true);
  });

  it('does not expose subagent tools just because a prior fanout happened', () => {
    const tools = selectToolNamesForRequest('Add more nodes and connections', {
      activeEngine: 'mermaid',
      continuingAfterFanout: true
    });

    expect(tools.has('subagentFanout')).toBe(false);
    expect(tools.has('subagentAssemble')).toBe(false);
  });

  it('does not expose subagent tools for pasted or diagnostic subagent mentions', () => {
    const tools = selectToolNamesForRequest('Why did it use specialist subagents here?', {
      activeEngine: 'mermaid'
    });

    expect(tools.has('subagentFanout')).toBe(false);
    expect(tools.has('subagentAssemble')).toBe(false);
  });

  it('exposes subagent tools only for explicit subagent requests', () => {
    const tools = selectToolNamesForRequest(
      'Use specialist subagents to review this architecture diagram',
      {
        activeEngine: 'mermaid'
      }
    );

    expect(tools.has('subagentFanout')).toBe(true);
    expect(tools.has('subagentAssemble')).toBe(true);
  });
});

describe('diagram patch tool', () => {
  const baseDiagram = [
    'flowchart TD',
    '  Start[Start] --> Email[Email]',
    '  Email --> Done[Done]'
  ].join('\n');

  it('applies focused replacement lines without rewriting the whole diagram', () => {
    const result = applyDiagramLinePatch({
      content: '  Start[Start] --> Verify[Verify Email]',
      diagram: baseDiagram,
      endLine: 2,
      startLine: 2
    });

    if (!result.success) throw new Error(result.error);
    expect(result.content).toBe(
      ['flowchart TD', '  Start[Start] --> Verify[Verify Email]', '  Email --> Done[Done]'].join(
        '\n'
      )
    );
    expect(result.replacedLineCount).toBe(1);
  });

  it('rejects full Mermaid documents sent through diagramPatch', () => {
    const result = applyDiagramLinePatch({
      content: [
        'flowchart TD',
        '  Start[Start] --> Email[Email]',
        '  Email --> Verify[Verify]',
        '  Verify --> Workspace[Workspace]',
        '  Workspace --> Done[Done]'
      ].join('\n'),
      diagram: baseDiagram,
      endLine: 3,
      startLine: 1
    });

    if (result.success) throw new Error('Expected full-document patch to be rejected.');
    expect(result.error).toContain('full Mermaid document');
  });

  it('allows a focused line-one repair for a missing Mermaid root declaration', () => {
    const result = applyDiagramLinePatch({
      content: 'flowchart TD\nsubgraph UserServices',
      diagram: 'subgraph UserServices\n  React[Video Streaming UI]\nend',
      endLine: 1,
      startLine: 1
    });

    if (!result.success) throw new Error(result.error);
    expect(result.content).toBe(
      'flowchart TD\nsubgraph UserServices\n  React[Video Streaming UI]\nend'
    );
  });

  it('normalizes literal escaped quotes in Mermaid patch content', () => {
    const result = applyDiagramLinePatch({
      content: '  User[\\"👤 User/Client\\"]\n  Web[\\"🌐 Web Browser\\"]',
      diagram: 'flowchart TD\n  User[User]\n  Web[Web]',
      endLine: 3,
      startLine: 2
    });

    if (!result.success) throw new Error(result.error);
    expect(result.content).toBe('flowchart TD\n  User["👤 User/Client"]\n  Web["🌐 Web Browser"]');
  });
});

describe('server Mermaid syntax checker', () => {
  it('catches parser-level Mermaid syntax errors', async () => {
    const errors = await findMermaidSyntaxErrors('flowchart TD\n  A[Start --> B[Done]');

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].line).toBe(2);
    expect(errors[0].message).toContain('Parse error');
  });

  it('accepts valid flowchart icon annotations used by the canvas renderer', async () => {
    const errors = await findMermaidSyntaxErrors(
      [
        'flowchart TD',
        '  React[Video Streaming UI]',
        '  React@{ img: "/icons/react.svg", pos: "b", w: 60, h: 60, constraint: "on" }',
        '  React --> API[API]'
      ].join('\n')
    );

    expect(errors).toEqual([]);
  });
});

describe('server icon search', () => {
  const iconSearchDiagram = [
    'flowchart TD',
    '  Web["🌐 Web Browser"]',
    '  Mobile["📱 Mobile App"]',
    '  Web --> LB["⚖️ Load Balancer"]',
    '  LB --> SearchIdx["🔎 Search Index<br/>Elasticsearch"]'
  ].join('\n');

  it('falls back to diagram nodes when a broad query filters out every node', async () => {
    const sessionId = 'icon-search-query-fallback';
    diagramStore.set(sessionId, iconSearchDiagram);

    const iconSearch = createIconSearchTool({ sessionId });
    const result = (await iconSearch.execute?.(
      { query: 'icons' },
      {} as never
    )) as IconSearchTestResult;

    expect(result?.success).toBe(true);
    expect(result?.queryFallback).toContain('No nodes matched query "icons"');
    expect(result?.summary).not.toContain('across 0 nodes');
    expect(result?.suggestions.some((suggestion) => suggestion.status === 'matched')).toBe(true);

    diagramStore.delete(sessionId);
  });

  it('does not resolve SearchIdx to an unrelated short substring match', async () => {
    const result = await resolveIconForNode('SearchIdx', '🔎 Search Index<br/>Elasticsearch');

    expect(result?.iconId).not.toBe('arc');
    expect(result?.iconId).toMatch(/search|elastic/i);
  });

  it('classifies local icons by color mode and filters iconSearch by that mode', async () => {
    const sessionId = 'icon-search-color-mode';
    diagramStore.set(sessionId, ['flowchart TD', '  Search[Search]'].join('\n'));

    const iconSearch = createIconSearchTool({ sessionId });
    const result = (await iconSearch.execute?.(
      { colorMode: 'noncolor', includeWebSuggestions: false, nodeIds: ['Search'] },
      {} as never
    )) as IconSearchTestResult;

    expect(result?.success).toBe(true);
    expect(result?.colorMode).toBe('noncolor');
    expect(result?.suggestions[0]?.status).toBe('matched');
    expect(result?.suggestions[0]?.colorMode).toBe('noncolor');

    diagramStore.delete(sessionId);
  });

  it('detects multicolor and monochrome SVG content', () => {
    expect(
      classifySvgColorMode(
        '<svg><path fill="#61DAFB" d="M0 0h10v10H0z"/><path fill="#222" d="M1 1h8v8H1z"/></svg>'
      )
    ).toBe('color');
    expect(
      classifySvgColorMode('<svg><path fill="none" stroke="currentColor" d="M0 0h10v10H0z"/></svg>')
    ).toBe('noncolor');
  });

  it('only returns verified non-404 web icon suggestions', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/search?')) {
        return new Response(JSON.stringify({ icons: ['logos:missing', 'logos:react'] }), {
          headers: { 'content-type': 'application/json' },
          status: 200
        });
      }
      if (url.endsWith('/logos/missing.svg')) {
        return new Response('not found', { status: 404 });
      }
      if (url.endsWith('/logos/react.svg')) {
        return new Response('<svg><path fill="#61DAFB" d="M0 0h10v10H0z"/></svg>', {
          headers: { 'content-type': 'image/svg+xml' },
          status: 200
        });
      }
      return new Response('not found', { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const candidates = await resolveIconCandidatesForNode('zzzz-no-local-match', '', {
        colorMode: 'color',
        includeWebSuggestions: true,
        localLimit: 0,
        webLimit: 2
      });

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        colorMode: 'color',
        iconId: 'logos:react',
        source: 'web',
        url: 'https://api.iconify.design/logos/react.svg'
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('server harness live model trace', () => {
  liveHarnessTrace(
    'runs natural intent prompts and logs selected tools, steps, and usage',
    async () => {
      const provider = liveTraceProvider();
      const apiKey = await loadLiveTraceApiKey(provider);
      expect(
        apiKey,
        `${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENROUTER_API_KEY'} must be set for RUN_LIVE_MODEL_TRACE=true, or saved in Settings > Model Access.`
      ).toBeTruthy();

      const modelId = process.env.HARNESS_TRACE_MODEL ?? defaultLiveTraceModel(provider);
      const intentCases: LiveIntentCase[] =
        process.env.HARNESS_TRACE_PROMPT === undefined
          ? selectedLiveIntentCases()
          : [
              {
                expectedTools: [],
                forbiddenTools: [],
                id: 'custom',
                intent: 'custom',
                prompt: process.env.HARNESS_TRACE_PROMPT
              }
            ];
      let modelMatches: unknown[] = [];
      let modelSearchError: string | undefined;
      try {
        modelMatches = await searchProviderModels({
          limit: 10,
          provider,
          query: provider === 'anthropic' ? 'haiku' : 'nemotron'
        });
      } catch (error) {
        modelSearchError = error instanceof Error ? error.message : String(error);
      }

      const traces: Record<string, unknown>[] = [];
      let benchmarkError: unknown;
      for (const intentCase of intentCases) {
        const startedAt = performance.now();
        const traceEvents: Record<string, unknown>[] = [];
        let diagramContent = intentCase.seededDiagram ?? '';
        let codeContent = '';
        let markdownContent = '';
        let result: LiveModelTraceResult | undefined;
        try {
          result = (await generateText({
            experimental_onToolCallFinish: (event) => {
              traceEvents.push({ event: 'toolCallFinish', ...event });
            },
            experimental_onToolCallStart: (event) => {
              traceEvents.push({ event: 'toolCallStart', ...event });
            },
            maxOutputTokens: 700,
            model: resolveChatModel(modelId, provider),
            prompt: intentCase.prompt,
            stopWhen: stepCountIs(3),
            system:
              'Infer the user intent from natural language. Choose tools only when they are useful. Use diagramWrite only for Mermaid diagrams, codeWrite only for code or config artifacts, markdownWrite only for prose documents, and errorChecker only to validate an existing Mermaid diagram. If the user only asks for a short explanation, answer directly without mutating artifacts.',
            temperature: 0,
            tools: {
              codeWrite: tool({
                description:
                  'Create or replace a non-Mermaid code/config artifact such as JSON, YAML, TypeScript, JavaScript, CSS, or plaintext code. Do not use for Mermaid diagrams or prose explanations.',
                execute: async ({ content, language, purpose }) => {
                  codeContent = content;
                  return {
                    accepted: true,
                    content,
                    language,
                    lineCount: content.split('\n').length,
                    purpose
                  };
                },
                inputSchema: z.object({
                  content: z.string().min(1),
                  language: z.enum([
                    'json',
                    'yaml',
                    'typescript',
                    'javascript',
                    'css',
                    'html',
                    'markdown',
                    'text'
                  ]),
                  purpose: z.string().optional()
                })
              }),
              diagramWrite: tool({
                description:
                  'Create or replace a Mermaid diagram. Use this when the user wants a flowchart, sequence diagram, architecture diagram, graph, or other diagram artifact. Input must be Mermaid syntax only.',
                execute: async ({ content, purpose }) => {
                  diagramContent = content;
                  return {
                    accepted: true,
                    content,
                    lineCount: content.split('\n').length,
                    purpose,
                    startsWithDiagramKeyword:
                      /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)\b/i.test(
                        content.trim()
                      )
                  };
                },
                inputSchema: z.object({
                  content: z.string().min(1),
                  purpose: z.string().optional()
                })
              }),
              errorChecker: tool({
                description:
                  'Validate the current Mermaid diagram syntax. Use when the user asks to check or validate a diagram.',
                execute: async () => ({
                  errors: [],
                  hasDiagram: diagramContent.trim().length > 0,
                  valid: true
                }),
                inputSchema: z.object({})
              }),
              markdownWrite: tool({
                description:
                  'Write prose documentation, notes, or explanatory markdown. Do not use for Mermaid diagram source or JSON/config/code artifacts.',
                execute: async ({ content, purpose }) => {
                  markdownContent = content;
                  return {
                    accepted: true,
                    content,
                    lineCount: content.split('\n').length,
                    purpose
                  };
                },
                inputSchema: z.object({
                  content: z.string().min(1),
                  purpose: z.string().optional()
                })
              })
            }
          })) as LiveModelTraceResult;
        } catch (error) {
          benchmarkError = error;
          traces.push({
            elapsedMs: Math.round(performance.now() - startedAt),
            error: error instanceof Error ? error.message : String(error),
            expectedTools: intentCase.expectedTools,
            forbiddenTools: intentCase.forbiddenTools,
            intent: intentCase.intent,
            prompt: intentCase.prompt,
            traceEvents
          });
          break;
        }

        if (!result) {
          throw new Error('Live model trace did not return a result.');
        }

        const elapsedMs = Math.round(performance.now() - startedAt);
        const calledTools = result.steps.flatMap((step) =>
          step.toolCalls.map((toolCall) => toolCall.toolName)
        );
        const artifactOutput = diagramContent || codeContent || markdownContent;
        const modelOutput = artifactOutput || result.text.trim();
        const trace = {
          calledTools,
          codeContent,
          diagramContent,
          elapsedMs,
          expectedTools: intentCase.expectedTools,
          finishReason: result.finishReason,
          forbiddenTools: intentCase.forbiddenTools,
          intent: intentCase.intent,
          modelId,
          modelOutput,
          prompt: intentCase.prompt,
          responseMessages: result.response.messages,
          steps: result.steps.map((step) => ({
            content: step.content,
            finishReason: step.finishReason,
            stepNumber: step.stepNumber,
            text: step.text,
            toolCalls: step.toolCalls,
            toolResults: step.toolResults,
            usage: step.usage
          })),
          text: result.text,
          toolCalls: result.toolCalls,
          toolResults: result.toolResults,
          totalUsage: result.totalUsage,
          traceEvents,
          usage: result.usage,
          warnings: result.warnings
        };
        traces.push(trace);

        for (const expectedTool of intentCase.expectedTools) {
          expect(calledTools, `${intentCase.id} should use ${expectedTool}`).toContain(
            expectedTool
          );
        }
        for (const forbiddenTool of intentCase.forbiddenTools) {
          expect(calledTools, `${intentCase.id} should not use ${forbiddenTool}`).not.toContain(
            forbiddenTool
          );
        }
        if (intentCase.requiredOutputPattern) {
          expect(modelOutput).toMatch(intentCase.requiredOutputPattern);
        }
      }

      const logPath = path.join(
        testLogsDir,
        `server-harness-${provider}-${modelId.replaceAll('/', '-').replaceAll(':', '-')}-intent-${intentCases
          .map((intentCase) => intentCase.id)
          .join('+')}-trace-${timestampForFilename()}.json`
      );
      const trace = {
        cases: traces,
        modelId,
        modelMatches,
        modelSearchError,
        provider
      };
      await mkdir(testLogsDir, { recursive: true });
      await writeFile(logPath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

      console.info(`LIVE_HARNESS_MODEL_TRACE_LOG ${logPath}`);
      console.info(`LIVE_HARNESS_MODEL_TRACE ${JSON.stringify(trace, null, 2)}`);
      if (benchmarkError) throw benchmarkError;
    },
    120_000
  );

  liveHarnessTrace.skip(
    'runs the legacy forced diagramWrite diagnostic',
    async () => {
      const apiKey = await loadOpenRouterApiKey();
      expect(
        apiKey,
        'OPENROUTER_API_KEY must be set for RUN_LIVE_MODEL_TRACE=true, or saved in Settings > Model Access.'
      ).toBeTruthy();

      const prompt =
        process.env.HARNESS_TRACE_PROMPT ??
        'Create a Mermaid flowchart for account signup. Include Start, enter email, verify email, create workspace, and Done. Call diagramWrite with the Mermaid source and purpose.';
      const modelId = process.env.HARNESS_TRACE_MODEL ?? defaultOpenRouterDiagramModel;
      const purpose =
        process.env.HARNESS_TRACE_PURPOSE ??
        'Verify the live OpenRouter diagram model can produce valid Mermaid and use the diagramWrite tool with observable trace data.';
      const toolMode = process.env.HARNESS_TRACE_TOOL_MODE ?? 'diagramWrite';
      const modelMatches = await searchProviderModels({
        limit: 10,
        provider: 'openrouter',
        query: 'nemotron'
      });
      const startedAt = performance.now();

      const traceEvents: Record<string, unknown>[] = [];
      const result =
        toolMode === 'none'
          ? await generateText({
              maxOutputTokens: 900,
              model: resolveChatModel(modelId, 'openrouter'),
              prompt,
              temperature: 0
            })
          : await generateText({
              experimental_onToolCallFinish: (event) => {
                traceEvents.push({ event: 'toolCallFinish', ...event });
              },
              experimental_onToolCallStart: (event) => {
                traceEvents.push({ event: 'toolCallStart', ...event });
              },
              maxOutputTokens: 500,
              model: resolveChatModel(modelId, 'openrouter'),
              prompt,
              stopWhen: stepCountIs(1),
              temperature: 0,
              toolChoice: 'required',
              tools: {
                diagramWrite: tool({
                  description: 'Write the Mermaid diagram source produced by the model.',
                  execute: async ({ content, purpose }) => {
                    const lines = content.split('\n');
                    return {
                      accepted: true,
                      content,
                      lineCount: lines.length,
                      purpose,
                      startsWithDiagramKeyword:
                        /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)\b/i.test(
                          content.trim()
                        )
                    };
                  },
                  inputSchema: z.object({
                    content: z.string().min(1),
                    purpose: z
                      .string()
                      .min(1)
                      .describe('Short reason this diagram is being generated for the trace log')
                  })
                })
              }
            });

      const elapsedMs = Math.round(performance.now() - startedAt);
      const diagramToolResult = result.steps
        .flatMap((step) => step.toolResults)
        .find((toolResult) => toolResult.toolName === 'diagramWrite');
      const diagramContent =
        toolMode === 'none'
          ? result.text.trim()
          : diagramToolResult && 'output' in diagramToolResult
            ? ((diagramToolResult.output as { content?: string }).content ?? '')
            : '';
      const trace = {
        diagramContent,
        elapsedMs,
        finishReason: result.finishReason,
        modelId,
        modelMatches,
        provider: 'openrouter',
        prompt,
        purpose,
        responseMessages: result.response.messages,
        steps: result.steps.map((step) => ({
          content: step.content,
          finishReason: step.finishReason,
          stepNumber: step.stepNumber,
          text: step.text,
          toolCalls: step.toolCalls,
          toolResults: step.toolResults,
          usage: step.usage
        })),
        text: result.text,
        modelOutput: result.text.trim() || diagramContent,
        toolCalls: result.toolCalls,
        toolMode,
        toolResults: result.toolResults,
        totalUsage: result.totalUsage,
        traceEvents,
        usage: result.usage,
        warnings: result.warnings
      };
      const logPath = path.join(
        testLogsDir,
        `server-harness-openrouter-nemotron-diagram-${toolMode}-trace-${timestampForFilename()}.json`
      );
      await mkdir(testLogsDir, { recursive: true });
      await writeFile(logPath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

      console.info(`LIVE_HARNESS_MODEL_TRACE_LOG ${logPath}`);
      console.info(`LIVE_HARNESS_MODEL_TRACE ${JSON.stringify(trace, null, 2)}`);

      if (toolMode !== 'none') {
        expect(result.steps.some((step) => step.toolCalls.length > 0)).toBe(true);
        expect(result.steps.some((step) => step.toolResults.length > 0)).toBe(true);
      }
      expect(diagramContent).toMatch(
        /\b(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph)\b/i
      );
      expect(diagramContent.length).toBeGreaterThan(0);
    },
    60_000
  );
});
