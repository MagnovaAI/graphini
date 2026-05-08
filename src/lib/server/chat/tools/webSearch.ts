import { tool } from 'ai';
import { z } from 'zod';
import { getBraveSearchKeyFor } from '$lib/server/chat/search';
import type { ToolContext } from './context';

interface BraveResult {
  title: string;
  description?: string;
  url: string;
  source?: string;
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
}

export function createWebSearchTool({ userId }: ToolContext) {
  return tool({
    description:
      'Search the web with Brave Search. Returns titles, snippets, and URLs. Requires the user to have set their Brave Search API key in Settings — if no key is configured, this returns success:false with a "missing_brave_key" error and you should ask the user to add one rather than retrying.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
      reason: z
        .string()
        .optional()
        .describe('Brief reason why you are searching — shown to the user')
    }),
    execute: async ({ query, reason }) => {
      const apiKey = await getBraveSearchKeyFor(userId ?? null);
      if (!apiKey) {
        return {
          success: false,
          error: 'missing_brave_key',
          query,
          reason,
          message:
            'No Brave Search API key configured for this user. Ask the user to add one in Settings → API Keys (free tier at https://brave.com/search/api/). Do not retry web search until they have.'
        };
      }

      try {
        const url = new URL('https://api.search.brave.com/res/v1/web/search');
        url.searchParams.set('q', query);
        url.searchParams.set('count', '5');
        url.searchParams.set('safesearch', 'moderate');
        url.searchParams.set('text_decorations', 'false');

        const res = await fetch(url, {
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': apiKey
          },
          signal: AbortSignal.timeout(8000)
        });

        if (res.status === 401 || res.status === 403) {
          return {
            success: false,
            error: 'invalid_brave_key',
            query,
            reason,
            message:
              'Brave rejected the configured API key. Ask the user to update it in Settings → API Keys.'
          };
        }
        if (res.status === 429) {
          return {
            success: false,
            error: 'brave_rate_limited',
            query,
            reason,
            message:
              'Brave Search rate limit reached for the user\'s key. Try again in a moment, or ask the user to upgrade their Brave plan.'
          };
        }
        if (!res.ok) {
          return {
            success: false,
            error: 'brave_request_failed',
            status: res.status,
            query,
            reason
          };
        }

        const data = (await res.json()) as BraveResponse;
        const results = (data.web?.results ?? []).slice(0, 5).map((r) => ({
          title: r.title,
          snippet: r.description ?? '',
          url: r.url,
          source: r.source ?? (r.url ? new URL(r.url).hostname.replace(/^www\./, '') : undefined)
        }));

        return {
          success: true,
          query,
          reason: reason || `Searching for "${query}"`,
          resultCount: results.length,
          results,
          summary:
            results.length > 0
              ? `Found ${results.length} result(s) for "${query}"`
              : `No results found for "${query}". Try rephrasing.`
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'brave_search_failed',
          query,
          reason
        };
      }
    }
  });
}
