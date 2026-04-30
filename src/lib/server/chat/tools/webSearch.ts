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

export function createWebSearchTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Search the web for information. Use this to look up documentation, find icon names, research diagram patterns, or answer questions that need current information. Returns structured results with sources.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
      reason: z
        .string()
        .optional()
        .describe('Brief reason why you are searching — shown to the user')
    }),
    execute: async ({ query, reason }) => {
      try {
        const encoded = encodeURIComponent(query);
        const res = await fetch(
          `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (!res.ok) return { success: false, query, reason, error: 'Search request failed' };
        const data = await res.json();

        const results: { title: string; snippet: string; url?: string; source?: string }[] = [];

        if (data.AbstractText) {
          results.push({
            title: data.Heading || query,
            snippet: data.AbstractText,
            url: data.AbstractURL,
            source: data.AbstractSource || 'Wikipedia'
          });
        }
        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics.slice(0, 5)) {
            if (topic.Text) {
              const urlHost = topic.FirstURL
                ? new URL(topic.FirstURL).hostname.replace('www.', '')
                : undefined;
              results.push({
                title: topic.Text.slice(0, 80),
                snippet: topic.Text,
                url: topic.FirstURL,
                source: urlHost
              });
            }
          }
        }
        if (results.length === 0 && data.Answer) {
          results.push({
            title: 'Answer',
            snippet: data.Answer,
            source: data.AnswerType || 'DuckDuckGo'
          });
        }

        return {
          query,
          reason: reason || `Searching for "${query}"`,
          resultCount: results.length,
          results: results.slice(0, 5),
          success: true,
          summary:
            results.length > 0
              ? `Found ${results.length} result(s) for "${query}"`
              : `No results found for "${query}". Try rephrasing.`
        };
      } catch (e: unknown) {
        return {
          success: false,
          query,
          reason,
          error: e instanceof Error ? e.message : 'Search failed'
        };
      }
    }
  });
}
