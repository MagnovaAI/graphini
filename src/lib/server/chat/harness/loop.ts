import { getChatProviderOptions } from '$lib/server/chat/model';
import { isLoopFinished, streamText, type LanguageModel, type ToolSet } from 'ai';
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
          system: `${system}\n\nVALIDATION: errorChecker found no structural issues. If the user reports the canvas still shows an error, trust their report — the canvas renderer is the source of truth — and repair via fileSystem patch or update. Otherwise give a concise final answer.`
        } as never;
      }
      if (lastStep && 'errorChecker' in allTools && stepReturnedInvalidErrorCheck(lastStep)) {
        return {
          system: `${system}\n\nVALIDATION FAILED: errorChecker found Mermaid errors. Do not claim the diagram is fixed. Repair with fileSystem read/patch (or fileSystem update if the patch range is unclear), then validate again. If you cannot fix it, say the remaining error plainly.`
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
          system: `${system}\n\nVALIDATION STEP: The previous step ran fileSystem. If it touched a .mermaid file (create/update/patch), call errorChecker next before doing anything else.`
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
