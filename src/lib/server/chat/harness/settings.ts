import { getDb } from '$lib/server/db';

const TOOLS_CONFIG_CATEGORY = 'tools';
const TOOLS_CONFIG_KEY = 'graphini_tools_config_v1';

function enabledToolsFromConfig(config: unknown): Set<string> | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const enabled = Object.entries(config as Record<string, unknown>)
    .filter(([, value]) => value === true)
    .map(([toolName]) => toolName);
  return enabled.length > 0 ? new Set(enabled) : null;
}

export async function getPersistedEnabledTools(userId: string): Promise<Set<string> | null> {
  try {
    const db = getDb();
    const config = await db.kvGet(userId, TOOLS_CONFIG_CATEGORY, TOOLS_CONFIG_KEY);
    return enabledToolsFromConfig(config);
  } catch (toolConfigError) {
    console.warn('[chat] Failed to load persisted tool config:', toolConfigError);
    return null;
  }
}
