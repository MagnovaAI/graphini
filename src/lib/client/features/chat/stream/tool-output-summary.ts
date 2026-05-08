type ToolOutput = Record<string, unknown>;

export interface SearchResult {
  title: string;
  snippet?: string;
  url?: string;
  source?: string;
}

/**
 * Pull structured web-search results out of a tool output, if any. Returns []
 * when the tool wasn't a web search or returned no results.
 */
export function deriveSearchResults(toolName: string, output: ToolOutput): SearchResult[] {
  if (toolName !== 'webSearch') return [];
  const results = output.results as
    | { title?: string; snippet?: string; url?: string; source?: string }[]
    | undefined;
  if (!results?.length) return [];
  return results.slice(0, 8).map((r) => ({
    title: String(r.title ?? r.url ?? '').slice(0, 200),
    snippet: r.snippet ? String(r.snippet).slice(0, 280) : undefined,
    url: r.url ? String(r.url) : undefined,
    source: r.source ? String(r.source) : undefined
  }));
}

export interface ErrorCheckerResult {
  valid: boolean;
  errors: { line: number; message: string }[];
}

export function deriveErrorCheckerSubtitle(result: ErrorCheckerResult): string {
  if (result.valid) return 'no errors';
  const first = result.errors[0];
  if (!first) {
    return `${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}`;
  }
  return first.line > 0 ? `line ${first.line}: ${first.message}` : first.message;
}

export function deriveToolSubtitle(toolName: string, output: ToolOutput): string {
  if (toolName === 'webSearch') {
    const results = (output.results as unknown[] | undefined) || [];
    const n = results.length;
    const query = output.query ? `"${output.query}"` : '';
    const count = n ? ` · ${n} result${n !== 1 ? 's' : ''}` : '';
    return query + count;
  }
  if (toolName === 'fileManager') {
    if (output.fileCount !== undefined) {
      const n = output.fileCount as number;
      return `${n} file${n !== 1 ? 's' : ''}`;
    }
    if (output.filename) return String(output.filename);
    if (output.totalMatches !== undefined) {
      const n = output.totalMatches as number;
      return `${n} match${n !== 1 ? 'es' : ''}`;
    }
    if (output.message) return String(output.message);
    return '';
  }
  if (toolName === 'autoStyler' || toolName === 'styleSearch') {
    const parts: string[] = [];
    if (output.palette) parts.push(String(output.palette));
    if (output.nodesStyled !== undefined) {
      const n = output.nodesStyled as number;
      parts.push(`${n} node${n !== 1 ? 's' : ''}`);
    }
    return parts.join(' · ') || (output.summary as string) || '';
  }
  // `thinking` is rendered as its own `chain-of-thought` part — it never
  // goes through the tool-simple chip pipeline, so no thinking branch here.
  if (output.summary) return String(output.summary).slice(0, 80);
  if (output.message) return String(output.message).slice(0, 80);
  return '';
}

export function deriveToolDetails(toolName: string, output: ToolOutput): string[] {
  if (toolName === 'webSearch') {
    // webSearch results are rendered as structured cards via
    // deriveSearchResults; only fall back to flat details if there are none.
    return [];
  }
  // `thinking` is rendered as its own `chain-of-thought` part; it never
  // produces tool-simple details, so no thinking branch here.
  if (toolName === 'styleSearch') {
    const out: string[] = [];
    if (output.palette) out.push(`Palette: ${output.palette}`);
    const patch = output.suggestedPatch as { startLine: number; endLine: number } | undefined;
    if (patch) out.push(`Patch: lines ${patch.startLine}-${patch.endLine}`);
    const styleLines = output.styleLines as string[] | undefined;
    if (styleLines?.length) {
      out.push(...styleLines.slice(0, 8).map((line) => line.trim()));
    }
    return out;
  }
  if (toolName === 'iconSearch') {
    const suggestions = output.suggestions as
      | {
          colorMode?: string;
          confidence?: number;
          iconId?: string;
          nodeId: string;
          source?: string;
          status: string;
        }[]
      | undefined;
    if (!suggestions?.length) return [];
    return suggestions
      .slice(0, 8)
      .map((item) =>
        item.status === 'matched'
          ? `${item.nodeId}: ${item.iconId} (${item.colorMode || 'any'}, ${item.source || 'local'}, ${Math.round((item.confidence || 0) * 100)}%)`
          : `${item.nodeId}: no match`
      );
  }
  return [];
}
