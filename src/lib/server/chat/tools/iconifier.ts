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

export function createIconifierTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description: `Post-processing tool that attaches visual icons to diagram nodes AFTER a diagram is created.

HOW IT WORKS:
- You provide a mode and optional node list. The tool automatically resolves the best icon for each node.
- Resolution order: (1) exact NodeID match against 2400+ local icons (AWS, Azure, GCP, K8s, Cisco, brands), (2) camelCase-split parts of NodeID, (3) node label text keywords, (4) Iconify web API fallback (200,000+ icons from logos, devicon, simple-icons, mdi, etc.)
- Icons are inserted as @{ img: "url" } annotations on the node line in the Mermaid code.
- The tool returns a summary showing which nodes got icons and which were skipped.

WHEN TO CALL:
- ALWAYS call with mode "all" immediately after creating any architecture/infrastructure/tech diagram.
- Call with mode "selective" when user asks to add icons to specific nodes.
- Call with mode "remove" when user wants icons removed.
- Do NOT call for simple flowcharts, sequence diagrams, or non-tech diagrams unless user asks.

CRITICAL FOR BEST RESULTS:
- NodeIDs MUST be real brand/product names (e.g. "React", "PostgreSQL", "Docker", "Nginx") — this is how icons are matched.
- Node labels should describe function (e.g. "Frontend App", "Primary Database") — NOT contain brand names.
- Example: React["Frontend Application"] NOT WebApp["React Frontend"]`,
    inputSchema: z.object({
      mode: z
        .enum(['all', 'selective', 'remove'])
        .describe(
          'all = attach icons to all nodes, selective = attach to specific nodes, remove = remove icons'
        ),
      nodes: z
        .array(z.string())
        .optional()
        .describe('Node IDs to attach icons to (for selective mode)'),
      removeAll: z.boolean().optional().describe('Remove all icons (for remove mode)'),
      removeFromNodes: z
        .array(z.string())
        .optional()
        .describe('Node IDs to remove icons from (for remove mode)')
    }),
    execute: async ({ mode, nodes: targetNodes, removeAll, removeFromNodes }) => {
      const diagram = diagramStore.get(sessionId) || '';
      if (!diagram.trim()) return { success: false, error: 'No diagram to iconify' };

      const lines = diagram.split('\n');
      const allNodes = parseMermaidNodes(diagram);
      interface IconResult {
        nodeId: string;
        nodeText: string;
        status: 'added' | 'removed' | 'skipped';
        iconId?: string;
        iconUrl?: string;
        confidence?: number;
      }
      const results: IconResult[] = [];

      if (mode === 'remove') {
        // Remove icons: strip @{ img: ... } from same line
        const removeSet = removeAll ? null : new Set(removeFromNodes || []);
        for (let i = lines.length - 1; i >= 0; i--) {
          const iconMatch = lines[i].match(/^(\s*[\w][\w]*\[[^\]]*\])\s*@\{\s*img:[^}]*\}/);
          if (iconMatch) {
            const nodeId = iconMatch[1].match(/\s*([\w][\w]*)\[/)?.[1];
            if (nodeId && (removeSet === null || removeSet.has(nodeId))) {
              lines[i] = iconMatch[1]; // Remove the @{...} part, keep the node definition
              results.push({ nodeId, nodeText: '', status: 'removed' });
            }
          }
        }
        const newDiagram = lines.join('\n');
        diagramStore.set(sessionId, newDiagram);
        return {
          content: newDiagram,
          mode: 'remove',
          results,
          success: true,
          summary: `Removed icons from ${results.length} node(s)`
        };
      }

      // Mode: all or selective — resolve and attach icons
      const nodesToProcess =
        mode === 'all' ? allNodes : allNodes.filter((n) => targetNodes?.includes(n.id));

      if (nodesToProcess.length === 0) {
        return { success: false, error: 'No matching nodes found in diagram' };
      }

      // Resolve icons for each node and apply as separate annotation lines
      let insertionOffset = 0;
      for (const node of nodesToProcess) {
        const result = await resolveIconForNode(node.id, node.text);
        if (result) {
          // Escape node.id for safe regex usage
          const escapedId = node.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          // Find the current line index for this node (may have shifted from previous insertions)
          let currentLineIndex = -1;
          for (let i = 0; i < lines.length; i++) {
            if (
              lines[i].includes(`${node.id}[`) ||
              lines[i].includes(`${node.id}(`) ||
              lines[i].match(new RegExp(`^\\s*${escapedId}\\s*\\[`))
            ) {
              currentLineIndex = i;
              break;
            }
          }
          if (currentLineIndex === -1) currentLineIndex = node.line + insertionOffset;

          const iconLine = `    ${node.id}@{ img: "${result.url}", pos: "b", w: 60, h: 60, constraint: "on" }`;

          // Check if an icon line already exists for this node and replace it
          const existingIconIndex = lines.findIndex(
            (line, idx) => idx > currentLineIndex && line.trim().startsWith(`${node.id}@{`)
          );
          if (existingIconIndex !== -1) {
            lines[existingIconIndex] = iconLine;
          } else {
            // Insert new icon line after the node definition
            lines.splice(currentLineIndex + 1, 0, iconLine);
            insertionOffset++;
          }

          results.push({
            confidence: result.confidence,
            iconId: result.iconId,
            iconUrl: result.url,
            nodeId: node.id,
            nodeText: node.text,
            status: 'added'
          });
        } else {
          results.push({ nodeId: node.id, nodeText: node.text, status: 'skipped' });
        }
      }

      const newDiagram = lines.join('\n');
      diagramStore.set(sessionId, newDiagram);

      const addedCount = results.filter((r) => r.status === 'added').length;
      const skippedCount = results.filter((r) => r.status === 'skipped').length;

      return {
        content: newDiagram,
        mode,
        results,
        success: true,
        summary: `Iconified ${addedCount} node(s)${skippedCount > 0 ? `, ${skippedCount} skipped (below 90% confidence)` : ''}`
      };
    }
  });
}
