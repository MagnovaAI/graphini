type ToolOutput = Record<string, unknown>;

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
  if (toolName === 'iconifier') {
    const results = (output.results as { status: string }[] | undefined) || [];
    const added = results.filter((r) => r.status === 'added').length;
    const removed = results.filter((r) => r.status === 'removed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    if (output.mode === 'remove') {
      return `${removed} icon${removed !== 1 ? 's' : ''} removed`;
    }
    return `${added} added${skipped > 0 ? `, ${skipped} skipped` : ''}`;
  }
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
  if (toolName === 'thinking') {
    return ((output.summary as string) || '').slice(0, 80);
  }
  if (output.summary) return String(output.summary).slice(0, 80);
  if (output.message) return String(output.message).slice(0, 80);
  return '';
}

export function deriveToolDetails(toolName: string, output: ToolOutput): string[] {
  if (toolName === 'iconifier') {
    const results = output.results as
      | { nodeId: string; nodeText?: string; status: string; iconId?: string }[]
      | undefined;
    if (!results?.length) return [];
    return results
      .slice(0, 12)
      .map((r) =>
        r.status === 'added' && r.iconId ? `${r.nodeId}: ${r.iconId}` : `${r.nodeId}: ${r.status}`
      );
  }
  if (toolName === 'webSearch') {
    const results = output.results as
      | { title?: string; snippet?: string; url?: string }[]
      | undefined;
    if (!results?.length) return [];
    return results
      .slice(0, 8)
      .map(
        (r) =>
          `${r.title || r.url || ''}${r.snippet ? ` — ${String(r.snippet).slice(0, 100)}` : ''}`
      );
  }
  if (toolName === 'thinking') {
    const out: string[] = [];
    if (output.focus) out.push(`Focus: ${output.focus}`);
    if (output.summary) out.push(String(output.summary));
    const tools = output.toolsConsidered as string[] | undefined;
    if (tools?.length) out.push(`Tools: ${tools.join(', ')}`);
    if (output.nextAction) out.push(`Next: ${output.nextAction}`);
    if (output.confidence) out.push(`Confidence: ${output.confidence}`);
    return out;
  }
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
