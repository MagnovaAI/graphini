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
    category: 'diagram',
    description: 'Read current diagram content from the editor',
    enabled: true,
    id: 'diagramRead',
    label: 'diagramRead'
  },
  {
    category: 'diagram',
    description: 'Write or replace the entire diagram',
    enabled: true,
    id: 'diagramWrite',
    label: 'diagramWrite'
  },
  {
    category: 'diagram',
    description: 'Apply surgical edits to specific lines',
    enabled: true,
    id: 'diagramPatch',
    label: 'diagramPatch'
  },
  {
    category: 'diagram',
    description: 'Clear the entire diagram',
    enabled: true,
    id: 'diagramDelete',
    label: 'diagramDelete'
  },
  {
    category: 'icons',
    description: 'Search icon candidates for diagram nodes before patching',
    enabled: true,
    id: 'iconSearch',
    label: 'Icon Tool'
  },
  {
    category: 'icons',
    description: 'Attach resolved icons to diagram nodes after a diagram exists',
    enabled: true,
    id: 'iconifier',
    label: 'iconifier'
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
    description: 'Read content from the markdown editor',
    enabled: true,
    id: 'markdownRead',
    label: 'markdownRead'
  },
  {
    category: 'diagram',
    description: 'Write content to the markdown editor',
    enabled: true,
    id: 'markdownWrite',
    label: 'markdownWrite'
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
    description: 'Search style palettes and patch suggestions before applying',
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
    category: 'files',
    description: 'List, read, search, and manage uploaded files and attachments',
    enabled: true,
    id: 'fileManager',
    label: 'fileManager'
  },
  {
    category: 'files',
    description: 'Analyze CSV/Excel data: frequency, groupBy, filter, topN, correlations',
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
  if (!saved) return;
  tools = DEFAULT_TOOLS.map((t) => {
    const current = tools.find((tool) => tool.id === t.id);
    return {
      ...t,
      enabled: saved[t.id] !== undefined ? saved[t.id] : (current?.enabled ?? t.enabled)
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
    return tools.filter((t) => t.enabled).map((t) => t.id);
  },

  syncFromKv() {
    syncToolsConfigFromKv();
  },

  reset() {
    tools = cloneDefaultTools();
    saveToolsConfig(tools);
  },

  setEnabled(toolId: string, enabled: boolean) {
    tools = tools.map((t) => (t.id === toolId ? { ...t, enabled } : t));
    saveToolsConfig(tools);
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
