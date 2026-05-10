import { getChatProviderOptions } from '$lib/server/chat/model';
import {
  InvalidToolInputError,
  isLoopFinished,
  NoSuchToolError,
  streamText,
  type LanguageModel,
  type ToolCallRepairFunction,
  type ToolSet
} from 'ai';
import {
  stepCalledTool,
  stepReturnedInvalidErrorCheck,
  stepReturnedValidErrorCheck,
  stepSucceededTool
} from './validation';

interface RunOptions {
  messages: Record<string, unknown>[];
  /** Pre-resolved language model instance (already bound to per-user creds). */
  model: LanguageModel;
  /** The original modelId string (used for provider-options lookup). */
  modelId: string;
  providerHint?: string;
  system: string;
  tools: ToolSet;
  /**
   * Aborts model generation when the client disconnects (Stop button or
   * navigation). Threaded through from the endpoint's `request.signal` so
   * cancelling on the client also stops upstream token usage.
   */
  abortSignal?: AbortSignal;
}

const FILE_OPERATION_TOOL_NAMES = new Set([
  'list',
  'read',
  'create',
  'edit',
  'delete',
  'moveFolder',
  'deleteFolder',
  'update',
  'patch',
  'workspaceFiles'
]);

const TOOL_NAME_ALIASES: Record<string, string> = {
  think: 'thinking'
};

function parseToolInput(input: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(input) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* repair with an empty input */
  }
  return {};
}

function normalizeWorkspaceOperation(operation: unknown): string | undefined {
  if (operation === 'update' || operation === 'patch') return 'edit';
  return typeof operation === 'string' ? operation : undefined;
}

function normalizeAskQuestionsInput(input: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(input.questions)) return input;
  return {
    ...input,
    questions: input.questions.map((question) => {
      if (!question || typeof question !== 'object' || Array.isArray(question)) return question;
      const q = question as Record<string, unknown>;
      if (!Array.isArray(q.options)) return q;
      return {
        ...q,
        options: q.options.map((option) => {
          if (!option || typeof option !== 'object' || Array.isArray(option)) return option;
          const o = option as Record<string, unknown>;
          if (typeof o.label === 'string' && o.label.trim()) return o;
          if (o.other === true) return { ...o, label: 'Other' };
          return o;
        })
      };
    })
  };
}

const repairGraphiniToolCall: ToolCallRepairFunction<ToolSet> = async ({
  error,
  toolCall,
  tools
}) => {
  const input = parseToolInput(toolCall.input);
  const requestedTool = toolCall.toolName;

  if (NoSuchToolError.isInstance(error)) {
    const aliasedTool = TOOL_NAME_ALIASES[requestedTool];
    if (aliasedTool && aliasedTool in tools) {
      return {
        ...toolCall,
        toolName: aliasedTool
      };
    }
  }

  if (
    'fileSystem' in tools &&
    NoSuchToolError.isInstance(error) &&
    FILE_OPERATION_TOOL_NAMES.has(requestedTool)
  ) {
    const requestedOperation = requestedTool === 'workspaceFiles' ? input.operation : requestedTool;
    const operation = normalizeWorkspaceOperation(requestedOperation);
    if (!operation) return null;
    return {
      ...toolCall,
      input: JSON.stringify({ ...input, operation }),
      toolName: 'fileSystem'
    };
  }

  if (
    'fileSystem' in tools &&
    InvalidToolInputError.isInstance(error) &&
    requestedTool === 'fileSystem'
  ) {
    const operation = normalizeWorkspaceOperation(input.operation);
    if (!operation || operation === input.operation) return null;
    return {
      ...toolCall,
      input: JSON.stringify({ ...input, operation }),
      toolName: 'fileSystem'
    };
  }

  if (InvalidToolInputError.isInstance(error) && requestedTool === 'askQuestions') {
    const repaired = normalizeAskQuestionsInput(input);
    if (JSON.stringify(repaired) === JSON.stringify(input)) return null;
    return {
      ...toolCall,
      input: JSON.stringify(repaired),
      toolName: 'askQuestions'
    };
  }

  return null;
};

export function runChatStream({
  messages,
  model,
  modelId,
  providerHint,
  system,
  tools,
  abortSignal
}: RunOptions) {
  const allTools = tools;

  return streamText<typeof allTools>({
    abortSignal,
    experimental_repairToolCall: repairGraphiniToolCall as never,
    messages: messages as never,
    model,
    prepareStep: ({ steps }) => {
      const lastStep = steps.at(-1);

      // After errorChecker reports clean, gently nudge the model to wrap up.
      // The server-side check covers structural issues only; the client re-runs
      // the real Mermaid parse against the canvas pipeline and surfaces any
      // remaining render error back to the user, so don't overclaim here.
      if (lastStep && 'errorChecker' in allTools && stepReturnedValidErrorCheck(lastStep)) {
        return {
          system: `${system}\n\nVALIDATION: errorChecker found no structural issues. If the user reports the canvas still shows an error, trust their report — the canvas renderer is the source of truth — and repair via fileSystem operation "edit". Otherwise give a concise final answer.`
        } as never;
      }
      if (lastStep && 'errorChecker' in allTools && stepReturnedInvalidErrorCheck(lastStep)) {
        return {
          system: `${system}\n\nVALIDATION FAILED: errorChecker found Mermaid errors. Do not claim the diagram is fixed. Repair with fileSystem using { "operation": "read", "path": "..." } followed by fileSystem using { "operation": "edit", ... }, then validate again. If you cannot fix it, say the remaining error plainly.`
        } as never;
      }
      // After a successful fileSystem write to a .mermaid file, prompt validation.
      if (
        lastStep &&
        'errorChecker' in allTools &&
        stepCalledTool(lastStep, ['fileSystem']) &&
        stepSucceededTool(lastStep, ['fileSystem'])
      ) {
        return {
          system: `${system}\n\nVALIDATION STEP: The previous step ran fileSystem. If it touched a .mermaid file with operation "create" or "edit", call errorChecker next before doing anything else.`
        } as never;
      }
      return undefined;
    },
    providerOptions: getChatProviderOptions(modelId, providerHint),
    // Keep stepping while the model emits tool calls; exit when it returns
    // a step with no tool calls. isLoopFinished returns false so the SDK
    // never stops on its own — the model decides when the turn is done.
    stopWhen: isLoopFinished(),
    system,
    temperature: 0.9,
    tools: allTools
  });
}
