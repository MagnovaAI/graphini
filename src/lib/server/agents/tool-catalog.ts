import { z } from 'zod';
import { emptyObjectSchema, objectSchema, type McpToolDescriptor } from './mcp';

export type GraphiniAgentId =
  | 'orchestrator'
  | 'diagram-engineer'
  | 'visual-polish'
  | 'research-agent'
  | 'document-agent'
  | 'data-agent'
  | 'critic';

export const graphiniMcpTools = [
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
    annotations: { readOnlyHint: true, title: 'Error Checker' },
    description: 'Validate the active Mermaid diagram and return syntax issues.',
    inputSchema: emptyObjectSchema(),
    name: 'errorChecker',
    title: 'Error Checker'
  },
  {
    annotations: { readOnlyHint: true, title: 'Style Search' },
    description:
      'Search Mermaid style palettes and return patch suggestions without mutating the diagram.',
    inputSchema: objectSchema(
      z.object({
        limit: z.number().int().min(1).max(30).optional(),
        palette: z.enum(['vibrant', 'pastel', 'earth', 'ocean', 'sunset', 'monochrome']).optional()
      })
    ),
    name: 'styleSearch',
    title: 'Style Search'
  },
  {
    annotations: { destructiveHint: true, title: 'Auto Styler' },
    description:
      'Automatically apply harmonious Mermaid style directives to the active diagram using a selected palette.',
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
    annotations: { openWorldHint: true, readOnlyHint: true, title: 'Icon Search' },
    description:
      'Search local and Iconify icon candidates for Mermaid nodes without mutating the diagram.',
    inputSchema: objectSchema(
      z.object({
        colorMode: z.enum(['any', 'color', 'noncolor']).optional(),
        includeWebSuggestions: z.boolean().optional(),
        limit: z.number().int().min(1).max(30).optional(),
        nodeIds: z.array(z.string()).optional(),
        query: z.string().optional(),
        webLimit: z.number().int().min(0).max(5).optional()
      })
    ),
    name: 'iconSearch',
    title: 'Icon Search'
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
    annotations: { readOnlyHint: true, title: 'Thinking' },
    description:
      'Record an ordered chain of reasoning thoughts shown to the user as a Chain of Thought block. A single thought renders as a one-step chain.',
    inputSchema: objectSchema(
      z.object({
        thoughts: z
          .array(
            z.object({
              label: z.string().min(1),
              detail: z.string().optional()
            })
          )
          .min(1)
          .max(12),
        conclusion: z.string().optional()
      })
    ),
    name: 'thinking',
    title: 'Thinking'
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
    annotations: { destructiveHint: true, readOnlyHint: false, title: 'File System' },
    description:
      'Single tool for all workspace file operations on the per-user file tree (.md, .json, .yaml, .mermaid). Operations: list, read, create, update, patch, delete, moveFolder, deleteFolder. Mandatory ordering: list before create, read before patch (same turn). Quotas: 15 files for guests, 30 for signed-in users.',
    inputSchema: objectSchema(
      z.object({
        content: z.string().optional(),
        endLine: z.number().int().min(1).optional(),
        from: z.string().optional(),
        operation: z.enum([
          'list',
          'read',
          'create',
          'update',
          'patch',
          'delete',
          'moveFolder',
          'deleteFolder'
        ]),
        path: z.string().optional(),
        startLine: z.number().int().min(1).optional(),
        to: z.string().optional()
      })
    ),
    name: 'fileSystem',
    title: 'File System'
  }
] satisfies McpToolDescriptor[];

export const agentToolNames = {
  critic: ['fileSystem', 'errorChecker'],
  'data-agent': ['fileManager', 'dataAnalyzer'],
  'diagram-engineer': ['fileSystem', 'errorChecker'],
  'document-agent': ['fileSystem', 'fileManager'],
  orchestrator: ['askQuestions', 'thinking'],
  'research-agent': ['webSearch', 'fileManager'],
  'visual-polish': ['fileSystem', 'styleSearch', 'iconSearch', 'errorChecker']
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
