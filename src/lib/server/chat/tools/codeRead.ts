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
import {
  targetMetadata,
  targetTabNameSchema,
  validateCodeTarget,
  type ToolContext
} from './context';

const execFileAsync = promisify(execFile);

export function createCodeReadTool({ modelId, sessionId, target }: ToolContext) {
  return tool({
    description:
      'Read the active non-Mermaid code tab content for JSON, YAML, Markdown, TypeScript, JavaScript, CSS, HTML, config, or other non-Mermaid code. Requires targetTabName to match the active tab. Use this before patching generated code artifacts.',
    inputSchema: z.object({
      endLine: z.number().int().min(1).optional().describe('Optional 1-based end line'),
      startLine: z.number().int().min(1).optional().describe('Optional 1-based start line'),
      targetTabName: targetTabNameSchema
    }),
    execute: async ({ startLine, endLine, targetTabName }) => {
      const code = codeStore.get(sessionId) || '';
      const language =
        target?.activeEngine === 'json' ||
        target?.activeEngine === 'yaml' ||
        target?.activeEngine === 'markdown'
          ? target.activeEngine
          : detectCodeLanguage(code);
      const targetError = validateCodeTarget(target, language, targetTabName);
      if (targetError) return { ...targetError, success: false };

      const lines = code.split('\n');

      if (!code.trim()) {
        return {
          ...targetMetadata(target, targetTabName),
          content: '',
          isPartial: false,
          language,
          readFrom: 1,
          readTo: 0,
          totalLines: 0
        };
      }

      const totalLines = lines.length;
      const from = startLine ? Math.max(1, Math.min(startLine, totalLines)) : 1;
      const to = endLine ? Math.max(from, Math.min(endLine, totalLines)) : totalLines;
      const isPartial = from !== 1 || to !== totalLines;

      return {
        ...targetMetadata(target, targetTabName),
        content: isPartial ? lines.slice(from - 1, to).join('\n') : code,
        isPartial,
        language,
        readFrom: from,
        readTo: to,
        totalLines
      };
    }
  });
}
