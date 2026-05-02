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

export function createCodePatchTool({ modelId, sessionId, target }: ToolContext) {
  return tool({
    description:
      'Patch the active non-Mermaid code tab by replacing a 1-based line range. Use for JSON, YAML, Markdown, TypeScript, JavaScript, CSS, HTML, config, and other code. Requires targetTabName to match the active tab, and language must match JSON/YAML/Markdown tabs. Never use this for Mermaid diagrams.',
    inputSchema: z.object({
      content: z.string().min(1).describe('Replacement code for the selected line range'),
      endLine: z.number().int().min(1).describe('1-based ending line number'),
      language: z
        .enum([
          'json',
          'yaml',
          'typescript',
          'javascript',
          'svelte',
          'html',
          'css',
          'markdown',
          'text'
        ])
        .optional()
        .describe('Language of the code artifact'),
      startLine: z.number().int().min(1).describe('1-based starting line number'),
      targetTabName: targetTabNameSchema
    }),
    execute: async ({ startLine, endLine, content, language, targetTabName }) => {
      const resolvedLanguage =
        language ??
        (target?.activeEngine === 'json' ||
        target?.activeEngine === 'yaml' ||
        target?.activeEngine === 'markdown'
          ? target.activeEngine
          : detectCodeLanguage(codeStore.get(sessionId) || ''));
      const targetError = validateCodeTarget(target, resolvedLanguage, targetTabName);
      if (targetError) return { ...targetError, success: false };

      const current = codeStore.get(sessionId) || '';
      const lines = current.split('\n');

      if (startLine > endLine) {
        return {
          success: false,
          error: `startLine (${startLine}) cannot exceed endLine (${endLine})`
        };
      }
      if (!current.trim()) {
        return { success: false, error: 'No code artifact exists yet. Use codeWrite first.' };
      }
      if (endLine > lines.length) {
        return {
          success: false,
          error: `endLine ${endLine} exceeds artifact length (${lines.length})`
        };
      }

      const unescapedContent = content.replace(/\\n/g, '\n');
      lines.splice(startLine - 1, endLine - startLine + 1, ...unescapedContent.split('\n'));
      const nextCode = lines.join('\n');
      const validation = validateCodeArtifact(nextCode, resolvedLanguage);
      if (!validation.valid) return { success: false, error: validation.error };

      codeStore.set(sessionId, nextCode);
      return {
        ...targetMetadata(target, targetTabName),
        content: nextCode,
        language: resolvedLanguage,
        lines: nextCode.split('\n').length,
        success: true
      };
    }
  });
}
