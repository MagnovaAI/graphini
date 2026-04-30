function wantsSubagents(message: string): boolean {
  return /\b(subagents?|multi[-\s]?agent|fan\s*out|parallel agents?|specialist agents?)\b/i.test(
    message
  );
}

function wantsDeepThinking(message: string): boolean {
  return /\b(think harder|think deeply|deep thinking|reason through|step by step|trade-?offs?|analy[sz]e deeply)\b/i.test(
    message
  );
}

function wantsRepoPlanning(message: string): boolean {
  return /\b(modify|edit|write|patch|change|refactor|commit|repo|repository|codebase|file|docs?)\b/i.test(
    message
  );
}

export function shouldExposePlanningTool(toolName: string, message: string): boolean {
  const subagentRequested = wantsSubagents(message);
  const deepThinkingRequested = wantsDeepThinking(message);
  const repoPlanningRequested = wantsRepoPlanning(message);

  switch (toolName) {
    case 'subagentFanout':
    case 'subagentAssemble':
      return subagentRequested || repoPlanningRequested;
    case 'sequentialThinking':
      return deepThinkingRequested;
    case 'planner':
    case 'planWithProgress':
      return deepThinkingRequested || subagentRequested || repoPlanningRequested;
    case 'gitGuard':
      return repoPlanningRequested;
    default:
      return true;
  }
}

export function hasRecentSubagentFanout(uiMessages: unknown): boolean {
  if (!Array.isArray(uiMessages)) return false;

  return uiMessages
    .slice(-8)
    .some((message) =>
      /subagentFanout|Ran \d+ subagent|specialist output|Continue after fanout/i.test(
        JSON.stringify(message)
      )
    );
}
