/**
 * Pure grep core for the workspaceFiles tool.
 *
 * No DB, no SvelteKit imports — takes an array of {path, content} rows and a
 * set of options, returns matches with optional surrounding context lines.
 *
 * Two scan modes:
 *  - text (default): substring scan (case-insensitive by default).
 *  - regex:          compiled RegExp scan with a 50ms per-line deadline so a
 *                    pathological pattern can't stall the worker.
 *
 * Iterates files in the order received and lines 1-indexed. Stops as soon as
 * `maxMatches` is reached and reports `truncated: true`.
 */

export interface GrepFile {
  path: string;
  content: string;
}

export interface GrepMatch {
  path: string;
  lineNumber: number;
  lineText: string;
  contextBefore: string[];
  contextAfter: string[];
}

export interface GrepOptions {
  query: string;
  mode?: 'text' | 'regex';
  caseSensitive?: boolean;
  contextLines?: number;
  maxMatches?: number;
}

export interface GrepResult {
  matches: GrepMatch[];
  truncated: boolean;
  filesScanned: number;
  slowLines: number;
}

const PER_LINE_REGEX_DEADLINE_MS = 50;
const MAX_REGEX_QUERY_LENGTH = 1000;
const NESTED_QUANTIFIER_RE = /[*+?]\s*[)\]]\s*[*+?]|\([^)]*[*+]\)\s*[*+?]/;

function validateOptions(opts: GrepOptions): {
  query: string;
  mode: 'text' | 'regex';
  caseSensitive: boolean;
  contextLines: number;
  maxMatches: number;
} {
  const query = opts.query;
  if (typeof query !== 'string' || query.length === 0) {
    throw new Error('`query` is required and must be a non-empty string.');
  }
  const mode = opts.mode ?? 'text';
  if (mode !== 'text' && mode !== 'regex') {
    throw new Error('`mode` must be either "text" or "regex".');
  }
  const caseSensitive = opts.caseSensitive ?? false;
  const contextLines = opts.contextLines ?? 1;
  if (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > 5) {
    throw new Error('`contextLines` must be an integer in [0, 5].');
  }
  const maxMatches = opts.maxMatches ?? 50;
  if (!Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > 200) {
    throw new Error('`maxMatches` must be an integer in [1, 200].');
  }
  return { caseSensitive, contextLines, maxMatches, mode, query };
}

function compileRegex(query: string, caseSensitive: boolean): RegExp {
  if (query.length > MAX_REGEX_QUERY_LENGTH) {
    throw new Error(
      `Regex pattern is too long (${query.length} chars); limit is ${MAX_REGEX_QUERY_LENGTH}.`
    );
  }
  if (NESTED_QUANTIFIER_RE.test(query)) {
    throw new Error(
      'Regex pattern rejected: contains nested unbounded quantifiers that risk catastrophic backtracking.'
    );
  }
  try {
    return new RegExp(query, caseSensitive ? '' : 'i');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regex: ${message}`);
  }
}

export function runGrep(files: GrepFile[], opts: GrepOptions): GrepResult {
  const { query, mode, caseSensitive, contextLines, maxMatches } = validateOptions(opts);

  const regex = mode === 'regex' ? compileRegex(query, caseSensitive) : null;
  const needle = mode === 'text' && !caseSensitive ? query.toLowerCase() : query;

  const matches: GrepMatch[] = [];
  let truncated = false;
  let slowLines = 0;

  outer: for (const file of files) {
    const lines = (file.content ?? '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      let hit = false;
      if (regex) {
        const start = performance.now();
        try {
          hit = regex.test(line);
        } catch {
          hit = false;
        }
        const elapsed = performance.now() - start;
        if (elapsed > PER_LINE_REGEX_DEADLINE_MS) {
          slowLines += 1;
          continue;
        }
      } else if (caseSensitive) {
        hit = line.includes(needle);
      } else {
        hit = line.toLowerCase().includes(needle);
      }

      if (!hit) continue;

      const beforeStart = Math.max(0, i - contextLines);
      const afterEnd = Math.min(lines.length, i + 1 + contextLines);
      matches.push({
        contextAfter: lines.slice(i + 1, afterEnd),
        contextBefore: lines.slice(beforeStart, i),
        lineNumber: i + 1,
        lineText: line,
        path: file.path
      });

      if (matches.length >= maxMatches) {
        truncated = true;
        break outer;
      }
    }
  }

  return {
    matches,
    truncated,
    filesScanned: files.length,
    slowLines
  };
}
