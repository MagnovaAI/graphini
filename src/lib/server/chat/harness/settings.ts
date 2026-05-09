import { getDb } from '$lib/server/db';

const TOOLS_CONFIG_CATEGORY = 'tools';
const TOOLS_CONFIG_KEY = 'graphini_tools_config_v1';

/**
 * Extract the set of tools the user has explicitly disabled.
 *
 * Why a denylist, not an allowlist: persisted configs are a sparse override
 * on top of the client's DEFAULT_TOOLS list. A tool missing from the saved
 * config means "no opinion — use default" (which is enabled for every tool
 * we ship). If we treated missing keys as disabled, every tool added after
 * the user last opened the settings panel — for example, the consolidated
 * `fileSystem` tool — would be silently filtered out, and the model would
 * report "tool not available" for tools the user never disabled.
 */
function disabledToolsFromConfig(config: unknown): Set<string> | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const disabled = Object.entries(config as Record<string, unknown>)
    .filter(([, value]) => value === false)
    .map(([toolName]) => toolName);
  return new Set(disabled);
}

export async function getPersistedDisabledTools(userId: string): Promise<Set<string> | null> {
  try {
    const db = getDb();
    const config = await db.kvGet(userId, TOOLS_CONFIG_CATEGORY, TOOLS_CONFIG_KEY);
    return disabledToolsFromConfig(config);
  } catch (toolConfigError) {
    console.warn('[chat] Failed to load persisted tool config:', toolConfigError);
    return null;
  }
}
