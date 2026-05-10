type ToolOutput = Record<string, unknown>;

export interface SearchResult {
  title: string;
  snippet?: string;
  url?: string;
  source?: string;
}

function searchProviderLabel(provider: unknown): string {
  if (provider === 'tavily') return 'Tavily';
  if (provider === 'brave_search') return 'Brave Search';
  return 'Web';
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
  warnings?: { line: number; message: string }[];
}

export function deriveErrorCheckerSubtitle(result: ErrorCheckerResult): string {
  if (result.valid && result.warnings?.length) {
    return `${result.warnings.length} warning${result.warnings.length !== 1 ? 's' : ''}`;
  }
  if (result.valid) return 'no errors';
  const first = result.errors[0];
  if (!first) {
    return `${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}`;
  }
  return first.line > 0 ? `line ${first.line}: ${first.message}` : first.message;
}

export function deriveToolSubtitle(toolName: string, output: ToolOutput): string {
  if (toolName === 'fileSystem') {
    const file = output.file as { path?: string } | undefined;
    const mode =
      output.mode === 'update' || output.mode === 'patch'
        ? 'edit'
        : output.mode
          ? String(output.mode)
          : undefined;
    const path = file?.path ?? (typeof output.path === 'string' ? output.path : undefined);
    if (mode && path) return `${mode} · ${path}`;
    if (path) return path;
    if (Array.isArray(output.files)) {
      const n = output.files.length;
      return `${n} file${n !== 1 ? 's' : ''}`;
    }
    if (output.moved !== undefined) return `${output.moved} moved`;
    if (output.deleted !== undefined) return `${output.deleted} deleted`;
    if (output.error) return String(output.error).slice(0, 80);
  }
  if (toolName === 'webSearch') {
    const results = (output.results as unknown[] | undefined) || [];
    const n = results.length;
    const provider = searchProviderLabel(output.provider);
    const query = output.query ? `"${output.query}"` : '';
    const count = n ? ` · ${n} result${n !== 1 ? 's' : ''}` : '';
    return [provider, query].filter(Boolean).join(' · ') + count;
  }
  if (toolName === 'useSkill') {
    if (typeof output.name === 'string') return output.name;
    if (output.error) return String(output.error).slice(0, 80);
  }
  if (toolName === 'autoStyler' || toolName === 'styleSearch') {
    const parts: string[] = [];
    if (output.themeMode) parts.push(String(output.themeMode));
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
  if (toolName === 'fileSystem') {
    const file = output.file as
      | { content?: string; kind?: string; length?: number; path?: string }
      | undefined;
    const out: string[] = [];
    if (output.mode) {
      const mode = output.mode === 'update' || output.mode === 'patch' ? 'edit' : output.mode;
      out.push(`Operation: ${mode}`);
    }
    if (file?.path) out.push(`Path: ${file.path}`);
    if (file?.kind) out.push(`Kind: ${file.kind}`);
    if (output.startLine !== undefined) {
      out.push(
        `Lines: ${output.startLine}${output.endLine !== output.startLine ? `-${output.endLine}` : ''}`
      );
    }
    if (output.replacedLineCount !== undefined) {
      out.push(
        `Edit: replaced ${output.replacedLineCount} line${output.replacedLineCount === 1 ? '' : 's'}, inserted ${output.insertedLineCount ?? 0}`
      );
    }
    if (typeof file?.content === 'string') {
      out.push(`Result: ${file.content.split('\n').length} lines`);
    }
    if (output.quota && typeof output.quota === 'object') {
      const quota = output.quota as { total?: number; used?: number };
      out.push(`Quota: ${quota.used ?? '?'} / ${quota.total ?? '?'}`);
    }
    if (Array.isArray(output.files)) {
      out.push(`Files: ${output.files.length}`);
      out.push(
        ...output.files
          .slice(0, 8)
          .map((file) =>
            file && typeof file === 'object' && 'path' in file ? String(file.path) : ''
          )
          .filter(Boolean)
      );
    }
    if (output.moved !== undefined) out.push(`Moved: ${output.moved}`);
    if (output.deleted !== undefined) out.push(`Deleted: ${output.deleted}`);
    if (output.error) out.push(String(output.error));
    if (output.hint) out.push(String(output.hint));
    return out;
  }
  if (toolName === 'styleSearch') {
    const out: string[] = [];
    if (output.palette) {
      out.push(`Palette: ${[output.themeMode, output.palette].filter(Boolean).join(' ')}`);
    }
    const patch = output.suggestedPatch as { startLine: number; endLine: number } | undefined;
    if (patch) out.push(`Edit: lines ${patch.startLine}-${patch.endLine}`);
    const styleLines = output.styleLines as string[] | undefined;
    if (styleLines?.length) {
      out.push(...styleLines.slice(0, 8).map((line) => line.trim()));
    }
    return out;
  }
  if (toolName === 'errorChecker') {
    const out: string[] = [];
    const warnings = output.warnings as { line?: number; message?: string }[] | undefined;
    if (warnings?.length) {
      out.push(
        ...warnings.slice(0, 8).map((warning) => {
          const message = String(warning.message ?? 'Contrast warning');
          return warning.line && warning.line > 0
            ? `Warning line ${warning.line}: ${message}`
            : `Warning: ${message}`;
        })
      );
    }
    return out;
  }
  if (toolName === 'useSkill') {
    const out: string[] = [];
    if (typeof output.name === 'string') out.push(`Skill: ${output.name}`);
    if (typeof output.instructions === 'string') {
      out.push(output.instructions.slice(0, 240));
    }
    if (Array.isArray(output.availableSkills)) {
      out.push(`Available: ${output.availableSkills.slice(0, 8).join(', ')}`);
    }
    if (output.error) out.push(String(output.error));
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
