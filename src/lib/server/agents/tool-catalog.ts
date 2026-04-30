import { z } from 'zod';
import { emptyObjectSchema, objectSchema, type McpToolDescriptor } from './mcp';

const lineRangeInput = z.object({
  endLine: z.number().int().min(1).optional(),
  startLine: z.number().int().min(1).optional()
});

export type GraphiniAgentId =
  | 'orchestrator'
  | 'planner'
  | 'diagram-engineer'
  | 'visual-polish'
  | 'research-agent'
  | 'document-agent'
  | 'data-agent'
  | 'critic'
  | 'code-agent';

export const graphiniMcpTools = [
  {
    annotations: { readOnlyHint: true, title: 'Action Item Extractor' },
    description:
      'Extract action items, risks, KPIs, entities, decisions, and deadlines from document text or provided text.',
    inputSchema: objectSchema(
      z.object({
        extractTypes: z
          .array(z.enum(['actions', 'risks', 'kpis', 'entities', 'decisions', 'deadlines']))
          .optional(),
        source: z.enum(['document', 'text']),
        text: z.string().optional()
      })
    ),
    name: 'actionItemExtractor',
    title: 'Action Item Extractor'
  },
  {
    annotations: { readOnlyHint: true, title: 'Ask Questions' },
    description:
      'Ask the user multiple-choice or multi-select clarification questions before tool execution.',
    inputSchema: objectSchema(
      z.object({
        context: z.string().min(1),
        questions: z.array(
          z.object({
            id: z.string().min(1),
            options: z
              .array(
                z.object({
                  id: z.string().min(1),
                  label: z.string().min(1)
                })
              )
              .min(2)
              .max(6),
            text: z.string().min(1),
            type: z.enum(['single', 'multi'])
          })
        )
      })
    ),
    name: 'askQuestions',
    title: 'Ask Questions'
  },
  {
    annotations: { readOnlyHint: true, title: 'Diagram Read' },
    description: 'Read the current Mermaid diagram content, optionally limited to a line range.',
    inputSchema: objectSchema(lineRangeInput),
    name: 'diagramRead',
    title: 'Diagram Read'
  },
  {
    annotations: { readOnlyHint: true, title: 'Code Read' },
    description:
      'Read the current non-Mermaid code artifact, optionally limited to a line range. Use for JSON, YAML, config, TypeScript, JavaScript, Svelte, HTML, CSS, shell, and text code.',
    inputSchema: objectSchema(lineRangeInput),
    name: 'codeRead',
    title: 'Code Read'
  },
  {
    annotations: { destructiveHint: true, title: 'Code Write' },
    description:
      'Create or replace a non-Mermaid code artifact. This drafts an artifact only and does not write repository files.',
    inputSchema: objectSchema(
      z.object({
        content: z.string().min(1),
        language: z.enum([
          'json',
          'yaml',
          'typescript',
          'javascript',
          'svelte',
          'html',
          'css',
          'markdown',
          'text'
        ]),
        purpose: z.string().optional()
      })
    ),
    name: 'codeWrite',
    title: 'Code Write'
  },
  {
    annotations: { destructiveHint: true, title: 'Code Patch' },
    description:
      'Patch the current non-Mermaid code artifact by replacing a 1-based line range. This does not write repository files.',
    inputSchema: objectSchema(
      z.object({
        content: z.string().min(1),
        endLine: z.number().int().min(1),
        language: z
          .enum([
            'json',
            'yaml',
            'typescript',
            'javascript',
            'svelte',
            'html',
            'css',
            'markdown',
            'text'
          ])
          .optional(),
        startLine: z.number().int().min(1)
      })
    ),
    name: 'codePatch',
    title: 'Code Patch'
  },
  {
    annotations: { destructiveHint: true, title: 'Diagram Write' },
    description: 'Replace the full active Mermaid diagram. Input must be Mermaid syntax only.',
    inputSchema: objectSchema(
      z.object({
        content: z.string().min(1)
      })
    ),
    name: 'diagramWrite',
    title: 'Diagram Write'
  },
  {
    annotations: { destructiveHint: true, title: 'Diagram Patch' },
    description: 'Replace a specific 1-based line range in the active Mermaid diagram.',
    inputSchema: objectSchema(
      z.object({
        content: z.string().min(1),
        endLine: z.number().int().min(1),
        startLine: z.number().int().min(1)
      })
    ),
    name: 'diagramPatch',
    title: 'Diagram Patch'
  },
  {
    annotations: { readOnlyHint: true, title: 'Data Analyzer' },
    description:
      'Perform computational analysis on uploaded CSV or tabular files: frequencies, grouping, filters, top values, crosstabs, and correlations.',
    inputSchema: objectSchema(
      z.object({
        aggregation: z.enum(['sum', 'count', 'avg', 'min', 'max']).optional(),
        ascending: z.boolean().optional(),
        column: z.string().optional(),
        column2: z.string().optional(),
        columns: z.array(z.string()).optional(),
        fileId: z.string().min(1),
        filterOp: z.enum(['equals', 'contains', 'gt', 'lt', 'gte', 'lte', 'notEquals']).optional(),
        filterValue: z.string().optional(),
        n: z.number().int().min(1).optional(),
        operation: z.enum([
          'frequency',
          'groupBy',
          'filter',
          'topN',
          'crossTab',
          'valueCounts',
          'correlate'
        ])
      })
    ),
    name: 'dataAnalyzer',
    title: 'Data Analyzer'
  },
  {
    annotations: { destructiveHint: true, idempotentHint: true, title: 'Diagram Delete' },
    description: 'Clear the active Mermaid diagram.',
    inputSchema: emptyObjectSchema(),
    name: 'diagramDelete',
    title: 'Diagram Delete'
  },
  {
    annotations: { readOnlyHint: true, title: 'Error Checker' },
    description: 'Validate the active Mermaid diagram and return syntax issues.',
    inputSchema: emptyObjectSchema(),
    name: 'errorChecker',
    title: 'Error Checker'
  },
  {
    annotations: { destructiveHint: true, title: 'Auto Styler' },
    description: 'Apply Mermaid style directives with a selected palette.',
    inputSchema: objectSchema(
      z.object({
        palette: z.enum(['vibrant', 'pastel', 'earth', 'ocean', 'sunset', 'monochrome']).optional(),
        preserveExisting: z.boolean().optional()
      })
    ),
    name: 'autoStyler',
    title: 'Auto Styler'
  },
  {
    annotations: { destructiveHint: true, openWorldHint: true, title: 'Iconifier' },
    description:
      'Add or remove visual icons on diagram nodes using local and Iconify icon catalogs.',
    inputSchema: objectSchema(
      z.object({
        mode: z.enum(['all', 'selected', 'remove']),
        nodes: z.array(z.string()).optional(),
        removeAll: z.boolean().optional(),
        removeFromNodes: z.array(z.string()).optional()
      })
    ),
    name: 'iconifier',
    title: 'Iconifier'
  },
  {
    annotations: { title: 'Long Term Memory' },
    description:
      'Store, retrieve, list, delete, or search persistent user/project memories for the current workspace.',
    inputSchema: objectSchema(
      z.object({
        key: z.string().optional(),
        operation: z.enum(['save', 'get', 'list', 'delete', 'search']),
        query: z.string().optional(),
        value: z.string().optional()
      })
    ),
    name: 'longTermMemory',
    title: 'Long Term Memory'
  },
  {
    annotations: { readOnlyHint: true, title: 'Markdown Read' },
    description: 'Read the document panel markdown content.',
    inputSchema: emptyObjectSchema(),
    name: 'markdownRead',
    title: 'Markdown Read'
  },
  {
    annotations: { destructiveHint: true, title: 'Markdown Write' },
    description: 'Write or append markdown prose to the document panel.',
    inputSchema: objectSchema(
      z.object({
        append: z.boolean().optional(),
        content: z.string().min(1)
      })
    ),
    name: 'markdownWrite',
    title: 'Markdown Write'
  },
  {
    annotations: { openWorldHint: true, readOnlyHint: true, title: 'Web Search' },
    description:
      'Search the web for current documentation, product facts, or technical references.',
    inputSchema: objectSchema(
      z.object({
        query: z.string().min(1),
        reason: z.string().optional()
      })
    ),
    name: 'webSearch',
    title: 'Web Search'
  },
  {
    annotations: { title: 'Plan With Progress' },
    description: 'Create and update a visible checklist-style execution plan for complex tasks.',
    inputSchema: objectSchema(
      z.object({
        message: z.string().optional(),
        operation: z.enum(['create', 'update', 'get']),
        status: z.enum(['pending', 'in_progress', 'done', 'skipped']).optional(),
        stepId: z.string().optional(),
        steps: z
          .array(
            z.object({
              description: z.string().optional(),
              id: z.string().min(1),
              title: z.string().min(1)
            })
          )
          .optional(),
        title: z.string().optional()
      })
    ),
    name: 'planWithProgress',
    title: 'Plan With Progress'
  },
  {
    annotations: { readOnlyHint: true, title: 'Planner' },
    description:
      'Decompose a complex diagram or documentation request into ordered execution steps.',
    inputSchema: objectSchema(
      z.object({
        context: z.string().optional(),
        task: z.string().min(1)
      })
    ),
    name: 'planner',
    title: 'Planner'
  },
  {
    annotations: { readOnlyHint: true, title: 'Self Critique' },
    description:
      'Review a diagram or document for quality, completeness, and best-practice issues.',
    inputSchema: objectSchema(
      z.object({
        criteria: z.array(z.string()).optional(),
        target: z.enum(['diagram', 'document', 'both'])
      })
    ),
    name: 'selfCritique',
    title: 'Self Critique'
  },
  {
    annotations: { destructiveHint: true, readOnlyHint: false, title: 'File Manager' },
    description: 'List, read, search, summarize, or delete uploaded files available to the agent.',
    inputSchema: objectSchema(
      z.object({
        endChar: z.number().int().min(0).optional(),
        fileId: z.string().optional(),
        operation: z.enum(['list', 'read', 'search', 'delete', 'summary']),
        query: z.string().optional(),
        startChar: z.number().int().min(0).optional()
      })
    ),
    name: 'fileManager',
    title: 'File Manager'
  },
  {
    annotations: { readOnlyHint: true, title: 'Sequential Thinking' },
    description:
      'Record step-by-step reasoning for complex architecture, debugging, or trade-off analysis.',
    inputSchema: objectSchema(
      z.object({
        nextAction: z.string().optional(),
        thought: z.string().min(1),
        thoughtNumber: z.number().int().min(1),
        totalThoughts: z.number().int().min(1)
      })
    ),
    name: 'sequentialThinking',
    title: 'Sequential Thinking'
  },
  {
    annotations: { readOnlyHint: true, title: 'Git Guard' },
    description:
      'Check git safety before repository file/docs mutation planning. Reports dirty/protected paths and never modifies files.',
    inputSchema: objectSchema(
      z.object({
        operation: z.enum(['status', 'protect-paths', 'preflight']),
        paths: z.array(z.string()).optional(),
        reason: z.string().optional()
      })
    ),
    name: 'gitGuard',
    title: 'Git Guard'
  },
  {
    annotations: { readOnlyHint: true, title: 'Subagent Fanout' },
    description:
      'Plan bounded subagent assignments with ownership, allowed tools, expected outputs, and file/path guardrails.',
    inputSchema: objectSchema(
      z.object({
        agents: z
          .array(
            z.object({
              allowedTools: z.array(z.string()).optional(),
              id: z.string().min(1),
              objective: z.string().min(1),
              ownedPaths: z.array(z.string()).optional(),
              role: z.enum([
                'planner',
                'diagram-engineer',
                'visual-polish',
                'research-agent',
                'document-agent',
                'data-agent',
                'critic',
                'code-agent'
              ])
            })
          )
          .min(1),
        task: z.string().min(1)
      })
    ),
    name: 'subagentFanout',
    title: 'Subagent Fanout'
  },
  {
    annotations: { readOnlyHint: true, title: 'Subagent Assemble' },
    description:
      'Assemble planned subagent outputs into an integration plan with conflicts and verification steps.',
    inputSchema: objectSchema(
      z.object({
        outputs: z.array(
          z.object({
            agentId: z.string().min(1),
            changedPaths: z.array(z.string()).optional(),
            summary: z.string().min(1)
          })
        ),
        runId: z.string().min(1),
        verification: z.array(z.string()).optional()
      })
    ),
    name: 'subagentAssemble',
    title: 'Subagent Assemble'
  },
  {
    annotations: { readOnlyHint: true, title: 'Table Analytics' },
    description:
      'Analyze tabular data and suggest statistics, trends, outliers, or Mermaid charts.',
    inputSchema: objectSchema(
      z.object({
        data: z.string().optional(),
        operations: z
          .array(z.enum(['summary', 'statistics', 'trends', 'outliers', 'chart-suggestion']))
          .optional(),
        source: z.enum(['document', 'text'])
      })
    ),
    name: 'tableAnalytics',
    title: 'Table Analytics'
  }
] satisfies McpToolDescriptor[];

export const agentToolNames = {
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
    'planner',
    'planWithProgress',
    'sequentialThinking',
    'longTermMemory',
    'gitGuard',
    'subagentFanout',
    'subagentAssemble'
  ],
  planner: ['planner', 'planWithProgress', 'sequentialThinking'],
  'research-agent': ['webSearch', 'fileManager'],
  'visual-polish': [
    'diagramRead',
    'diagramWrite',
    'diagramPatch',
    'autoStyler',
    'iconifier',
    'errorChecker'
  ]
} satisfies Record<GraphiniAgentId, string[]>;

export function listMcpTools(): McpToolDescriptor[] {
  return graphiniMcpTools;
}

export function getMcpTool(name: string): McpToolDescriptor | undefined {
  return graphiniMcpTools.find((tool) => tool.name === name);
}

export function listMcpToolsForAgent(agentId: GraphiniAgentId): McpToolDescriptor[] {
  const allowed = new Set(agentToolNames[agentId]);
  return graphiniMcpTools.filter((tool) => allowed.has(tool.name));
}
