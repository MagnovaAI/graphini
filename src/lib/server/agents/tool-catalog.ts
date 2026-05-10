import { z } from 'zod';
import { emptyObjectSchema, objectSchema, type McpToolDescriptor } from './mcp';

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
                  label: z.string().min(1),
                  other: z.boolean().optional()
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
      'Perform computational analysis on workspace Markdown tables or CSV-like files: frequencies, grouping, filters, top values, crosstabs, and correlations.',
    inputSchema: objectSchema(
      z.object({
        aggregation: z.enum(['sum', 'count', 'avg', 'min', 'max']).optional(),
        ascending: z.boolean().optional(),
        column: z.string().optional(),
        column2: z.string().optional(),
        columns: z.array(z.string()).optional(),
        fileId: z.string().min(1).optional(),
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
        ]),
        path: z.string().min(1).optional()
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
      'Search Mermaid style palettes and return edit suggestions without mutating the diagram.',
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
    annotations: { readOnlyHint: true, title: 'Use Skill' },
    description:
      'Load one enabled user skill by exact name and return its instructions for the current turn. Use this before relying on a user skill.',
    inputSchema: objectSchema(
      z.object({
        name: z.string().min(1)
      })
    ),
    name: 'useSkill',
    title: 'Use Skill'
  },
  {
    annotations: { destructiveHint: true, readOnlyHint: false, title: 'File System' },
    description:
      'Single tool for workspace files on the per-user file tree (.md, .json, .yaml, .mermaid). Operations: list, read, create, edit, delete, moveFolder, deleteFolder. create performs duplicate/quota checks internally. edit can replace the full file or a line range. Mandatory ordering: read before line-range edit. Quotas: 15 files for guests, 30 for signed-in users.',
    inputSchema: objectSchema(
      z.object({
        content: z.string().optional(),
        endLine: z.number().int().min(1).optional(),
        from: z.string().optional(),
        operation: z.enum([
          'list',
          'read',
          'create',
          'edit',
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

export function listMcpTools(): McpToolDescriptor[] {
  return graphiniMcpTools;
}

export function getMcpTool(name: string): McpToolDescriptor | undefined {
  return graphiniMcpTools.find((tool) => tool.name === name);
}
