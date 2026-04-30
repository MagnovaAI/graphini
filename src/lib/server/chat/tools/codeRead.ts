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

export function createCodeReadTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Read the current code artifact content for JSON, YAML, TypeScript, JavaScript, CSS, HTML, config, or other non-Mermaid code. Use this before patching generated code artifacts.',
    inputSchema: z.object({
      endLine: z.number().int().min(1).optional().describe('Optional 1-based end line'),
      startLine: z.number().int().min(1).optional().describe('Optional 1-based start line')
    }),
    execute: async ({ startLine, endLine } = {}) => {
      const code = codeStore.get(sessionId) || '';
      const lines = code.split('\n');

      if (!code.trim()) {
        return { content: '', isPartial: false, readFrom: 1, readTo: 0, totalLines: 0 };
      }

      const totalLines = lines.length;
      const from = startLine ? Math.max(1, Math.min(startLine, totalLines)) : 1;
      const to = endLine ? Math.max(from, Math.min(endLine, totalLines)) : totalLines;
      const isPartial = from !== 1 || to !== totalLines;

      return {
        content: isPartial ? lines.slice(from - 1, to).join('\n') : code,
        isPartial,
        language: detectCodeLanguage(code),
        readFrom: from,
        readTo: to,
        totalLines
      };
    }
  });
}
