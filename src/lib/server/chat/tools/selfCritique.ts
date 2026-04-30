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

export function createSelfCritiqueTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Evaluate and improve the current diagram or document. Reviews the content for quality, completeness, best practices, and potential issues. Use after creating or editing a diagram to ensure quality, or when the user asks to "review", "improve", or "critique" the work.',
    inputSchema: z.object({
      target: z
        .enum(['diagram', 'document', 'both'])
        .describe('What to critique: diagram, document, or both'),
      criteria: z
        .array(
          z.enum([
            'completeness',
            'clarity',
            'best-practices',
            'accessibility',
            'complexity',
            'naming'
          ])
        )
        .optional()
        .describe('Specific criteria to evaluate. Defaults to all.')
    }),
    execute: async ({ target, criteria }) => {
      const diagram = diagramStore.get(sessionId) || '';
      const markdown = markdownStore.get(sessionId) || '';
      const evalCriteria = criteria || [
        'completeness',
        'clarity',
        'best-practices',
        'accessibility',
        'complexity',
        'naming'
      ];

      const result: Record<string, unknown> = {
        success: true,
        criteria: evalCriteria,
        instruction:
          'Evaluate the content against each criterion. For each, provide: (1) a score 1-5, (2) specific issues found, (3) concrete improvement suggestions. Then apply the top 3 most impactful improvements automatically using the appropriate tools. Summarize what was improved.'
      };

      if (target === 'diagram' || target === 'both') {
        if (!diagram.trim()) {
          result.diagram = { error: 'No diagram to critique' };
        } else {
          const lines = diagram.split('\n');
          const nodes = parseMermaidNodes(diagram);
          const review = buildDiagramReview(diagram);
          result.summary = review.summary;
          result.improvements = review.improvements;
          result.diagram = {
            content: diagram,
            hasComments: lines.some((l: string) => l.trim().startsWith('%%')),
            hasIcons: lines.some((l: string) => l.includes('@{')),
            hasStyles: lines.some((l: string) => l.trim().startsWith('style ')),
            hasSubgraphs: lines.some((l: string) => l.trim().startsWith('subgraph ')),
            lineCount: lines.length,
            nodeCount: nodes.length
          };
        }
      }

      if (target === 'document' || target === 'both') {
        if (!markdown.trim()) {
          result.document = { error: 'No document to critique' };
        } else {
          result.document = {
            content: markdown,
            hasCodeBlocks: /```/.test(markdown),
            hasHeadings: /^#{1,6}\s/m.test(markdown),
            hasLists: /^[-*]\s/m.test(markdown),
            lineCount: markdown.split('\n').length,
            wordCount: markdown.split(/\s+/).length
          };
        }
      }

      return result;
    }
  });
}
