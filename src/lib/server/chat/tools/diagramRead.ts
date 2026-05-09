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
import { instructionsForSubagent } from '$lib/server/chat/subagents';
import { tool } from 'ai';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { resolveIconForNode } from './icon-resolver';
import {
  targetMetadata,
  targetTabNameSchema,
  validateMermaidTarget,
  type ToolContext
} from './context';

const execFileAsync = promisify(execFile);

export function createDiagramReadTool({ modelId, sessionId, target }: ToolContext) {
  return tool({
    description:
      'Read the active Mermaid tab content. Optionally read a specific range of lines. Requires targetTabName to match the active Mermaid tab. The client will validate syntax using the real Mermaid parser. ALWAYS call this first before making changes.',
    inputSchema: z.object({
      startLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Optional 1-based start line to read from'),
      endLine: z.number().int().min(1).optional().describe('Optional 1-based end line to read to'),
      targetTabName: targetTabNameSchema
    }),
    execute: async ({ startLine, endLine, targetTabName }) => {
      const targetError = validateMermaidTarget(target, targetTabName);
      if (targetError) return targetError;

      const diagram = diagramStore.get(sessionId) || '';
      const allLines = diagram.split('\n');
      const totalLines = allLines.length;

      if (diagram.trim().length === 0) {
        return {
          ...targetMetadata(target, targetTabName),
          content: '',
          isPartial: false,
          readFrom: 1,
          readTo: 0,
          totalLines: 0
        };
      }

      // Determine read range
      const from = startLine ? Math.max(1, Math.min(startLine, totalLines)) : 1;
      const to = endLine ? Math.max(from, Math.min(endLine, totalLines)) : totalLines;
      const isPartial = from !== 1 || to !== totalLines;

      const readContent = isPartial ? allLines.slice(from - 1, to).join('\n') : diagram;

      return {
        ...targetMetadata(target, targetTabName),
        content: readContent,
        isPartial,
        readFrom: from,
        readTo: to,
        totalLines
      };
    }
  });
}
