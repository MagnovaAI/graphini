/**
 * Bridge-backed operations for the `fileSystem` tool.
 *
 * When the user's `workspace.source` setting is `"local"`, fileSystem.ts
 * delegates `list` / `read` / `grep` here instead of hitting the DB.
 * Writes are unconditionally refused — the graphini-bridge is read-only.
 *
 * The shapes returned here intentionally mirror the DB-backed shapes in
 * fileSystem.ts so the model (and the chip renderer) can't tell which
 * backend served a given response.
 */

import { settingsManager } from '$lib/server/state-manager';
import { deriveKind, type FileKind } from '$lib/server/workspace-paths';
import { callBridgeTool, type BridgeResult } from '$lib/server/chat/mcp-bridge-client';
import type { FileSystemTurnGuard } from './context';

const MAX_GREP_FILES_LOCAL = 50;
const MAX_GREP_FILE_BYTES = 200_000;
const MAX_READ_CONTENT_CHARS = 200_000; // matches fileSystem.ts MAX_READ_CONTENT_CHARS / 4*4

export type WorkspaceSource = 'cloud' | 'local';

export interface BridgeConfig {
  source: WorkspaceSource;
  url: string | null;
}

/** Resolve the user's workspace source + bridge URL from app_settings. */
export async function loadBridgeConfig(userId: string): Promise<BridgeConfig> {
  const [rawSource, rawUrl] = await Promise.all([
    settingsManager.get<WorkspaceSource>(userId, 'workspace', 'source', 'cloud'),
    settingsManager.get<string>(userId, 'local_bridge', 'url', '')
  ]);
  const source: WorkspaceSource = rawSource === 'local' ? 'local' : 'cloud';
  const url = rawUrl && typeof rawUrl === 'string' && rawUrl.length > 0 ? rawUrl : null;
  return { source, url };
}

/** Uniform error envelope returned to the model when the bridge isn't usable. */
export function bridgeNotConfiguredError() {
  return {
    success: false,
    error:
      'Local workspace is selected but no bridge URL is configured. Open Settings → Local files and paste the URL printed by `graphini-bridge`, or switch back to Cloud workspace.'
  };
}

export function bridgeWriteRefused(operation: string) {
  return {
    success: false,
    error: `REJECTED: \`${operation}\` is not available in Local workspace — the local bridge is read-only. Switch to Cloud workspace to edit files.`
  };
}

function unwrap<T>(
  result: BridgeResult,
  parse: (text: string, structured: unknown) => T
): T | { success: false; error: string } {
  if (!result.ok) return { success: false, error: result.error };
  try {
    return parse(result.text, result.structured);
  } catch (err) {
    return {
      success: false,
      error: `Local bridge returned malformed payload: ${(err as Error).message}`
    };
  }
}

interface BridgeTreeNode {
  name: string;
  type: 'dir' | 'file';
  children?: BridgeTreeNode[];
}

function flattenTree(
  node: BridgeTreeNode,
  prefix = '',
  isRoot = true
): { path: string; kind: FileKind | null }[] {
  const out: { path: string; kind: FileKind | null }[] = [];
  // The bridge's `directory_tree` returns the root with `name=<root-folder>`.
  // We skip the root's own name so emitted paths match how the bridge's
  // own tools (read_file, list_directory) interpret them: relative to the
  // configured root, root itself implicit.
  if (node.type === 'file') {
    const path = prefix ? `${prefix}/${node.name}` : node.name;
    out.push({ path, kind: deriveKind(node.name) });
    return out;
  }
  const childPrefix = isRoot ? '' : prefix ? `${prefix}/${node.name}` : node.name;
  for (const child of node.children ?? []) {
    out.push(...flattenTree(child, childPrefix, false));
  }
  return out;
}

/** Local equivalent of `workspaceFiles({operation:"list"})`. */
export async function bridgeList(url: string) {
  const result = await callBridgeTool(url, 'directory_tree', { path: '.' });
  return unwrap(result, (_text, structured) => {
    const root = (structured ?? {}) as BridgeTreeNode;
    const flat = flattenTree(root).filter(
      (f): f is { path: string; kind: FileKind } => f.kind !== null
    );
    return {
      files: flat.map((f) => ({
        id: f.path,
        kind: f.kind,
        path: f.path,
        updated_at: new Date(0).toISOString()
      })),
      quota: { total: -1, used: flat.length },
      source: 'local' as const,
      success: true
    };
  });
}

