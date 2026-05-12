import { tool } from 'ai';
import { z } from 'zod';
import { persistFileContentById, resolveMermaidTarget, type ToolContext } from './context';
import { getStylePalette } from './stylePalettes';

export function createAutoStylerTool({ target, userId }: ToolContext) {
  return tool({
    description:
      'Automatically style all nodes and subgraphs in a Mermaid diagram with harmonious grouped colors. Pass `path` to target a specific .mermaid file; defaults to the active file when none is given. Use this for any "make it colorful", "more vibrant", "style the diagram", "add colors", or "brighten it up" request — do NOT hand-write style directives with raw hex colors when the user asks for general colorfulness; this tool emits palette-checked, contrast-safe styles. Choose `palette: "vibrant"` for the user\'s default "make it pop / brighter / more colorful" intent. Choose `themeMode` based on whether the user wants light-mode or dark-mode colors. Text colors are contrast-checked against fills; do not mix light-mode fills into dark-mode diagrams or dark-mode fills into light-mode diagrams.',
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe(
          'Path to the .mermaid file to style. Defaults to the active workspace file when omitted; required when the active file is not a .mermaid.'
        ),
      palette: z
        .enum(['vibrant', 'pastel', 'earth', 'ocean', 'sunset', 'monochrome'])
        .optional()
        .describe('Color palette theme. Defaults to vibrant.'),
      themeMode: z
        .enum(['light', 'dark'])
        .optional()
        .describe('Palette mode to apply. Use light for light UI/export, dark for dark UI/export.'),
      preserveExisting: z
        .boolean()
        .optional()
        .describe('If true, only style nodes that have no existing style. Default false.')
    }),
    execute: async ({
      path,
      palette = 'vibrant',
      themeMode = 'dark',
      preserveExisting = false
    }) => {
      const resolved = await resolveMermaidTarget(target, userId, path);
      if (!resolved.ok) {
        return { success: false, message: resolved.reason, hint: resolved.hint };
      }
      const diagram = resolved.content;
      if (!diagram.trim()) {
        return { success: false, message: `No content in ${resolved.path} to style` };
      }

      // Check if diagram type supports style directives
      const firstLine = diagram.split('\n')[0]?.trim().split(/\s/)[0]?.toLowerCase() || '';
      const noStyleTypes = [
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
      ];
      if (noStyleTypes.includes(firstLine)) {
        return {
          success: false,
          message: `${firstLine} diagrams do not support style directives. Styling must be done through Mermaid theme configuration or by restructuring the diagram as a flowchart. You cannot add colors to ${firstLine} nodes with "style" lines.`
        };
      }

      const colors = getStylePalette(palette, themeMode);
      const lines = diagram.split('\n');

      // Parse nodes: lines like "  NodeId[Label]" or "  NodeId(Label)" etc.
      const nodePattern = /^\s*([A-Za-z_][\w]*)\s*[[({<|]|^\s*([A-Za-z_][\w]*)\s*@\{/;
      const edgePattern = /(<-->|<-\.->|<==>|<---|-->|-\.->|==>|---)/;
      const nodeIds: string[] = [];
      const subgraphIds: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed.startsWith('%%') ||
          trimmed.startsWith('style ') ||
          trimmed.startsWith('classDef ') ||
          trimmed.startsWith('class ') ||
          trimmed.startsWith('linkStyle')
        )
          continue;
        if (trimmed.startsWith('subgraph ')) {
          const sgMatch = trimmed.match(/^subgraph\s+([A-Za-z_][\w]*)/);
          if (sgMatch) subgraphIds.push(sgMatch[1]);
          continue;
        }
        if (trimmed === 'end' || trimmed.startsWith('flowchart') || trimmed.startsWith('graph'))
          continue;

        // Extract node IDs from edge lines and definition lines
        const nodeMatch = trimmed.match(nodePattern);
        if (nodeMatch) {
          const id = nodeMatch[1] || nodeMatch[2];
          if (id && !nodeIds.includes(id)) nodeIds.push(id);
        }
        // Also extract from edge lines: A --> B
        if (edgePattern.test(trimmed)) {
          const parts = trimmed.split(edgePattern);
          for (const part of parts) {
            const idMatch = part.trim().match(/^([A-Za-z_][\w]*)/);
            if (idMatch && !edgePattern.test(idMatch[1]) && !nodeIds.includes(idMatch[1])) {
              nodeIds.push(idMatch[1]);
            }
          }
        }
      }

      // Remove existing style lines if not preserving
      let cleanedLines = lines;
      if (!preserveExisting) {
        cleanedLines = lines.filter((l) => {
          const t = l.trim();
          return !t.startsWith('style ') && !t.startsWith('classDef ') && !t.startsWith('class ');
        });
      }

      // Assign colors: group nodes by subgraph membership or sequentially
      const styleLines: string[] = [];
      let colorIdx = 0;
      for (const nodeId of nodeIds) {
        const c = colors[colorIdx % colors.length];
        styleLines.push(
          `    style ${nodeId} fill:${c.fill},stroke:${c.stroke},stroke-width:2px,color:${c.text}`
        );
        colorIdx++;
      }

      // Style subgraphs
      for (let i = 0; i < subgraphIds.length; i++) {
        const sf = colors[(i + nodeIds.length) % colors.length];
        styleLines.push(
          `    style ${subgraphIds[i]} fill:${sf.fill},stroke:${sf.stroke},stroke-width:2px,color:${sf.text}`
        );
      }

      const newDiagram = cleanedLines.join('\n') + '\n' + styleLines.join('\n');
      if (userId) await persistFileContentById(resolved.id, userId, newDiagram);

      return {
        content: newDiagram,
        nodesStyled: nodeIds.length,
        palette,
        path: resolved.path,
        subgraphsStyled: subgraphIds.length,
        success: true,
        summary: `Styled ${nodeIds.length} nodes and ${subgraphIds.length} subgraphs with ${themeMode} ${palette} palette in ${resolved.path}`,
        themeMode
      };
    }
  });
}
