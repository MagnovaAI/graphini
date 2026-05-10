/**
 * Tools Store (Svelte 5 runes)
 * Manages tool configuration for AI chat.
 */
import { kv } from '$lib/client/stores/kvStore.svelte';
import { hmrRestore, hmrPreserve } from '$lib/client/util/hmr';

export interface ToolConfig {
  id: string;
  label: string;
  description: string;
  category:
    | 'diagram'
    | 'style'
    | 'icons'
    | 'search'
    | 'interaction'
    | 'intelligence'
    | 'files'
    | 'code'
    | 'agents'
    | 'safety';
  enabled: boolean;
}

const DEFAULT_TOOLS: ToolConfig[] = [
  {
    category: 'icons',
    description:
      'Search local and Iconify web icons for diagram nodes; the model applies chosen icons with a workspace edit',
    enabled: true,
    id: 'iconSearch',
    label: 'Icon Tool'
  },
  {
    category: 'search',
    description: 'Search the web for information',
    enabled: true,
    id: 'webSearch',
    label: 'webSearch'
  },
  {
    category: 'interaction',
    description: 'Ask clarifying questions before creating diagrams',
    enabled: true,
    id: 'askQuestions',
    label: 'Question Tool'
  },
  {
    category: 'diagram',
    description: 'Validate diagram syntax and report errors',
    enabled: true,
    id: 'errorChecker',
    label: 'Error Checker'
  },
  {
    category: 'style',
    description: 'Search style palettes and edit suggestions before applying',
    enabled: true,
    id: 'styleSearch',
    label: 'Style Tool'
  },
  {
    category: 'style',
    description: 'Automatically improve diagram styling and visual consistency',
    enabled: true,
    id: 'autoStyler',
    label: 'autoStyler'
  },
  {
    category: 'intelligence',
    description: 'Show a concise public thinking checkpoint before complex tool use',
    enabled: true,
    id: 'thinking',
    label: 'thinking'
  },
  {
    category: 'intelligence',
    description: 'Load enabled user skills and apply their instructions during the turn',
    enabled: true,
    id: 'useSkill',
    label: 'useSkill'
  },
  {
    category: 'files',
    description:
      'Workspace files: list, read, create, edit, delete, moveFolder, deleteFolder. Uploads are saved here as Markdown files.',
    enabled: true,
    id: 'fileSystem',
    label: 'Files'
  },
  {
    category: 'files',
    description: 'Analyze workspace tables or CSV-like text: frequency, groupBy, filter, topN',
    enabled: true,
    id: 'dataAnalyzer',
    label: 'dataAnalyzer'
  }
];

const STORAGE_KEY = 'graphini_tools_config_v1';

function cloneDefaultTools(): ToolConfig[] {
  return DEFAULT_TOOLS.map((tool) => ({ ...tool }));
}

function applySavedToolsConfig(saved: Record<string, boolean> | null): ToolConfig[] {
  if (!saved) return cloneDefaultTools();
  return DEFAULT_TOOLS.map((t) => ({
    ...t,
    enabled: saved[t.id] !== undefined ? saved[t.id] : t.enabled
  }));
}

function readSavedToolsConfig(): Record<string, boolean> | null {
  if (typeof window === 'undefined') return null;
  try {
    return kv.get<Record<string, boolean>>('tools', STORAGE_KEY);
  } catch {
    return null;
  }
}

function loadToolsConfig(): ToolConfig[] {
  if (typeof window === 'undefined') return cloneDefaultTools();
  return applySavedToolsConfig(readSavedToolsConfig());
}

function syncToolsConfigFromKv() {
  const saved = readSavedToolsConfig();
  tools = DEFAULT_TOOLS.map((t) => {
    const current = tools.find((tool) => tool.id === t.id);
    return {
      ...t,
      enabled: saved?.[t.id] !== undefined ? saved[t.id] : (current?.enabled ?? t.enabled)
    };
  });
}

function saveToolsConfig(tools: ToolConfig[]) {
  if (typeof window === 'undefined') return;
  try {
    const toSave: Record<string, boolean> = {};
    for (const t of tools) {
      toSave[t.id] = t.enabled;
    }
    kv.set('tools', STORAGE_KEY, toSave);
  } catch {
    /* silent */
  }
}

// ── State ──

let tools = $state<ToolConfig[]>(hmrRestore('toolsState') ?? loadToolsConfig());
hmrPreserve('toolsState', () => tools);

// ── Exported store ──

export const toolsStore = {
  disableAll() {
    tools = tools.map((t) => ({ ...t, enabled: false }));
    saveToolsConfig(tools);
  },

  enableAll() {
    tools = tools.map((t) => ({ ...t, enabled: true }));
    saveToolsConfig(tools);
  },

  getEnabledToolIds(): string[] {
    syncToolsConfigFromKv();
    const enabled: string[] = [];
    for (const tool of tools) {
      if (!tool.enabled) continue;
      enabled.push(tool.id);
    }
    return enabled;
  },

  replace(nextTools: ToolConfig[]) {
    const enabledById = Object.fromEntries(nextTools.map((tool) => [tool.id, tool.enabled]));
    tools = DEFAULT_TOOLS.map((tool) => ({
      ...tool,
      enabled: tool.id in enabledById ? Boolean(enabledById[tool.id]) : tool.enabled
    }));
    saveToolsConfig(tools);
  },

  reset() {
    tools = cloneDefaultTools();
    saveToolsConfig(tools);
  },

  setEnabled(toolId: string, enabled: boolean) {
    tools = tools.map((t) => (t.id === toolId ? { ...t, enabled } : t));
    saveToolsConfig(tools);
  },

  syncFromKv() {
    syncToolsConfigFromKv();
  },

  toggle(toolId: string) {
    tools = tools.map((t) => (t.id === toolId ? { ...t, enabled: !t.enabled } : t));
    saveToolsConfig(tools);
  },

  get value() {
    return tools;
  }
};

export const TOOL_CATEGORIES: { id: string; label: string }[] = [
  { id: 'diagram', label: 'Diagram' },
  { id: 'style', label: 'Style' },
  { id: 'icons', label: 'Icons' },
  { id: 'search', label: 'Search' },
  { id: 'interaction', label: 'Interaction' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'files', label: 'Files & Data' },
  { id: 'code', label: 'Code' },
  { id: 'agents', label: 'Agents' },
  { id: 'safety', label: 'Safety' }
];
