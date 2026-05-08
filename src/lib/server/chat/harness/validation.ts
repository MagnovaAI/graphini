export function stepCalledTool(step: unknown, toolNames: string[]): boolean {
  const toolCalls = (step as { toolCalls?: { toolName?: string }[] } | undefined)?.toolCalls;
  return Array.isArray(toolCalls)
    ? toolCalls.some((call) => call.toolName && toolNames.includes(call.toolName))
    : false;
}

export function stepSucceededTool(step: unknown, toolNames: string[]): boolean {
  const toolResults = (
    step as
      | { toolResults?: { output?: unknown; result?: unknown; toolName?: string }[] }
      | undefined
  )?.toolResults;
  if (!Array.isArray(toolResults)) return false;

  return toolResults.some((toolResult) => {
    if (!toolResult.toolName || !toolNames.includes(toolResult.toolName)) return false;
    const output = toolResult.output ?? toolResult.result;
    if (!output || typeof output !== 'object') return true;
    if ('error' in output) return false;
    if ('success' in output) return (output as { success?: unknown }).success === true;
    return true;
  });
}

export function stepReturnedInvalidErrorCheck(step: unknown): boolean {
  const toolResults = (
    step as
      | { toolResults?: { output?: unknown; result?: unknown; toolName?: string }[] }
      | undefined
  )?.toolResults;
  if (!Array.isArray(toolResults)) return false;

  return toolResults.some((toolResult) => {
    if (toolResult.toolName !== 'errorChecker') return false;
    const output = toolResult.output ?? toolResult.result;
    if (!output || typeof output !== 'object') return false;
    return (
      (output as { valid?: unknown }).valid === false ||
      (output as { success?: unknown }).success === false
    );
  });
}

export function stepReturnedValidErrorCheck(step: unknown): boolean {
  const toolResults = (
    step as
      | { toolResults?: { output?: unknown; result?: unknown; toolName?: string }[] }
      | undefined
  )?.toolResults;
  if (!Array.isArray(toolResults)) return false;

  return toolResults.some((toolResult) => {
    if (toolResult.toolName !== 'errorChecker') return false;
    const output = toolResult.output ?? toolResult.result;
    if (!output || typeof output !== 'object') return false;
    return (
      (output as { valid?: unknown }).valid === true ||
      (output as { success?: unknown }).success === true
    );
  });
}
