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
}

export function runChatStream({
  messages,
  model,
  modelId,
  providerHint,
  system,
  tools
}: RunOptions) {
  const allTools = tools;

  return streamText<typeof allTools>({
    messages: messages as never,
    model,
    prepareStep: ({ steps }) => {
      const lastStep = steps.at(-1);

      // After errorChecker passes, gently nudge the model to wrap up — but
      // don't force tools off; a follow-up patch or final text is its call.
      if (lastStep && 'errorChecker' in allTools && stepReturnedValidErrorCheck(lastStep)) {
        return {
          system: `${system}\n\nVALIDATION PASSED: errorChecker found no Mermaid errors. The diagram is good. Give a concise final answer unless the user asked for more.`
        } as never;
      }
      if (lastStep && 'errorChecker' in allTools && stepReturnedInvalidErrorCheck(lastStep)) {
        return {
          system: `${system}\n\nVALIDATION FAILED: errorChecker found Mermaid errors. Do not claim the diagram is fixed. Repair with diagramRead/diagramPatch (or diagramWrite if the patch range is unclear), then validate again. If you cannot fix it, say the remaining error plainly.`
        } as never;
      }
      if (
        lastStep &&
        'errorChecker' in allTools &&
        stepCalledTool(lastStep, ['diagramWrite', 'diagramPatch']) &&
        stepSucceededTool(lastStep, ['diagramWrite', 'diagramPatch'])
      ) {
        return {
          system: `${system}\n\nVALIDATION STEP: The previous step wrote or patched Mermaid. Call errorChecker next before doing anything else.`
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
