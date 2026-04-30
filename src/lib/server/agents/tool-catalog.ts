import { z } from 'zod';
import { emptyObjectSchema, objectSchema, type McpToolDescriptor } from './mcp';

const lineRangeInput = z.object({
  endLine: z.number().int().min(1).optional(),
  startLine: z.number().int().min(1).optional()
});

export const graphiniMcpTools = [
  {
    annotations: { readOnlyHint: true, title: 'Diagram Read' },
    description: 'Read the current Mermaid diagram content, optionally limited to a line range.',
    inputSchema: objectSchema(lineRangeInput),
    name: 'diagramRead',
    title: 'Diagram Read'
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
    annotations: { readOnlyHint: true, title: 'Table Analytics' },
    description:
      'Analyze tabular data and suggest statistics, trends, outliers, or Mermaid charts.',
    inputSchema: objectSchema(
      z.object({
        data: z.string().optional(),
        operations: z.array(z.string()).optional(),
        source: z.enum(['uploaded-file', 'inline-data', 'current-document'])
      })
    ),
    name: 'tableAnalytics',
    title: 'Table Analytics'
  }
] satisfies McpToolDescriptor[];

export function listMcpTools(): McpToolDescriptor[] {
  return graphiniMcpTools;
}

export function getMcpTool(name: string): McpToolDescriptor | undefined {
  return graphiniMcpTools.find((tool) => tool.name === name);
}
