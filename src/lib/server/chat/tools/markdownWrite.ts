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

export function createMarkdownWriteTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Write or replace content in the markdown/document editor panel. Use this ONLY for documentation, notes, or explanations. Do NOT write Mermaid diagram code here — use diagramWrite for that.',
    inputSchema: z.object({
      content: z
        .string()
        .describe(
          'The markdown/documentation content to write. Must NOT be Mermaid diagram syntax.'
        ),
      append: z
        .boolean()
        .optional()
        .describe('If true, append to existing content instead of replacing')
    }),
    execute: async ({ content, append }) => {
      // Validate: reject if content looks like a Mermaid diagram
      const trimmed = content.trim();
      const mermaidDiagramTypes =
        /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|kanban|gitGraph|gitgraph|quadrantChart|xyChart|xychart|sankey|block|packet|architecture|C4Context|C4Container|C4Component|C4Deployment|requirementDiagram|zenuml)\b/i;
      if (mermaidDiagramTypes.test(trimmed)) {
        return {
          error:
            'REJECTED: Content appears to be Mermaid diagram code, not markdown documentation. Use diagramWrite to write diagram code. Use markdownWrite ONLY for documentation/prose.',
          hint: 'markdownWrite is for documentation only. Use diagramWrite for Mermaid diagrams.'
        };
      }

      const existing = markdownStore.get(sessionId) || '';
      const newContent = append ? (existing ? existing + '\n\n' + content : content) : content;
      markdownStore.set(sessionId, newContent);
      return {
        success: true,
        content: newContent,
        lines: newContent.split('\n').length
      };
    }
  });
}
