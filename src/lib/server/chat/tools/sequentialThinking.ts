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

export function createSequentialThinkingTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description: `Think through a problem step-by-step before acting. Use this for complex reasoning, analysis, or when you need to break down a problem before creating a diagram.

This tool lets you record your thought process visibly to the user, showing them your reasoning chain. Each thought builds on the previous one.

WHEN TO USE:
- Before creating complex architecture diagrams (think about components, relationships, data flow)
- When analyzing requirements or trade-offs
- When the user asks "how would you approach..." or "what's the best way to..."
- For debugging complex diagram issues
- When you need to reason about multiple options before choosing one`,
    inputSchema: z.object({
      thought: z.string().describe('Your current thought/reasoning step'),
      thoughtNumber: z.number().int().min(1).describe('Current thought number (1, 2, 3...)'),
      totalThoughts: z.number().int().min(1).describe('Estimated total thoughts needed'),
      nextAction: z.string().optional().describe('What you plan to do next based on this thought')
    }),
    execute: async ({ thought, thoughtNumber, totalThoughts, nextAction }) => {
      return {
        isComplete: thoughtNumber >= totalThoughts,
        nextAction: nextAction || '',
        success: true,
        thought,
        thoughtNumber,
        totalThoughts
      };
    }
  });
}
