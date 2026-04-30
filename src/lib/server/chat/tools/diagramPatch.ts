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

export function createDiagramPatchTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Apply a patch to the diagram by replacing lines from startLine to endLine with new content. ONLY Mermaid diagram syntax is allowed. Do NOT write markdown, documentation, or prose here.',
    inputSchema: z.object({
      startLine: z.number().int().min(1).describe('1-based starting line number'),
      endLine: z.number().int().min(1).describe('1-based ending line number'),
      content: z.string().describe('New Mermaid diagram content to replace the specified lines')
    }),
    execute: async ({ startLine, endLine, content }) => {
      // Validate: reject markdown/prose content
      const markdownSignals = /^(#{1,6}\s|\*\*|__|\[.*\]\(.*\)|^>\s|^-{3,}$|^\*{3,}$|^```)/m;
      if (markdownSignals.test(content)) {
        return {
          error:
            'REJECTED: Content appears to be markdown/documentation, not Mermaid diagram syntax. Use markdownWrite for documentation. Redo with valid Mermaid code only.',
          hint: 'diagramPatch only accepts Mermaid diagram syntax (graph, flowchart, sequenceDiagram, etc.)'
        };
      }

      const diagram = diagramStore.get(sessionId) || '';
      const lines = diagram.split('\n');

      if (startLine > endLine) {
        return { error: `startLine (${startLine}) cannot exceed endLine (${endLine})` };
      }
      if (endLine > lines.length) {
        return { error: `endLine ${endLine} exceeds diagram length (${lines.length} lines)` };
      }

      // Unescape \n to actual newlines
      const unescapedContent = content.replace(/\\n/g, '\n');
      lines.splice(startLine - 1, endLine - startLine + 1, ...unescapedContent.split('\n'));
      const newDiagram = lines.join('\n');
      const validation = validateSingleMermaidDocument(newDiagram);
      if (!validation.valid) {
        return {
          error: validation.error,
          hint: validation.hint
        };
      }

      diagramStore.set(sessionId, newDiagram);

      return { success: true, newLineCount: lines.length, content: newDiagram };
    }
  });
}
