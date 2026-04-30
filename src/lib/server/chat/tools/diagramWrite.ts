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

export function createDiagramWriteTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Replace the entire diagram with new content. ONLY Mermaid diagram syntax is allowed. Do NOT write markdown, documentation, or prose here.',
    inputSchema: z.object({
      content: z
        .string()
        .describe(
          'Complete new Mermaid diagram content — must start with a valid diagram type (graph, flowchart, sequenceDiagram, classDiagram, etc.)'
        )
    }),
    execute: async ({ content }) => {
      // Unescape \n to actual newlines
      const unescapedContent = content.replace(/\\n/g, '\n');
      const trimmed = unescapedContent.trim();

      // Validate: must be one complete Mermaid document with one diagram root
      const validation = validateSingleMermaidDocument(trimmed);
      if (!validation.valid) {
        return {
          error: validation.error,
          hint: validation.hint
        };
      }

      // Validate: reject if content looks like markdown
      const markdownSignals = /^(#{1,6}\s|\*\*|__|\[.*\]\(.*\)|^>\s|^-{3,}$|^\*{3,}$|^```)/m;
      if (markdownSignals.test(trimmed)) {
        return {
          error:
            'REJECTED: Content contains markdown formatting. Use markdownWrite for documentation. Redo with pure Mermaid diagram syntax only.',
          hint: 'diagramWrite only accepts Mermaid diagram syntax.'
        };
      }

      diagramStore.set(sessionId, unescapedContent);
      return {
        success: true,
        lines: unescapedContent.split('\n').length,
        content: unescapedContent
      };
    }
  });
}
