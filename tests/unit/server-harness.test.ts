import { describe, expect, it } from 'vitest';
import { graphiniMcpTools, listMcpTools } from '../../src/lib/server/agents/tool-catalog';
import {
  chatHistoryBudgetTokens,
  usableInputBudgetTokens
} from '../../src/lib/server/chat/harness/context-window';
import { validateSingleMermaidDocument } from '../../src/lib/server/chat/mermaid';
import { GET as getMcpTools, POST as postMcpTools } from '../../src/routes/api/mcp/tools/+server';

const expectedToolNames = [
  'askQuestions',
  'dataAnalyzer',
  'errorChecker',
  'styleSearch',
  'autoStyler',
  'iconSearch',
  'webSearch',
  'thinking',
  'useSkill',
  'fileSystem'
];

const expectedRequiredInputs: Record<string, string[]> = {
  askQuestions: ['context', 'questions'],
  autoStyler: [],
  dataAnalyzer: ['operation'],
  errorChecker: [],
  fileSystem: ['operation'],
  iconSearch: [],
  styleSearch: [],
  thinking: ['thoughts'],
  useSkill: ['name'],
  webSearch: ['query']
};

describe('Graphini MCP tool catalog', () => {
  it('exposes the current compact tool surface', () => {
    expect(listMcpTools()).toBe(graphiniMcpTools);
    expect(listMcpTools().map((tool) => tool.name)).toEqual(expectedToolNames);
  });

  it('keeps schemas closed and required inputs intentional', () => {
    for (const tool of listMcpTools()) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.required ?? []).toEqual(expectedRequiredInputs[tool.name]);
    }
  });

  it('advertises create/edit for workspace writes', () => {
    const fileSystem = listMcpTools().find((tool) => tool.name === 'fileSystem');
    expect(fileSystem).toBeDefined();

    const schemaText = JSON.stringify(fileSystem?.inputSchema);
    expect(schemaText).toContain('"create"');
    expect(schemaText).toContain('"edit"');
    expect(schemaText).not.toContain('"update"');
    expect(schemaText).not.toContain('"patch"');
  });
});

describe('/api/mcp/tools', () => {
  it('returns the catalog through GET', async () => {
    const response = await getMcpTools({} as never);
    const body = (await response.json()) as { tools: { name: string }[] };
    expect(body.tools.map((tool) => tool.name)).toEqual(expectedToolNames);
  });

  it('returns a JSON-RPC tools/list shaped response through POST', async () => {
    const response = await postMcpTools({
      request: new Request('http://localhost/api/mcp/tools', {
        body: JSON.stringify({ id: 7, jsonrpc: '2.0', method: 'tools/list' }),
        method: 'POST'
      })
    } as never);
    const body = (await response.json()) as {
      id: number;
      jsonrpc: string;
      result: { tools: { name: string }[] };
    };
    expect(body.id).toBe(7);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.result.tools.map((tool) => tool.name)).toEqual(expectedToolNames);
  });
});

describe('chat context budgets', () => {
  it('separates raw context capacity from usable input and history budgets', () => {
    expect(usableInputBudgetTokens(128_000)).toBe(104_960);
    expect(
      chatHistoryBudgetTokens({
        contextWindowTokens: 128_000,
        fixedPromptTokens: 20_000
      })
    ).toBe(84_960);
  });

  it('keeps a minimum recent-message budget for very large fixed prompts', () => {
    expect(
      chatHistoryBudgetTokens({
        contextWindowTokens: 20_000,
        fixedPromptTokens: 10_000
      })
    ).toBe(12_000);
  });
});

describe('Mermaid validation', () => {
  it('accepts init directives and comments before the diagram declaration', () => {
    const result = validateSingleMermaidDocument(`%%{init: {'theme':'default'}}%%
%% comment
graph TB
  A --> B`);

    expect(result.valid).toBe(true);
  });
});
