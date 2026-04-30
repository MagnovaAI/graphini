/* eslint-disable @typescript-eslint/no-unused-vars */
import { deleteFile, getFileById, getSessionFiles } from '$lib/server/file-store';
import {
  codeStore,
  diagramStore,
  markdownStore,
  memoryStore,
  planStore,
  subagentStore
} from '$lib/server/chat/state';
import {
  buildDiagramReview,
  findMermaidDeclarations,
  parseMermaidNodes,
  validateSingleMermaidDocument
} from '$lib/server/chat/mermaid';
import { detectCodeLanguage, validateCodeArtifact } from '$lib/server/chat/code-artifacts';
import { openrouterFastChat } from '$lib/server/chat/model';
import { instructionsForSubagent } from '$lib/server/chat/subagents';
import { generateText, tool } from 'ai';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { resolveIconForNode } from './icon-resolver';

const execFileAsync = promisify(execFile);

interface ToolContext {
  modelId?: string;
  sessionId: string;
}

export function createLongTermMemoryTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description: `Store and retrieve long-term memories about the user's preferences, past work, and context. Memories persist across sessions.

OPERATIONS:
- "save" — Save a new memory with a key and value. Overwrites if key exists.
- "get" — Retrieve a specific memory by key.
- "list" — List all saved memory keys.
- "delete" — Delete a specific memory.
- "search" — Search memories by keyword in keys and values.

WHEN TO USE:
- When the user says "remember that..." or "keep in mind..."
- When you notice recurring preferences (preferred diagram style, colors, naming conventions)
- When the user asks "do you remember..." or "what did I say about..."
- To store project context that should persist across conversations`,
    inputSchema: z.object({
      operation: z.enum(['save', 'get', 'list', 'delete', 'search']).describe('Memory operation'),
      key: z.string().optional().describe('Memory key (required for save, get, delete)'),
      value: z.string().optional().describe('Memory value (required for save)'),
      query: z.string().optional().describe('Search query (required for search)')
    }),
    execute: async ({ operation, key, value, query }) => {
      const memoryKey = `memory_${sessionId}`;
      const stored = memoryStore.get(memoryKey) || '{}';
      let memories: Record<string, { value: string; savedAt: string }> = {};
      try {
        memories = JSON.parse(stored);
      } catch {
        /* ignore */
      }

      switch (operation) {
        case 'save': {
          if (!key || !value) return { success: false, error: 'key and value required for save' };
          memories[key] = { value, savedAt: new Date().toISOString() };
          memoryStore.set(memoryKey, JSON.stringify(memories));
          return {
            success: true,
            message: `Remembered: "${key}"`,
            totalMemories: Object.keys(memories).length
          };
        }
        case 'get': {
          if (!key) return { success: false, error: 'key required for get' };
          const mem = memories[key];
          if (!mem) return { success: false, error: `No memory found for key: "${key}"` };
          return { success: true, key, value: mem.value, savedAt: mem.savedAt };
        }
        case 'list': {
          const keys = Object.keys(memories);
          return {
            success: true,
            totalMemories: keys.length,
            memories: keys.map((k) => ({
              key: k,
              preview: memories[k].value.slice(0, 80),
              savedAt: memories[k].savedAt
            }))
          };
        }
        case 'delete': {
          if (!key) return { success: false, error: 'key required for delete' };
          if (!memories[key]) return { success: false, error: `No memory found for key: "${key}"` };
          memories = Object.fromEntries(Object.entries(memories).filter(([k]) => k !== key));
          memoryStore.set(memoryKey, JSON.stringify(memories));
          return {
            success: true,
            message: `Forgot: "${key}"`,
            totalMemories: Object.keys(memories).length
          };
        }
        case 'search': {
          if (!query) return { success: false, error: 'query required for search' };
          const q = query.toLowerCase();
          const results = Object.entries(memories)
            .filter(([k, v]) => k.toLowerCase().includes(q) || v.value.toLowerCase().includes(q))
            .map(([k, v]) => ({ key: k, value: v.value, savedAt: v.savedAt }));
          return { success: true, query, resultCount: results.length, results };
        }
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    }
  });
}
