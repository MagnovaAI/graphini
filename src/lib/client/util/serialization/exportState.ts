/**
 * Export all application state as a JSON file.
 * Includes: UI states, settings, chats, markdown documentation, and mermaid code.
 */
import { aiSettings, toolsStore } from '$lib/client/stores';
import { documentMarkdownStore } from '$lib/client/stores/documentStore.svelte';
import { kv } from '$lib/client/stores/kvStore.svelte';
import { panels } from '$lib/client/stores/panels.svelte';
import { get } from 'svelte/store';
import { inputStateStore } from '../state/state';

export interface AppStateExport {
  exportedAt: string;
  version: string;
  mermaidCode: string;
  mermaidConfig: string;
  markdown: string;
  panels: {
    config: any;
    order: any;
  };
  aiSettings: any;
  tools: any;
  chatMessages: any[];
  kvData: { category: string; key: string; value: unknown }[];
}

export function exportAppState(): AppStateExport {
  const state = get(inputStateStore);
  const markdown = documentMarkdownStore.value;
  const panelConfig = panels.panels;
  const panelOrder = panels.order;
  const aiSettingsValue = aiSettings.value;
  const tools = toolsStore.value;

  // Collect chat data from KV store
  const chatData = kv.getCategory('chat');
  const chatMessages = Object.entries(chatData).map(([key, value]) => ({ key, value }));

  // Collect all KV data
  const kvData = kv.getAll();

  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    mermaidCode: state.code || '',
    mermaidConfig: state.mermaid || '',
    markdown: markdown || '',
    panels: {
      config: panelConfig,
      order: panelOrder
    },
    aiSettings: aiSettingsValue,
    tools,
    chatMessages,
    kvData
  };
}

export function downloadAppState() {
  const data = exportAppState();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `graphini-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
