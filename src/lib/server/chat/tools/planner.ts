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

export function createPlannerTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Decompose a complex task into a step-by-step plan. Use this when the user asks for something complex that requires multiple steps (e.g. "Create architecture diagram for RAG system"). Returns a structured plan that you should execute step-by-step using other tools.',
    inputSchema: z.object({
      task: z.string().describe('The user task to decompose into steps'),
      context: z
        .string()
        .optional()
        .describe('Additional context about the current state (diagram, document, etc.)')
    }),
    execute: async ({ task, context }) => {
      const diagram = diagramStore.get(sessionId) || '';
      const markdown = markdownStore.get(sessionId) || '';

      return {
        context: context || '',
        currentState: {
          hasDiagram: diagram.trim().length > 0,
          diagramLines: diagram.split('\n').length,
          hasDocument: markdown.trim().length > 0,
          documentLines: markdown.split('\n').length
        },
        instruction:
          'Analyze the task and create a step-by-step plan. For each step, identify which tool to use. Then execute the plan step-by-step, calling the appropriate tools. After completing all steps, summarize what was done.',
        success: true,
        task
      };
    }
  });
}
