import { parseMermaidNodes, validateSingleMermaidDocument } from '$lib/server/chat/mermaid';
import { tool } from 'ai';
import { z } from 'zod';
import { resolveMermaidTarget, type ToolContext } from './context';
import { resolveIconCandidatesForNode, type IconColorMode, type IconSource } from './icon-resolver';

interface IconCandidateSuggestion {
  colorMode: IconColorMode;
  confidence: number;
  iconId: string;
  source: IconSource;
  url: string;
}

interface IconSearchSuggestion {
  annotationLine?: string;
  candidates?: IconCandidateSuggestion[];
  colorMode?: IconColorMode;
  confidence: number;
  iconId?: string;
  iconUrl?: string;
  line: number;
  nodeId: string;
  nodeText: string;
  source?: IconSource;
  status: 'matched' | 'skipped';
  suggestedPatch?: {
    content: string;
    endLine: number;
    startLine: number;
  };
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

function filterNodesForIconSearch(
  nodes: ReturnType<typeof parseMermaidNodes>,
  nodeIds?: string[],
  query?: string
) {
  const requested = new Set(nodeIds ?? []);
  const normalizedQuery = query?.trim().toLowerCase();
  const filtered = nodes.filter((node) => {
    if (requested.size > 0 && !requested.has(node.id)) return false;
    if (!normalizedQuery) return true;
    return (
      node.id.toLowerCase().includes(normalizedQuery) ||
      node.text.toLowerCase().includes(normalizedQuery)
    );
  });

  if (filtered.length > 0 || requested.size > 0 || !normalizedQuery) {
    return { nodes: filtered, usedQueryFallback: false };
  }

  return { nodes, usedQueryFallback: true };
}

export function createIconSearchTool({ target, userId }: ToolContext) {
  return tool({
    description:
      'Search local and verified Iconify icon candidates for Mermaid diagram nodes without mutating the diagram. Pass `path` to target a specific .mermaid file; defaults to the active workspace file when omitted. Supports color/noncolor icon modes. Use before fileSystem patch when the user asks for icons or logos. Return patch suggestions, then choose and apply only the needed node annotation lines via fileSystem patch.',
    inputSchema: z.object({
      colorMode: z
        .enum(['any', 'color', 'noncolor'])
        .optional()
        .describe(
          'Filter candidate icons by visual style: color for multicolor logos/cloud icons, noncolor for monochrome/currentColor icons, any for no filter.'
        ),
      includeWebSuggestions: z
        .boolean()
        .optional()
        .describe(
          'When true, include additional verified Iconify web SVG candidates even when a local icon matched.'
        ),
      limit: z.number().int().min(1).max(30).optional().describe('Maximum nodes to inspect.'),
      nodeIds: z.array(z.string()).optional().describe('Specific node IDs to search icons for.'),
      path: z
        .string()
        .optional()
        .describe(
          'Path to the .mermaid file to inspect. Defaults to the active workspace file when omitted; required when the active file is not a .mermaid.'
        ),
      query: z.string().optional().describe('Optional keyword filter for node id or label text.'),
      webLimit: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .describe('Maximum verified Iconify web candidates to include per node.')
    }),
    execute: async ({
      path,
      colorMode = 'any',
      includeWebSuggestions = false,
      limit = 20,
      nodeIds,
      query,
      webLimit = 2
    }) => {
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
            'Fix the Mermaid structure before searching icons. If the diagram starts with a subgraph, patch line 1 to prepend "flowchart TD".',
          suggestedRepairPatch: buildMissingDeclarationRepair(lines),
          success: false
        };
      }

      const selection = filterNodesForIconSearch(parseMermaidNodes(diagram), nodeIds, query);
      const nodes = selection.nodes.slice(0, limit);

      // Resolve every node's candidates in parallel — was a serial await that
      // could stall the chat stream for tens of seconds when the diagram has
      // many nodes and the Iconify web fallback is consulted.
      const suggestions: IconSearchSuggestion[] = await Promise.all(
        nodes.map(async (node): Promise<IconSearchSuggestion> => {
          const candidates = await resolveIconCandidatesForNode(node.id, node.text, {
            colorMode,
            includeWebSuggestions,
            webLimit
          });
          const icon = candidates[0];
          if (!icon) {
            return {
              candidates: [],
              confidence: 0,
              line: node.line + 1,
              nodeId: node.id,
              nodeText: node.text,
              status: 'skipped'
            };
          }

          const annotationLine = `    ${node.id}@{ img: "${icon.url}", pos: "b", w: 60, h: 60, constraint: "on" }`;
          const sourceLine = lines[node.line] ?? '';
          return {
            annotationLine,
            candidates,
            colorMode: icon.colorMode,
            confidence: icon.confidence,
            iconId: icon.iconId,
            iconUrl: icon.url,
            line: node.line + 1,
            nodeId: node.id,
            nodeText: node.text,
            source: icon.source,
            status: 'matched',
            suggestedPatch: {
              content: `${sourceLine}\n${annotationLine}`,
              endLine: node.line + 1,
              startLine: node.line + 1
            }
          };
        })
      );

      const matchedCount = suggestions.filter(
        (suggestion) => suggestion.status === 'matched'
      ).length;
      return {
        colorMode,
        queryFallback:
          selection.usedQueryFallback && query
            ? `No nodes matched query "${query}", so iconSearch scanned the first ${nodes.length} diagram nodes instead.`
            : undefined,
        success: true,
        suggestions,
        summary: `Found ${matchedCount} icon match${matchedCount !== 1 ? 'es' : ''} across ${nodes.length} node${nodes.length !== 1 ? 's' : ''}`
      };
    }
  });
}
