/**
 * Tool exposure for chat turns.
 *
 * Every tool is exposed to the model on every turn. The user's settings panel
 * is the only source of truth for opt-outs; an earlier keyword-based gate was
 * removed because it silently locked the model out of tools when phrasing
 * didn't match a regex.
 */

export const REQUESTABLE_TOOL_NAMES = [
  'askQuestions',
  'autoStyler',
  'dataAnalyzer',
  'errorChecker',
  'fileSystem',
  'iconSearch',
  'styleSearch',
  'thinking',
  'useSkill',
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

  return /\b(tools?|capabilities|fileSystem|errorChecker)\b/i.test(recentText);
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
