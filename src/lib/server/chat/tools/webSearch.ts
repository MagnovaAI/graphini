import { tool } from 'ai';
import { z } from 'zod';
import { resolveSearchKeyFor, type SearchProvider } from '$lib/server/chat/search';
import type { ToolContext } from './context';

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  source?: string;
}

interface BraveResponse {
  web?: { results?: { title: string; description?: string; url: string; source?: string }[] };
}

interface TavilyResponse {
  results?: { title: string; content?: string; url: string }[];
}

async function searchWithBrave(
  query: string,
  apiKey: string
): Promise<{ ok: true; results: SearchResult[] } | { ok: false; status: number; reason: string }> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');
  url.searchParams.set('safesearch', 'moderate');
  url.searchParams.set('text_decorations', 'false');

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey
    },
    signal: AbortSignal.timeout(8000)
  });

  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, reason: 'invalid_key' };
  if (res.status === 429) return { ok: false, status: 429, reason: 'rate_limited' };
  if (!res.ok) return { ok: false, status: res.status, reason: 'request_failed' };

  const data = (await res.json()) as BraveResponse;
  const results = (data.web?.results ?? []).slice(0, 5).map<SearchResult>((r) => ({
    title: r.title,
    snippet: r.description ?? '',
    url: r.url,
    source: r.source ?? (r.url ? new URL(r.url).hostname.replace(/^www\./, '') : undefined)
  }));
  return { ok: true, results };
}

async function searchWithTavily(
  query: string,
  apiKey: string
): Promise<{ ok: true; results: SearchResult[] } | { ok: false; status: number; reason: string }> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 5,
      include_answer: false
    }),
    signal: AbortSignal.timeout(8000)
  });

  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, reason: 'invalid_key' };
  if (res.status === 429) return { ok: false, status: 429, reason: 'rate_limited' };
  if (!res.ok) return { ok: false, status: res.status, reason: 'request_failed' };

  const data = (await res.json()) as TavilyResponse;
  const results = (data.results ?? []).slice(0, 5).map<SearchResult>((r) => ({
    title: r.title,
    snippet: r.content ?? '',
    url: r.url,
    source: r.url ? new URL(r.url).hostname.replace(/^www\./, '') : undefined
  }));
  return { ok: true, results };
}

const labelByProvider: Record<SearchProvider, string> = {
  brave_search: 'Brave Search',
  tavily: 'Tavily'
};

export function createWebSearchTool({ userId }: ToolContext) {
  return tool({
    description:
      'Search the web. Uses the user\'s configured search provider (Tavily preferred when available, Brave Search otherwise). Returns titles, snippets, and URLs. If no provider key is configured, returns success:false with error:"missing_search_key" — in that case, ASK the user to add a Tavily or Brave key in Settings → API Keys instead of retrying.',
    inputSchema: z.object({
      query: z.string().describe('The search query'),
      reason: z
        .string()
        .optional()
        .describe('Brief reason why you are searching — shown to the user')
    }),
    execute: async ({ query, reason }) => {
      const resolved = await resolveSearchKeyFor(userId ?? null);
      if (!resolved) {
        return {
          success: false,
          error: 'missing_search_key',
          query,
          reason,
          message:
            'No web-search API key configured for this user. Ask the user to add a Tavily key (https://tavily.com, free tier 1000 queries/month) or a Brave Search key (https://brave.com/search/api/, free tier 2000 queries/month) in Settings → API Keys. Do not retry until they have.'
        };
      }

      try {
        const result =
          resolved.provider === 'tavily'
            ? await searchWithTavily(query, resolved.apiKey)
            : await searchWithBrave(query, resolved.apiKey);

        if (!result.ok) {
          if (result.reason === 'invalid_key') {
            return {
              success: false,
              error: 'invalid_search_key',
              provider: resolved.provider,
              query,
              reason,
              message: `${labelByProvider[resolved.provider]} rejected the configured key. Ask the user to update it in Settings → API Keys.`
            };
          }
          if (result.reason === 'rate_limited') {
            return {
              success: false,
              error: 'search_rate_limited',
              provider: resolved.provider,
              query,
              reason,
              message: `${labelByProvider[resolved.provider]} rate limit reached for this user. Try again in a moment, or ask the user to upgrade their plan.`
            };
          }
          return {
            success: false,
            error: 'search_request_failed',
            provider: resolved.provider,
            status: result.status,
            query,
            reason
          };
        }

        return {
          success: true,
          provider: resolved.provider,
          query,
          reason: reason || `Searching ${labelByProvider[resolved.provider]} for "${query}"`,
          resultCount: result.results.length,
          results: result.results,
          summary:
            result.results.length > 0
              ? `Found ${result.results.length} result(s) for "${query}"`
              : `No results found for "${query}". Try rephrasing.`
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: e instanceof Error ? e.message : 'search_failed',
          provider: resolved.provider,
          query,
          reason
        };
      }
    }
  });
}
