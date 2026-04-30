/**
 * Tools Store (Svelte 5 runes)
 * Manages tool configuration for AI chat.
 */
import { kv } from '$lib/stores/kvStore.svelte';
import { hmrRestore, hmrPreserve } from '$lib/util/hmr';

export interface ToolConfig {
  id: string;
  label: string;
  description: string;
  category:
    | 'diagram'
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
    label: 'Diagram Read'
  },
  {
    category: 'diagram',
    description: 'Write or replace the entire diagram',
    enabled: true,
    id: 'diagramWrite',
    label: 'Diagram Write'
  },
  {
    category: 'diagram',
    description: 'Apply surgical edits to specific lines',
    enabled: true,
    id: 'diagramPatch',
    label: 'Diagram Patch'
  },
  {
    category: 'diagram',
    description: 'Clear the entire diagram',
    enabled: true,
    id: 'diagramDelete',
    label: 'Diagram Delete'
  },
  {
    category: 'icons',
    description: 'Add or remove icons on diagram nodes',
    enabled: true,
    id: 'iconifier',
    label: 'Iconifier'
  },
  {
    category: 'search',
    description: 'Search the web for information',
    enabled: true,
    id: 'webSearch',
    label: 'Web Search'
  },
  {
    category: 'interaction',
    description: 'Ask clarifying questions before creating diagrams',
    enabled: true,
    id: 'askQuestions',
    label: 'Ask Questions'
  },
  {
    category: 'diagram',
    description: 'Read content from the markdown editor',
    enabled: true,
    id: 'markdownRead',
    label: 'Markdown Read'
  },
  {
    category: 'diagram',
    description: 'Write content to the markdown editor',
    enabled: true,
    id: 'markdownWrite',
    label: 'Markdown Write'
  },
  {
    category: 'diagram',
    description: 'Validate diagram syntax and report errors',
    enabled: true,
    id: 'errorChecker',
    label: 'Error Checker'
  },
  {
    category: 'diagram',
    description: 'Automatically style nodes and subgraphs with harmonious colors',
    enabled: true,
    id: 'autoStyler',
    label: 'Auto Styler'
  },
  {
    category: 'code',
    description: 'Read generated JSON, YAML, config, or code artifacts',
    enabled: true,
    id: 'codeRead',
    label: 'Code Read'
  },
  {
    category: 'code',
    description: 'Write generated JSON, YAML, config, or code artifacts',
    enabled: true,
    id: 'codeWrite',
    label: 'Code Write'
  },
  {
    category: 'code',
    description: 'Patch generated code artifacts by line range',
    enabled: true,
    id: 'codePatch',
    label: 'Code Patch'
  },
  {
    category: 'intelligence',
    description: 'Decompose complex tasks into step-by-step plans',
    enabled: true,
    id: 'planner',
    label: 'Planner'
  },
  {
    category: 'intelligence',
    description: 'Think through complex tasks step-by-step before acting',
    enabled: true,
    id: 'sequentialThinking',
    label: 'Sequential Thinking'
  },
  {
    category: 'agents',
    description: 'Plan bounded specialist agents for complex work',
    enabled: true,
    id: 'subagentFanout',
    label: 'Subagent Fanout'
  },
  {
    category: 'agents',
    description: 'Assemble specialist agent outputs into one plan',
    enabled: true,
    id: 'subagentAssemble',
    label: 'Subagent Assemble'
  },
  {
    category: 'safety',
    description: 'Check git status and protected paths before repository work',
    enabled: true,
    id: 'gitGuard',
    label: 'Git Guard'
  },
  {
    category: 'intelligence',
    description: 'Create and update visible checklist plans',
    enabled: true,
    id: 'planWithProgress',
    label: 'Plan Progress'
  },
  {
    category: 'intelligence',
    description: 'Store and retrieve user or project memories',
    enabled: true,
    id: 'longTermMemory',
    label: 'Long-term Memory'
  },
  {
    category: 'intelligence',
    description: 'Extract action items, risks, KPIs, and entities from documents',
    enabled: true,
    id: 'actionItemExtractor',
    label: 'Action Items'
  },
  {
    category: 'intelligence',
    description: 'Analyze CSV/tabular data with statistics and chart suggestions',
    enabled: true,
    id: 'tableAnalytics',
    label: 'Table Analytics'
  },
  {
    category: 'intelligence',
    description: 'Evaluate and improve diagrams/documents for quality',
    enabled: true,
    id: 'selfCritique',
    label: 'Self Critique'
  },
  {
    category: 'files',
    description: 'List, read, search, and manage uploaded files and attachments',
    enabled: true,
    id: 'fileManager',
    label: 'File Manager'
  },
  {
    category: 'files',
    description: 'Analyze CSV/Excel data: frequency, groupBy, filter, topN, correlations',
    enabled: true,
    id: 'dataAnalyzer',
    label: 'Data Analyzer'
  }
];

const STORAGE_KEY = 'graphini_tools_config_v1';

function loadToolsConfig(): ToolConfig[] {
  if (typeof window === 'undefined') return [...DEFAULT_TOOLS];
  try {
    const saved = kv.get<Record<string, boolean>>('tools', STORAGE_KEY);
    if (!saved) return [...DEFAULT_TOOLS];
    return DEFAULT_TOOLS.map((t) => ({
      ...t,
      enabled: saved[t.id] !== undefined ? saved[t.id] : t.enabled
    }));
  } catch {
    return [...DEFAULT_TOOLS];
  }
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
    return tools.filter((t) => t.enabled).map((t) => t.id);
  },

  reset() {
    tools = [...DEFAULT_TOOLS];
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
  { id: 'icons', label: 'Icons' },
  { id: 'search', label: 'Search' },
  { id: 'interaction', label: 'Interaction' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'files', label: 'Files & Data' },
  { id: 'code', label: 'Code' },
  { id: 'agents', label: 'Agents' },
  { id: 'safety', label: 'Safety' }
];
