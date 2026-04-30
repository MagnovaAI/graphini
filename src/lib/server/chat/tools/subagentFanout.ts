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

export function createSubagentFanoutTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Run a bounded multi-agent fanout for complex work. Creates specialist assignments, executes lightweight parallel specialist LLM calls, and returns concrete subagent outputs for assembly. This does not mutate files.',
    inputSchema: z.object({
      agents: z
        .array(
          z.object({
            allowedTools: z.array(z.string()).optional(),
            id: z.string().min(1),
            objective: z.string().min(1),
            ownedPaths: z.array(z.string()).optional(),
            role: z.enum([
              'planner',
              'diagram-engineer',
              'visual-polish',
              'research-agent',
              'document-agent',
              'data-agent',
              'critic',
              'code-agent'
            ])
          })
        )
        .min(1),
      task: z.string().min(1)
    }),
    execute: async ({ task, agents }) => {
      const runId = crypto.randomUUID();
      const runStartedAt = new Date();
      const assignments = agents.map((agent) => ({
        ...agent,
        guardrails: [
          'Do not modify files outside ownedPaths.',
          'Do not overwrite dirty user changes.',
          'Return a patch or artifact summary before assembly.'
        ],
        status: 'planned'
      }));

      const agentOutputs = await Promise.all(
        assignments.map(async (agent) => {
          const startedAt = new Date();
          const system = instructionsForSubagent(agent.role);
          const prompt = [
            `Task: ${task}`,
            `Specialist objective: ${agent.objective}`,
            agent.ownedPaths?.length ? `Owned paths: ${agent.ownedPaths.join(', ')}` : '',
            agent.allowedTools?.length ? `Allowed tools: ${agent.allowedTools.join(', ')}` : '',
            'Return: concise findings, proposed concrete output, and any blocker.'
          ]
            .filter(Boolean)
            .join('\n');

          if (!modelId) {
            const completedAt = new Date();
            return {
              agentId: agent.id,
              allowedTools: agent.allowedTools || [],
              completedAt: completedAt.toISOString(),
              durationMs: completedAt.getTime() - startedAt.getTime(),
              events: [
                { at: startedAt.toISOString(), label: 'Queued specialist assignment' },
                { at: completedAt.toISOString(), label: 'Failed: no model available' }
              ],
              objective: agent.objective,
              output: 'No model was available for specialist execution.',
              prompt,
              role: agent.role,
              startedAt: startedAt.toISOString(),
              status: 'failed'
            };
          }

          try {
            const result = await generateText({
              maxOutputTokens: 900,
              model: openrouterFastChat(modelId),
              prompt,
              system,
              temperature: 0.45
            });
            const completedAt = new Date();

            return {
              agentId: agent.id,
              allowedTools: agent.allowedTools || [],
              completedAt: completedAt.toISOString(),
              durationMs: completedAt.getTime() - startedAt.getTime(),
              events: [
                { at: startedAt.toISOString(), label: 'Queued specialist assignment' },
                { at: startedAt.toISOString(), label: `Started ${agent.role}` },
                { at: completedAt.toISOString(), label: 'Returned specialist output' }
              ],
              modelId,
              objective: agent.objective,
              output: result.text,
              prompt,
              role: agent.role,
              startedAt: startedAt.toISOString(),
              status: 'completed'
            };
          } catch (e) {
            const completedAt = new Date();
            return {
              agentId: agent.id,
              allowedTools: agent.allowedTools || [],
              completedAt: completedAt.toISOString(),
              durationMs: completedAt.getTime() - startedAt.getTime(),
              events: [
                { at: startedAt.toISOString(), label: 'Queued specialist assignment' },
                { at: startedAt.toISOString(), label: `Started ${agent.role}` },
                { at: completedAt.toISOString(), label: 'Failed during specialist execution' }
              ],
              modelId,
              objective: agent.objective,
              output: e instanceof Error ? e.message : 'Subagent execution failed',
              prompt,
              role: agent.role,
              startedAt: startedAt.toISOString(),
              status: 'failed'
            };
          }
        })
      );

      subagentStore.set(
        `subagents_${sessionId}_${runId}`,
        JSON.stringify({ assignments, outputs: agentOutputs, task })
      );

      const runCompletedAt = new Date();

      return {
        assignments,
        completedAt: runCompletedAt.toISOString(),
        durationMs: runCompletedAt.getTime() - runStartedAt.getTime(),
        nextRequiredAction:
          'Continue after fanout: DO NOT call subagentFanout again. Use the completed specialist outputs to perform the concrete next tool step, call subagentAssemble, or ask one blocking question.',
        outputs: agentOutputs,
        runId,
        startedAt: runStartedAt.toISOString(),
        success: true,
        task
      };
    }
  });
}
