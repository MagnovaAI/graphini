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

export function createGitGuardTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Check git safety before any repository file or docs mutation. Use this before planning codebase file edits. Reports dirty status and protected paths; does not modify files.',
    inputSchema: z.object({
      operation: z.enum(['status', 'protect-paths', 'preflight']).describe('Git guard operation'),
      paths: z.array(z.string()).optional().describe('Paths the agent wants to read or modify'),
      reason: z.string().optional().describe('Why these paths are needed')
    }),
    execute: async ({ operation, paths = [], reason }) => {
      try {
        const { stdout } = await execFileAsync('git', ['status', '--short'], {
          cwd: process.cwd(),
          timeout: 5000
        });
        const changedPaths = stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.slice(3));
        const requestedDirtyPaths = paths.filter((requestedPath) =>
          changedPaths.some(
            (changedPath) =>
              changedPath === requestedPath ||
              changedPath.startsWith(`${requestedPath}/`) ||
              requestedPath.startsWith(`${changedPath}/`)
          )
        );

        return {
          changedPaths,
          clean: changedPaths.length === 0,
          operation,
          protectedPaths: requestedDirtyPaths,
          reason,
          requestedPaths: paths,
          requiresUserConfirmation: requestedDirtyPaths.length > 0,
          success: true
        };
      } catch (e) {
        return {
          error: e instanceof Error ? e.message : 'Unable to run git status',
          operation,
          requestedPaths: paths,
          success: false
        };
      }
    }
  });
}
