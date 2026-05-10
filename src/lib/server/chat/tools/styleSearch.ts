import { parseMermaidNodes, validateSingleMermaidDocument } from '$lib/server/chat/mermaid';
import { tool } from 'ai';
import { z } from 'zod';
import { resolveMermaidTarget, type ToolContext } from './context';
import { getStylePalette, stylePalettePreview } from './stylePalettes';

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
      'Search and preview Mermaid style directives without mutating the diagram. Pass `path` to target a specific .mermaid file; defaults to the active workspace file when omitted. Use before workspaceFiles operation "edit" when the user asks for colors, themes, styling, light mode, dark mode, or visual polish. Choose `themeMode` based on the requested display mode: light palettes use pale fills with dark text; dark palettes use deeper fills with light text. Suggested text colors are contrast-checked against fills; do not mix light-mode fills into dark-mode diagrams or dark-mode fills into light-mode diagrams. Return edit suggestions, then choose and apply only the needed lines via workspaceFiles operation "edit".',
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
      themeMode: z
        .enum(['light', 'dark'])
        .optional()
        .describe(
          'Palette mode to preview. Use light for light UI/export, dark for dark UI/export.'
        ),
      limit: z.number().int().min(1).max(30).optional().describe('Maximum nodes to style.')
    }),
    execute: async ({ path, palette = 'vibrant', themeMode = 'dark', limit = 30 }) => {
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
            'Fix the Mermaid structure before styling. If the diagram starts with a subgraph, use workspaceFiles operation "edit" on line 1 to prepend "flowchart TD".',
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
      const colors = getStylePalette(palette, themeMode);
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
        availablePalettes: {
          dark: stylePalettePreview('dark'),
          light: stylePalettePreview('light')
        },
        nodes: nodes.map((node) => ({ id: node.id, line: node.line + 1, text: node.text })),
        palette,
        styleLines: suggestedLines,
        success: true,
        suggestedPatch: {
          content: patchContent,
          endLine: lines.length,
          startLine: lines.length
        },
        summary: `Found ${suggestedLines.length} style line${suggestedLines.length !== 1 ? 's' : ''} for ${themeMode} ${palette} palette`,
        themeMode
      };
    }
  });
}
