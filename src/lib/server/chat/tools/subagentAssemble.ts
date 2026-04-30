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

export function createSubagentAssembleTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Assemble planned subagent outputs into a single integration plan. Use after subagentFanout. Produces ordered changes, conflict notes, and verification steps; does not mutate files.',
    inputSchema: z.object({
      outputs: z.array(
        z.object({
          agentId: z.string().min(1),
          changedPaths: z.array(z.string()).optional(),
          summary: z.string().min(1)
        })
      ),
      runId: z.string().min(1),
      verification: z.array(z.string()).optional()
    }),
    execute: async ({ runId, outputs, verification = [] }) => {
      return {
        integrationPlan: outputs.map((output, index) => ({
          order: index + 1,
          ...output
        })),
        nextRequiredAction:
          'Continue after assembly: execute the next concrete tool step, ask for missing confirmation, or clearly state the blocker. Do not stop at assembly alone.',
        runId,
        success: true,
        verification,
        warning:
          'Assembly is advisory only. File writes require explicit repository write tooling and gitGuard preflight.'
      };
    }
  });
}
