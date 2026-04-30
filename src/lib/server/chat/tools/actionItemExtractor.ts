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

export function createActionItemExtractorTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Extract action items, tasks, KPIs, risks, and key entities from the current document or a provided text. Returns structured data that can be used to create diagrams or task lists. Use when the user asks to "extract action items", "find tasks", "identify risks", or "summarize key points".',
    inputSchema: z.object({
      source: z
        .enum(['document', 'text'])
        .describe(
          'Where to extract from: "document" = current markdown panel, "text" = provided text'
        ),
      text: z
        .string()
        .optional()
        .describe('Text to extract from (only used when source is "text")'),
      extractTypes: z
        .array(z.enum(['actions', 'risks', 'kpis', 'entities', 'decisions', 'deadlines']))
        .optional()
        .describe('Types of items to extract. Defaults to all.')
    }),
    execute: async ({ source, text, extractTypes }) => {
      const content = source === 'document' ? markdownStore.get(sessionId) || '' : text || '';
      if (!content.trim()) {
        return { success: false, error: 'No content to extract from' };
      }

      const types = extractTypes || [
        'actions',
        'risks',
        'kpis',
        'entities',
        'decisions',
        'deadlines'
      ];

      return {
        content: content,
        instruction:
          'Analyze the provided content and extract the requested item types. Return structured results with: actions (who, what, when), risks (description, severity, mitigation), KPIs (metric, target, current), entities (name, type, role), decisions (what, rationale, impact), deadlines (task, date, owner). Format as a clear summary.',
        requestedTypes: types,
        sourceLength: content.length,
        sourceLines: content.split('\n').length,
        success: true
      };
    }
  });
}
