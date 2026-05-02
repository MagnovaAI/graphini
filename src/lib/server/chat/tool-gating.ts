function wantsSubagents(message: string): boolean {
  const negatedSubagentTarget =
    /\b(no|not|don't|dont|never|without|avoid|stop)\b.{0,80}\b(subagents?|multi[-\s]?agent|fan\s*out|parallel agents?|specialist agents?)\b/i;
  const diagnosticSubagentTarget =
    /\b(why|what|how)\b.{0,80}\b(use|using|used|run|ran|spawn|spawned|deploy|deployed|fan\s*out|subagents?|multi[-\s]?agent|parallel agents?|specialist agents?)\b/i;
  const reportedSubagentTarget =
    /\b(i['’]?ll|i will|we['’]?ll|we will|it|the model|the assistant)\b.{0,80}\b(use|using|used|run|ran|spawn|spawned|deploy|deployed|fan\s*out)\b.{0,80}\b(subagents?|multi[-\s]?agent|parallel agents?|specialist agents?)\b/i;
  const commandedSubagentTarget =
    /\b(use|run|spawn|deploy|launch|parallelize|parallelise|split|delegate|ask|bring in)\b.{0,80}\b(subagents?|multi[-\s]?agent|parallel agents?|specialist agents?)\b/i;

  if (negatedSubagentTarget.test(message)) return false;
  if (diagnosticSubagentTarget.test(message) || reportedSubagentTarget.test(message)) return false;

  return commandedSubagentTarget.test(message) || /\bfan\s*out\b/i.test(message);
}

function isCasualMessage(message: string): boolean {
  return /^(hi|hey|hello|yo|sup|thanks|thank you|ok|okay|cool|nice)[!.?\s]*$/i.test(message.trim());
}

function wantsDeepThinking(message: string): boolean {
  return /\b(think|plan|reason|step(?:\s|-)?by(?:\s|-)?step|deep|harder|approach|strategy|trade-?offs?|debug|review)\b/i.test(
    message
  );
}

function wantsToolInventory(message: string): boolean {
  return /\b(what|which|list|show|available|enabled)\b.{0,80}\b(tools?|capabilities)\b|\btools?\b.{0,80}\b(available|enabled|do you have|can you use|access)\b/i.test(
    message
  );
}

function wantsToolInventoryFollowUp(
  message: string,
  context: { recentMessages?: { content?: unknown; role?: unknown }[] }
): boolean {
  if (
    !/^(that'?s it|thats it|is that all|only that|no other tools?|anything else)\s*\??$/i.test(
      message.trim()
    )
  ) {
    return false;
  }

  const recentText = (context.recentMessages ?? [])
    .slice(-4)
    .map((item) => (typeof item.content === 'string' ? item.content : ''))
    .join('\n');

  return /\b(tools?|capabilities|selfCritique|diagramRead|errorChecker)\b/i.test(recentText);
}

function wantsSelfCritique(message: string): boolean {
  return /\b(self[-\s]?critique|critique|review|audit|evaluate|assess|improve|quality check|quality review)\b/i.test(
    message
  );
}

function wantsDiagramDeletion(message: string): boolean {
  return /\b(delete|clear|remove|wipe|empty)\b.{0,80}\b(diagram|canvas|mermaid|all|everything)\b/i.test(
    message
  );
}

function wantsVisualStyling(message: string): boolean {
  return /\b(style|theme|color|colour|palette|visual|make it look|beautify|polish|auto[-\s]?style)\b/i.test(
    message
  );
}

function wantsIcons(message: string): boolean {
  return /\b(icon|icons|logo|logos|badge|badges)\b/i.test(message);
}

function wantsRepoPlanning(message: string): boolean {
  return /\b(modify|edit|write|patch|change|refactor|commit|repo|repository|codebase|file|docs?)\b/i.test(
    message
  );
}

function wantsNewDiagram(message: string): boolean {
  return (
    /\b(create|generate|build|draft|new|from scratch)\b/i.test(message) &&
    /\b(diagram|mermaid|flowchart|sequence|architecture|system design)\b/i.test(message)
  );
}

function wantsFullDiagramRewrite(message: string): boolean {
  return /\b(rewrite|redraw|replace whole|replace entire|start over|from scratch)\b/i.test(message);
}

function wantsDiagramRepair(message: string): boolean {
  return /\b(fix|repair|error|syntax|render|invalid|broken|mermaid)\b/i.test(message);
}

function wantsDocumentation(message: string): boolean {
  return /\b(markdown|document|documentation|docs?|summary|notes?|write[-\s]?up)\b/i.test(message);
}

function wantsCodeArtifact(message: string, activeEngine?: string): boolean {
  return (
    activeEngine === 'json' ||
    activeEngine === 'yaml' ||
    activeEngine === 'markdown' ||
    /\b(json|yaml|yml|code|typescript|javascript|svelte|html|css|config|artifact)\b/i.test(message)
  );
}

function wantsDataWork(message: string): boolean {
  return /\b(csv|xlsx|spreadsheet|table|rows?|columns?|data|analy[sz]e|chart|stats?)\b/i.test(
    message
  );
}

function wantsFileWork(message: string): boolean {
  return /\b(file|upload|attachment|pdf|read|search)\b/i.test(message);
}

function wantsWebSearch(message: string): boolean {
  return /\b(web|search|lookup|internet|latest|docs?|documentation|source)\b/i.test(message);
}

function wantsMemoryWork(message: string): boolean {
  return /\b(remember|memory|memories|forget|recall|preference)\b/i.test(message);
}

function addAll(target: Set<string>, tools: string[]) {
  for (const tool of tools) target.add(tool);
}

const REQUESTABLE_TOOL_NAMES = [
  'actionItemExtractor',
  'askQuestions',
  'autoStyler',
  'codePatch',
  'codeRead',
  'codeWrite',
  'dataAnalyzer',
  'diagramDelete',
  'diagramPatch',
  'diagramRead',
  'diagramWrite',
  'errorChecker',
  'fileManager',
  'gitGuard',
  'iconSearch',
  'iconifier',
  'longTermMemory',
  'markdownRead',
  'markdownWrite',
  'planWithProgress',
  'planner',
  'selfCritique',
  'sequentialThinking',
  'styleSearch',
  'subagentAssemble',
  'subagentFanout',
  'tableAnalytics',
  'thinking',
  'webSearch'
];

function normalizeToolMention(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function selectExplicitlyNamedTools(message: string): string[] {
  const normalizedMessage = normalizeToolMention(message);
  return REQUESTABLE_TOOL_NAMES.filter((toolName) =>
    normalizedMessage.includes(normalizeToolMention(toolName))
  );
}

export function selectToolNamesForRequest(
  message: string,
  context: {
    activeEngine?: string;
    continuingAfterFanout?: boolean;
    recentMessages?: { content?: unknown; role?: unknown }[];
  } = {}
): Set<string> {
  const selected = new Set<string>();
  const activeEngine = context.activeEngine ?? 'mermaid';

  if (isCasualMessage(message)) return selected;

  if (wantsToolInventory(message) || wantsToolInventoryFollowUp(message, context)) {
    addAll(selected, REQUESTABLE_TOOL_NAMES);
    return selected;
  }

  const explicitlyNamedTools = selectExplicitlyNamedTools(message);
  addAll(selected, explicitlyNamedTools);

  if (wantsSubagents(message)) {
    addAll(selected, ['subagentFanout', 'subagentAssemble']);
  }

  if (wantsMemoryWork(message)) addAll(selected, ['longTermMemory']);
  if (wantsWebSearch(message)) addAll(selected, ['webSearch']);
  if (wantsFileWork(message)) addAll(selected, ['fileManager']);
  if (wantsDataWork(message)) addAll(selected, ['fileManager', 'dataAnalyzer', 'tableAnalytics']);

  if (wantsRepoPlanning(message)) addAll(selected, ['gitGuard']);

  if (wantsSelfCritique(message)) {
    addAll(selected, ['selfCritique']);
    if (activeEngine === 'mermaid') {
      addAll(selected, [
        'diagramRead',
        'diagramPatch',
        'errorChecker',
        'styleSearch',
        'iconSearch'
      ]);
    } else if (activeEngine === 'markdown') {
      addAll(selected, ['markdownRead', 'markdownWrite']);
    } else {
      addAll(selected, ['codeRead', 'codeWrite', 'codePatch']);
    }
  }

  if (wantsDocumentation(message) && !wantsDiagramRepair(message)) {
    addAll(selected, ['markdownRead', 'markdownWrite', 'fileManager', 'actionItemExtractor']);
  }

  if (wantsCodeArtifact(message, activeEngine) && activeEngine !== 'mermaid') {
    addAll(selected, ['codeRead', 'codeWrite', 'codePatch']);
  }

  if (activeEngine === 'mermaid') {
    const shouldWriteFullDiagram = wantsNewDiagram(message) || wantsFullDiagramRewrite(message);

    addAll(selected, ['diagramRead', 'diagramPatch', 'errorChecker', 'styleSearch', 'iconSearch']);
    if (wantsDiagramDeletion(message)) selected.add('diagramDelete');
    if (wantsVisualStyling(message)) selected.add('autoStyler');
    if (wantsIcons(message)) selected.add('iconifier');
    if (shouldWriteFullDiagram) {
      selected.add('diagramWrite');
    }

    if (
      shouldWriteFullDiagram &&
      /\b(create|generate|architecture|system design|diagram)\b/i.test(message)
    ) {
      selected.add('askQuestions');
    }
  }

  if (wantsDeepThinking(message) && !wantsDiagramRepair(message)) {
    addAll(selected, ['thinking', 'planner']);
  }

  return selected;
}
