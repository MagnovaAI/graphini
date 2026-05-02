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
  validateMermaidTarget,
  type ToolContext
} from './context';

const execFileAsync = promisify(execFile);

export function createDiagramDeleteTool({ modelId, sessionId, target }: ToolContext) {
  return tool({
    description:
      'Clear the active Mermaid tab. Requires targetTabName to match the active Mermaid tab.',
    inputSchema: z.object({
      targetTabName: targetTabNameSchema
    }),
    execute: async ({ targetTabName }) => {
      const targetError = validateMermaidTarget(target, targetTabName);
      if (targetError) return targetError;
      diagramStore.set(sessionId, '');
      return { ...targetMetadata(target, targetTabName), success: true, content: '' };
    }
  });
}
