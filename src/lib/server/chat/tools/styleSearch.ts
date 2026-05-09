import { parseMermaidNodes, validateSingleMermaidDocument } from '$lib/server/chat/mermaid';
import { tool } from 'ai';
import { z } from 'zod';
import { resolveMermaidTarget, type ToolContext } from './context';

const palettes = {
  earth: [
    { fill: '#92400e', stroke: '#78350f', text: '#fef3c7' },
    { fill: '#065f46', stroke: '#064e3b', text: '#d1fae5' },
    { fill: '#7c2d12', stroke: '#6c2710', text: '#fed7aa' },
    { fill: '#1e3a5f', stroke: '#172554', text: '#dbeafe' }
  ],
  monochrome: [
    { fill: '#374151', stroke: '#1f2937', text: '#f9fafb' },
    { fill: '#6b7280', stroke: '#4b5563', text: '#f9fafb' },
    { fill: '#d1d5db', stroke: '#9ca3af', text: '#111827' },
    { fill: '#1f2937', stroke: '#111827', text: '#f9fafb' }
  ],
  ocean: [
    { fill: '#0ea5e9', stroke: '#0284c7', text: '#ffffff' },
    { fill: '#06b6d4', stroke: '#0891b2', text: '#ffffff' },
    { fill: '#14b8a6', stroke: '#0d9488', text: '#ffffff' },
    { fill: '#6366f1', stroke: '#4f46e5', text: '#ffffff' }
  ],
  pastel: [
    { fill: '#c7d2fe', stroke: '#818cf8', text: '#312e81' },
    { fill: '#99f6e4', stroke: '#2dd4bf', text: '#134e4a' },
    { fill: '#fde68a', stroke: '#fbbf24', text: '#78350f' },
    { fill: '#fecaca', stroke: '#f87171', text: '#7f1d1d' }
  ],
  sunset: [
    { fill: '#ef4444', stroke: '#dc2626', text: '#ffffff' },
    { fill: '#f97316', stroke: '#ea580c', text: '#ffffff' },
    { fill: '#f59e0b', stroke: '#d97706', text: '#ffffff' },
    { fill: '#a855f7', stroke: '#9333ea', text: '#ffffff' }
  ],
  vibrant: [
    { fill: '#6366f1', stroke: '#4f46e5', text: '#ffffff' },
    { fill: '#14b8a6', stroke: '#0d9488', text: '#ffffff' },
    { fill: '#f59e0b', stroke: '#d97706', text: '#ffffff' },
    { fill: '#8b5cf6', stroke: '#7c3aed', text: '#ffffff' }
  ]
} satisfies Record<string, { fill: string; stroke: string; text: string }[]>;

const noStyleTypes = new Set([
  'mindmap',
  'timeline',
  'pie',
  'gantt',
  'gitgraph',
  'sequencediagram',
  'erdiagram',
  'sankey',
  'packet',
  'quadrantchart',
  'xychart',
  'journey'
]);

function findSubgraphs(lines: string[]): string[] {
  return lines
    .map((line) => line.trim().match(/^subgraph\s+([A-Za-z_][\w]*)/)?.[1])
    .filter((id): id is string => Boolean(id));
}

function buildMissingDeclarationRepair(lines: string[]) {
  const firstLine = lines[0] ?? '';
  if (!firstLine.trim().startsWith('subgraph ')) return undefined;
  return {
    content: `flowchart TD\n${firstLine}`,
    endLine: 1,
    startLine: 1
  };
}

export function createStyleSearchTool({ target, userId }: ToolContext) {
  return tool({
    description:
      'Search and preview Mermaid style directives without mutating the diagram. Pass `path` to target a specific .mermaid file; defaults to the active workspace file when omitted. Use before fileSystem patch when the user asks for colors, themes, styling, or visual polish. Return patch suggestions, then choose and apply only the needed lines via fileSystem patch.',
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe(
          'Path to the .mermaid file to inspect. Defaults to the active workspace file when omitted; required when the active file is not a .mermaid.'
        ),
      palette: z
        .enum(['vibrant', 'pastel', 'earth', 'ocean', 'sunset', 'monochrome'])
        .optional()
        .describe('Palette to preview. Defaults to vibrant.'),
      limit: z.number().int().min(1).max(30).optional().describe('Maximum nodes to style.')
    }),
    execute: async ({ path, palette = 'vibrant', limit = 30 }) => {
      const resolved = await resolveMermaidTarget(target, userId, path);
      if (!resolved.ok) {
        return { success: false, message: resolved.reason, hint: resolved.hint };
      }
      const diagram = resolved.content;
      if (!diagram.trim())
        return { success: false, message: `No content in ${resolved.path} to inspect` };

      const lines = diagram.split('\n');
      const validation = validateSingleMermaidDocument(diagram);
      if (!validation.valid) {
        return {
          message: validation.error,
          repairHint:
            'Fix the Mermaid structure before styling. If the diagram starts with a subgraph, patch line 1 to prepend "flowchart TD".',
          suggestedRepairPatch: buildMissingDeclarationRepair(lines),
          success: false
        };
      }

      const diagramType = lines[0]?.trim().split(/\s/)[0]?.toLowerCase() || '';
      if (noStyleTypes.has(diagramType)) {
        return {
          success: false,
          message: `${diagramType} diagrams do not support Mermaid style directives.`
        };
      }

      const nodes = parseMermaidNodes(diagram).slice(0, limit);
      const subgraphs = findSubgraphs(lines);
      const colors = palettes[palette] ?? palettes.vibrant;
      const styleLines = nodes.map((node, index) => {
        const color = colors[index % colors.length];
        return `    style ${node.id} fill:${color.fill},stroke:${color.stroke},stroke-width:2px,color:${color.text}`;
      });

      const subgraphLines = subgraphs.map((id, index) => {
        const color = colors[index % colors.length];
        return `    style ${id} fill:${color.fill},stroke:${color.stroke},stroke-width:2px,color:${color.text}`;
      });

      const suggestedLines = [...styleLines, ...subgraphLines];
      const finalLine = lines.at(-1) ?? '';
      const patchContent = `${finalLine}${finalLine.trim() ? '\n' : ''}${suggestedLines.join('\n')}`;

      return {
        nodes: nodes.map((node) => ({ id: node.id, line: node.line + 1, text: node.text })),
        palette,
        styleLines: suggestedLines,
        success: true,
        suggestedPatch: {
          content: patchContent,
          endLine: lines.length,
          startLine: lines.length
        },
        summary: `Found ${suggestedLines.length} style line${suggestedLines.length !== 1 ? 's' : ''} for ${palette} palette`
      };
    }
  });
}
