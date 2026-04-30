/* eslint-disable @typescript-eslint/no-unused-vars */
import { deleteFile, getFileById, getSessionFiles } from '$lib/server/file-store';
import {
  codeStore,
  diagramStore,
  markdownStore,
  memoryStore,
  planStore,
  subagentStore
} from '$lib/server/chat/state';
import {
  buildDiagramReview,
  findMermaidDeclarations,
  parseMermaidNodes,
  validateSingleMermaidDocument
} from '$lib/server/chat/mermaid';
import { detectCodeLanguage, validateCodeArtifact } from '$lib/server/chat/code-artifacts';
import { openrouterFastChat } from '$lib/server/chat/model';
import { instructionsForSubagent } from '$lib/server/chat/subagents';
import { generateText, tool } from 'ai';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { resolveIconForNode } from './icon-resolver';

const execFileAsync = promisify(execFile);

interface ToolContext {
  modelId?: string;
  sessionId: string;
}

export function createAutoStylerTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Automatically style all nodes and subgraphs in the diagram with harmonious grouped colors. Applies fill, border, and text colors. Use when the user asks to "make it colorful", "style the diagram", or "add colors".',
    inputSchema: z.object({
      palette: z
        .enum(['vibrant', 'pastel', 'earth', 'ocean', 'sunset', 'monochrome'])
        .optional()
        .describe('Color palette theme. Defaults to vibrant.'),
      preserveExisting: z
        .boolean()
        .optional()
        .describe('If true, only style nodes that have no existing style. Default false.')
    }),
    execute: async ({ palette = 'vibrant', preserveExisting = false }) => {
      const diagram = diagramStore.get(sessionId) || '';
      if (!diagram.trim()) {
        return { success: false, message: 'No diagram to style' };
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

      const palettes: Record<string, { fill: string; stroke: string; text: string }[]> = {
        earth: [
          { fill: '#92400e', stroke: '#78350f', text: '#fef3c7' },
          { fill: '#065f46', stroke: '#064e3b', text: '#d1fae5' },
          { fill: '#7c2d12', stroke: '#6c2710', text: '#fed7aa' },
          { fill: '#1e3a5f', stroke: '#172554', text: '#dbeafe' },
          { fill: '#713f12', stroke: '#5c3210', text: '#fef9c3' },
          { fill: '#4a1942', stroke: '#3b1336', text: '#fae8ff' }
        ],
        monochrome: [
          { fill: '#374151', stroke: '#1f2937', text: '#f9fafb' },
          { fill: '#6b7280', stroke: '#4b5563', text: '#f9fafb' },
          { fill: '#9ca3af', stroke: '#6b7280', text: '#111827' },
          { fill: '#d1d5db', stroke: '#9ca3af', text: '#111827' },
          { fill: '#1f2937', stroke: '#111827', text: '#f9fafb' },
          { fill: '#4b5563', stroke: '#374151', text: '#f9fafb' }
        ],
        ocean: [
          { fill: '#0ea5e9', stroke: '#0284c7', text: '#ffffff' },
          { fill: '#06b6d4', stroke: '#0891b2', text: '#ffffff' },
          { fill: '#14b8a6', stroke: '#0d9488', text: '#ffffff' },
          { fill: '#3b82f6', stroke: '#2563eb', text: '#ffffff' },
          { fill: '#6366f1', stroke: '#4f46e5', text: '#ffffff' },
          { fill: '#0369a1', stroke: '#075985', text: '#ffffff' }
        ],
        pastel: [
          { fill: '#c7d2fe', stroke: '#818cf8', text: '#312e81' },
          { fill: '#e0e7ff', stroke: '#818cf8', text: '#312e81' },
          { fill: '#99f6e4', stroke: '#2dd4bf', text: '#134e4a' },
          { fill: '#fde68a', stroke: '#fbbf24', text: '#78350f' },
          { fill: '#ddd6fe', stroke: '#a78bfa', text: '#4c1d95' },
          { fill: '#a5f3fc', stroke: '#22d3ee', text: '#164e63' },
          { fill: '#fecaca', stroke: '#f87171', text: '#7f1d1d' },
          { fill: '#bbf7d0', stroke: '#4ade80', text: '#14532d' }
        ],
        sunset: [
          { fill: '#ef4444', stroke: '#dc2626', text: '#ffffff' },
          { fill: '#f97316', stroke: '#ea580c', text: '#ffffff' },
          { fill: '#f59e0b', stroke: '#d97706', text: '#ffffff' },
          { fill: '#818cf8', stroke: '#6366f1', text: '#ffffff' },
          { fill: '#a855f7', stroke: '#9333ea', text: '#ffffff' },
          { fill: '#e11d48', stroke: '#be123c', text: '#ffffff' }
        ],
        vibrant: [
          { fill: '#6366f1', stroke: '#4f46e5', text: '#ffffff' },
          { fill: '#818cf8', stroke: '#6366f1', text: '#ffffff' },
          { fill: '#14b8a6', stroke: '#0d9488', text: '#ffffff' },
          { fill: '#f59e0b', stroke: '#d97706', text: '#ffffff' },
          { fill: '#8b5cf6', stroke: '#7c3aed', text: '#ffffff' },
          { fill: '#06b6d4', stroke: '#0891b2', text: '#ffffff' },
          { fill: '#ef4444', stroke: '#dc2626', text: '#ffffff' },
          { fill: '#22c55e', stroke: '#16a34a', text: '#ffffff' }
        ]
      };

      const colors = palettes[palette] || palettes.vibrant;
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
      const sgFills = [
        { fill: '#f0f0ff', stroke: '#6366f1' },
        { fill: '#eef2ff', stroke: '#6366f1' },
        { fill: '#f0fdfa', stroke: '#14b8a6' },
        { fill: '#fffbeb', stroke: '#f59e0b' },
        { fill: '#faf5ff', stroke: '#8b5cf6' },
        { fill: '#ecfeff', stroke: '#06b6d4' }
      ];
      for (let i = 0; i < subgraphIds.length; i++) {
        const sf = sgFills[i % sgFills.length];
        styleLines.push(
          `    style ${subgraphIds[i]} fill:${sf.fill},stroke:${sf.stroke},stroke-width:2px`
        );
      }

      const newDiagram = cleanedLines.join('\n') + '\n' + styleLines.join('\n');
      diagramStore.set(sessionId, newDiagram);

      return {
        content: newDiagram,
        nodesStyled: nodeIds.length,
        palette,
        subgraphsStyled: subgraphIds.length,
        success: true,
        summary: `Styled ${nodeIds.length} nodes and ${subgraphIds.length} subgraphs with ${palette} palette`
      };
    }
  });
}
