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

export function createAskQuestionsTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Ask the user one or more multiple-choice or multi-select questions to clarify requirements before creating/editing a diagram. The user will see a questionnaire UI and can select answers. Use this when the request is ambiguous or you need to understand preferences (e.g. diagram type, level of detail, which components to include). Questions should be concise and options should be clear.',
    inputSchema: z.object({
      context: z.string().describe('Brief context about why you are asking these questions'),
      questions: z
        .array(
          z.object({
            id: z.string().describe('Unique question ID like q1, q2'),
            text: z.string().describe('The question text'),
            type: z
              .enum(['single', 'multi'])
              .describe('single = radio buttons, multi = checkboxes'),
            options: z
              .array(
                z.object({
                  id: z.string().describe('Option ID like a, b, c'),
                  label: z.string().describe('Option label shown to user')
                })
              )
              .describe('Answer options (2-6 options)')
          })
        )
        .describe('Array of questions to ask')
    })
    // No execute — this is a client-handled tool (requires user interaction)
  });
}
