/**
 * Tool exposure for chat turns.
 *
 * Earlier versions of this file tried to keyword-gate the tool catalog by
 * matching the user's message against regex patterns ("wantsIcons",
 * "wantsNewDiagram", etc.). That approach silently locked the model out of
 * tools whenever phrasing didn't match — e.g. "make the diagram 30 nodes
 * bigger" never reached `diagramWrite` because no regex caught the verb.
 *
 * The model is the better classifier. Expose every tool, and let the user's
 * settings panel be the only source of truth for opt-outs.
 */

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

/**
 * The model is asking for an inventory of available tools. Used by the harness
 * to override per-user disables for that one turn so the model can describe
 * its full capability surface.
 */
export function isToolInventoryRequest(
  message: string,
  context: { recentMessages?: { content?: unknown; role?: unknown }[] } = {}
): boolean {
  return wantsToolInventory(message) || wantsToolInventoryFollowUp(message, context);
}
