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

export function createPlanWithProgressTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description: `Create and manage a visible plan with progress tracking. The plan is shown to the user as a checklist that updates in real-time as steps are completed.

OPERATIONS:
- "create" — Create a new plan with steps. Each step has an id, title, and optional description.
- "update" — Update a step's status to "pending", "in_progress", "done", or "skipped".
- "get" — Get the current plan and all step statuses.

WHEN TO USE:
- When the user asks for something complex that requires multiple steps
- When you want to show the user your progress on a multi-step task
- After creating a plan, update each step as you work through it
- Always create a plan before starting complex diagram creation tasks`,
    inputSchema: z.object({
      message: z.string().optional().describe('Progress message (for update)'),
      operation: z.enum(['create', 'update', 'get']).describe('Plan operation'),
      status: z
        .enum(['pending', 'in_progress', 'done', 'skipped'])
        .optional()
        .describe('New status (for update)'),
      stepId: z.string().optional().describe('Step ID to update (for update)'),
      steps: z
        .array(
          z.object({
            id: z.string().describe('Step ID like step1, step2'),
            title: z.string().describe('Step title'),
            description: z.string().optional().describe('Step description')
          })
        )
        .optional()
        .describe('Plan steps (for create)'),
      title: z.string().optional().describe('Plan title (for create)')
    }),
    execute: async ({ operation, title, steps, stepId, status, message }) => {
      const planKey = `plan_${sessionId}`;
      let plan: {
        title: string;
        createdAt: string;
        steps: {
          id: string;
          title: string;
          description: string;
          status: string;
          message: string;
          updatedAt: string;
        }[];
      } | null = null;
      try {
        const stored = planStore.get(planKey);
        if (stored) plan = JSON.parse(stored);
      } catch {
        /* ignore */
      }

      switch (operation) {
        case 'create': {
          if (!title || !steps || steps.length === 0)
            return { success: false, error: 'title and steps required for create' };
          plan = {
            title,
            createdAt: new Date().toISOString(),
            steps: steps.map((s) => ({
              description: s.description || '',
              id: s.id,
              message: '',
              status: 'pending' as const,
              title: s.title,
              updatedAt: new Date().toISOString()
            }))
          };
          planStore.set(planKey, JSON.stringify(plan));
          return {
            success: true,
            plan,
            message: `Plan created: "${title}" with ${steps.length} steps`
          };
        }
        case 'update': {
          if (!plan) return { success: false, error: 'No active plan. Create one first.' };
          if (!stepId || !status)
            return { success: false, error: 'stepId and status required for update' };
          const step = plan.steps.find((s) => s.id === stepId);
          if (!step) return { success: false, error: `Step not found: ${stepId}` };
          step.status = status;
          step.message = message || '';
          step.updatedAt = new Date().toISOString();
          planStore.set(planKey, JSON.stringify(plan));
          const done = plan.steps.filter((s) => s.status === 'done').length;
          const total = plan.steps.length;
          return {
            success: true,
            plan,
            progress: `${done}/${total} steps done`,
            stepUpdated: stepId
          };
        }
        case 'get': {
          if (!plan) return { success: false, error: 'No active plan.' };
          const done = plan.steps.filter((s) => s.status === 'done').length;
          return { success: true, plan, progress: `${done}/${plan.steps.length} steps done` };
        }
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    }
  });
}
