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

  return /\b(tools?|capabilities|diagramRead|errorChecker)\b/i.test(recentText);
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

function addAll(target: Set<string>, tools: string[]) {
  for (const tool of tools) target.add(tool);
}

export const REQUESTABLE_TOOL_NAMES = [
  'askQuestions',
  'autoStyler',
  'dataAnalyzer',
  'diagramDelete',
  'diagramPatch',
  'diagramRead',
  'diagramWrite',
  'errorChecker',
  'fileManager',
  'iconSearch',
  'iconifier',
  'markdownRead',
  'markdownWrite',
  'styleSearch',
  'thinking',
  'webSearch'
];

export function isToolInventoryRequest(
  message: string,
  context: { recentMessages?: { content?: unknown; role?: unknown }[] } = {}
): boolean {
  return wantsToolInventory(message) || wantsToolInventoryFollowUp(message, context);
}

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
    workspaceIsEmpty?: boolean;
  } = {}
): Set<string> {
  const selected = new Set<string>();
  const activeEngine = context.activeEngine ?? 'mermaid';
  const workspaceIsEmpty = Boolean(context.workspaceIsEmpty);

  if (isCasualMessage(message)) return selected;

  if (isToolInventoryRequest(message, context)) {
    addAll(selected, REQUESTABLE_TOOL_NAMES);
    return selected;
  }

  const explicitlyNamedTools = selectExplicitlyNamedTools(message);
  addAll(selected, explicitlyNamedTools);

  // askQuestions is always available so the model can clarify intent on any turn.
  selected.add('askQuestions');

  if (wantsWebSearch(message)) addAll(selected, ['webSearch']);
  if (wantsFileWork(message)) addAll(selected, ['fileManager']);
  if (wantsDataWork(message)) addAll(selected, ['fileManager', 'dataAnalyzer']);

  if (wantsDocumentation(message) && !wantsDiagramRepair(message)) {
    addAll(selected, ['markdownRead', 'markdownWrite', 'fileManager']);
  }

  if (activeEngine === 'mermaid') {
    const shouldWriteFullDiagram = wantsNewDiagram(message) || wantsFullDiagramRewrite(message);

    addAll(selected, ['diagramRead', 'diagramPatch', 'errorChecker', 'styleSearch', 'iconSearch']);
    if (wantsDiagramDeletion(message)) selected.add('diagramDelete');
    if (wantsVisualStyling(message)) selected.add('autoStyler');
    if (wantsIcons(message)) selected.add('iconifier');
    // On a fresh/empty mermaid workspace there is nothing to patch — the user
    // is starting from zero, so diagramWrite must always be on the table.
    if (shouldWriteFullDiagram || workspaceIsEmpty) {
      selected.add('diagramWrite');
    }
  }

  if (wantsDeepThinking(message) && !wantsDiagramRepair(message)) {
    selected.add('thinking');
  }

  return selected;
}