/** Local equivalent of `workspaceFiles({operation:"read", path})`. */
export async function bridgeRead(
  url: string,
  path: string,
  startLine: number | undefined,
  endLine: number | undefined,
  guard: FileSystemTurnGuard
) {
  if (!path) return { success: false, error: 'read requires `path`' };
  const result = await callBridgeTool(url, 'read_file', { path });
  return unwrap(result, (text) => {
    const fullContent = text ?? '';
    const lines = fullContent.split('\n');
    const lineCount = lines.length;
    guard.readPaths.add(path);
    const kind = deriveKind(path) ?? 'md';

    if (startLine !== undefined || endLine !== undefined) {
      const fromLine = startLine ?? 1;
      const toLine = endLine ?? fromLine;
      if (fromLine < 1) return { success: false, error: '`startLine` must be >= 1' };
      if (toLine < fromLine)
        return { success: false, error: '`endLine` cannot be less than `startLine`' };
      if (fromLine > lineCount)
        return {
          success: false,
          error: `startLine ${fromLine} exceeds file length (${lineCount} lines)`
        };
      const selected = lines.slice(fromLine - 1, Math.min(toLine, lineCount)).join('\n');
      return {
        file: {
          content: selected,
          id: path,
          kind,
          length: fullContent.length,
          lineCount,
          path,
          range: { endLine: Math.min(toLine, lineCount), startLine: fromLine }
        },
        source: 'local' as const,
        success: true
      };
    }

    if (fullContent.length > MAX_READ_CONTENT_CHARS) {
      const head = fullContent.slice(0, MAX_READ_CONTENT_CHARS);
      return {
        file: {
          content: head,
          id: path,
          kind,
          length: fullContent.length,
          lineCount,
          path,
          range: { endLine: head.split('\n').length, startLine: 1 },
          truncated: true
        },
        hint: 'Local file is large; this is a preview. Use startLine/endLine for a narrower range.',
        source: 'local' as const,
        success: true
      };
    }

    return {
      file: {
        content: fullContent,
        id: path,
        kind,
        length: fullContent.length,
        lineCount,
        path,
        truncated: false
      },
      source: 'local' as const,
      success: true
    };
  });
}

interface GrepOptions {
  query: string;
  mode: 'text' | 'regex';
  caseSensitive: boolean;
  contextLines: number;
  maxMatches: number;
}

/**
 * Local `grep`. The bridge doesn't expose a server-side grep tool, so we
 * fetch a directory tree, walk it, and read files that look textual,
 * applying caps so this can't fan out and blow the function timeout.
 */
export async function bridgeGrep(
  url: string,
  path: string | undefined,
  opts: GrepOptions,
  guard: FileSystemTurnGuard
) {
  if (!opts.query) return { success: false, error: '`query` is required.' };

  const scopePath = path && path.endsWith('/') ? path.replace(/\/+$/, '') : null;
  const singleFilePath = path && !path.endsWith('/') ? path : null;

  // Build the candidate file list.
  let files: string[];
  if (singleFilePath) {
    files = [singleFilePath];
  } else {
    const listed = await callBridgeTool(url, 'directory_tree', { path: scopePath || '.' });
    if (!listed.ok) return { success: false, error: listed.error };
    const root = (listed.structured ?? {}) as BridgeTreeNode;
    files = flattenTree(root, scopePath || '')
      .map((f) => f.path)
      .filter((p) => deriveKind(p) !== null)
      .slice(0, MAX_GREP_FILES_LOCAL);
  }

  let matcher: RegExp;
  try {
    matcher =
      opts.mode === 'regex'
        ? new RegExp(opts.query, opts.caseSensitive ? '' : 'i')
        : new RegExp(escapeRegex(opts.query), opts.caseSensitive ? '' : 'i');
  } catch (err) {
    return { success: false, error: `Invalid regex: ${(err as Error).message}` };
  }

  const matches: {
    path: string;
    line: number;
    text: string;
    context: { before: string[]; after: string[] };
  }[] = [];
  let filesScanned = 0;
  let truncated = false;

  for (const file of files) {
    if (matches.length >= opts.maxMatches) {
      truncated = true;
      break;
    }
    const read = await callBridgeTool(url, 'read_file', { path: file });
    if (!read.ok) continue;
    const body = read.text ?? '';
    if (body.length > MAX_GREP_FILE_BYTES) continue;
    filesScanned += 1;
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (matcher.test(lines[i])) {
        matches.push({
          path: file,
          line: i + 1,
          text: lines[i],
          context: {
            before: lines.slice(Math.max(0, i - opts.contextLines), i),
            after: lines.slice(i + 1, i + 1 + opts.contextLines)
          }
        });
        guard.readPaths.add(file);
        if (matches.length >= opts.maxMatches) {
          truncated = true;
          break;
        }
      }
    }
  }

  return {
    filesScanned,
    matchMode: opts.mode,
    matches,
    mode: 'grep' as const,
    query: opts.query,
    scope: scopePath
      ? { kind: 'folder' as const, path: `${scopePath}/` }
      : singleFilePath
        ? { kind: 'file' as const, path: singleFilePath }
        : { kind: 'workspace' as const },
    source: 'local' as const,
    success: true,
    totalMatches: matches.length,
    truncated
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
