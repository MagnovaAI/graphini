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

export function createCodeWriteTool({ modelId, sessionId, target }: ToolContext) {
  return tool({
    description:
      'Create or replace the active non-Mermaid code tab. Use for JSON, YAML, Markdown, TypeScript, JavaScript, Svelte, HTML, CSS, config, and plaintext code. Requires targetTabName to match the active tab, and language must match JSON/YAML/Markdown tabs. This does not write to the repository filesystem.',
    inputSchema: z.object({
      content: z.string().min(1).describe('Complete code artifact content'),
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
        .describe('Language of the code artifact'),
      purpose: z.string().optional().describe('Short reason for creating this code artifact'),
      targetTabName: targetTabNameSchema
    }),
    execute: async ({ content, language, purpose, targetTabName }) => {
      const targetError = validateCodeTarget(target, language, targetTabName);
      if (targetError) return { ...targetError, success: false };

      const unescapedContent = content.replace(/\\n/g, '\n');
      const validation = validateCodeArtifact(unescapedContent, language);
      if (!validation.valid) return { success: false, error: validation.error };

      codeStore.set(sessionId, unescapedContent);
      return {
        ...targetMetadata(target, targetTabName),
        content: unescapedContent,
        language,
        lines: unescapedContent.split('\n').length,
        purpose,
        success: true
      };
    }
  });
}
