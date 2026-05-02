/**
 * Public App Settings API
 * Allows reading non-sensitive app settings without admin auth.
 * Only exposes specific whitelisted categories/keys.
 */

import { settingsManager } from '$lib/server/state-manager';
import { json, type RequestHandler } from '@sveltejs/kit';

// Whitelisted public settings that any user can read
const PUBLIC_SETTINGS: Record<string, string[]> = {
  prompt_enhancer: ['model'],
  voice: ['model']
};

export const GET: RequestHandler = async ({ url }) => {
  const category = url.searchParams.get('category');
  const key = url.searchParams.get('key');

  if (!category || !PUBLIC_SETTINGS[category]) {
    return json({ success: false, error: 'Invalid category' }, { status: 400 });
  }

  try {
    const allSettings = await settingsManager.getAll(null, category);
    const filtered = allSettings.filter((s: any) => {
      if (key) return s.key === key && PUBLIC_SETTINGS[category].includes(s.key);
      return PUBLIC_SETTINGS[category].includes(s.key);
    });

    const result: Record<string, unknown> = {};
    for (const s of filtered) {
      result[s.key] = s.value;
    }

    return json({ success: true, data: result });
  } catch (err) {
    return json({ success: true, data: {} });
  }
};
