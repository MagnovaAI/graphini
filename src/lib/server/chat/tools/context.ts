import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import type { NeonAdapter } from '$lib/server/db/neon-adapter';
import { workspaceFiles } from '$lib/server/db/schema';

export interface WorkspaceToolTab {
  engine: string;
  id?: string;
  title: string;
}

export interface ActiveFileTarget {
  id: string;
  path: string;
  kind: 'md' | 'json' | 'yaml' | 'mermaid';
}

export interface WorkspaceToolTarget {
  activeEngine?: string;
  activeTabId?: string;
  activeTabName?: string;
  tabs?: WorkspaceToolTab[];
  activeFile?: ActiveFileTarget;
}

/**
 * Per-turn guard state for the unified `fileSystem` tool.
 * - `listed` is set after the model calls `list`; `create` requires it.
 * - `readPaths` records which file paths the model has read this turn;
 *   `patch` requires the path to be in this set.
 * Cleared by the harness at the start of each chat request.
 */
export interface FileSystemTurnGuard {
  listed: boolean;
  readPaths: Set<string>;
}

export interface ToolContext {
  modelId?: string;
  sessionId: string;
  /** Authenticated user (or guest) id. Tools that need per-user keys read this. */
  userId?: string;
  target?: WorkspaceToolTarget;
  fileSystemGuard?: FileSystemTurnGuard;
}

export const targetTabNameSchema = z
  .string()
  .min(1)
  .describe(
    'Exact unique workspace tab name to read or modify. Must match the active tab shown in context.'
  );

export function targetMetadata(target: WorkspaceToolTarget | undefined, targetTabName?: string) {
  return {
    targetEngine: target?.activeEngine,
    targetTabId: target?.activeTabId,
    targetTabName: targetTabName || target?.activeTabName
  };
}

export function validateTargetTab(target: WorkspaceToolTarget | undefined, targetTabName?: string) {
  if (!target?.activeTabName) return null;
  if (!targetTabName) {
    return {
      error: `REJECTED: targetTabName is required. Use "${target.activeTabName}".`,
      hint: 'Every workspace tool call must include the exact active tab name.'
    };
  }
  if (targetTabName !== target.activeTabName) {
    return {
      error: `REJECTED: Tool targeted "${targetTabName}", but the active tab is "${target.activeTabName}".`,
      hint: 'Switch to the intended tab first, then call the tool with that exact tab name.'
    };
  }
  return null;
}

export function validateMermaidTarget(
  target: WorkspaceToolTarget | undefined,
  targetTabName?: string
) {
  const tabError = validateTargetTab(target, targetTabName);
  if (tabError) return tabError;
  if (target?.activeEngine && target.activeEngine !== 'mermaid') {
    return {
      error: `REJECTED: The active tab "${target.activeTabName ?? 'Untitled'}" is ${target.activeEngine}, not Mermaid.`,
      hint: 'Use the tool category that matches the active tab engine.'
    };
  }
  return null;
}

/**
 * Persist new tool-generated content back to the user's active workspace file
 * row, when one is set. Tools (autoStyler, errorChecker, iconSearch,
 * styleSearch) call this after computing new content so the file system stays
 * in sync with the canvas.
 */
export async function persistActiveFileContent(
  target: WorkspaceToolTarget | undefined,
  userId: string | undefined,
  content: string
): Promise<void> {
  if (!target?.activeFile || !userId) return;
  const db = (getDb() as NeonAdapter).db;
  await db
    .update(workspaceFiles)
    .set({ content, updated_at: new Date() })
    .where(and(eq(workspaceFiles.id, target.activeFile.id), eq(workspaceFiles.user_id, userId)));
}

/**
 * Read the active workspace file's content for the current user. Returns ''
 * when no file is active or the row is missing — callers should treat that
 * as "no diagram to operate on" rather than an error.
 */
export async function readActiveFileContent(
  target: WorkspaceToolTarget | undefined,
  userId: string | undefined
): Promise<string> {
  if (!target?.activeFile || !userId) return '';
  const db = (getDb() as NeonAdapter).db;
  const [row] = await db
    .select({ content: workspaceFiles.content })
    .from(workspaceFiles)
    .where(and(eq(workspaceFiles.id, target.activeFile.id), eq(workspaceFiles.user_id, userId)));
  return row?.content ?? '';
}

/**
 * Resolve a mermaid file by explicit path, falling back to the active file.
 * Used by mermaid-only helper tools (autoStyler / errorChecker / iconSearch /
 * styleSearch) so they can run on any `.mermaid` file the model names — even
 * when the user has a different file (e.g. a `.md`) currently open.
 *
 * Returns:
 *  - { ok: true, ... } with id, path, content when a `.mermaid` row resolves.
 *  - { ok: false, reason } when nothing matches; reason is the model-readable
 *    message the calling tool should surface.
 */
export async function resolveMermaidTarget(
  target: WorkspaceToolTarget | undefined,
  userId: string | undefined,
  explicitPath?: string
): Promise<
  | { ok: true; id: string; path: string; content: string }
  | { ok: false; reason: string; hint?: string }
> {
  if (!userId) return { ok: false, reason: 'No user context — cannot read files.' };
  const db = (getDb() as NeonAdapter).db;

  if (explicitPath) {
    const [row] = await db
      .select({
        id: workspaceFiles.id,
        path: workspaceFiles.path,
        kind: workspaceFiles.kind,
        content: workspaceFiles.content
      })
      .from(workspaceFiles)
      .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, explicitPath)));
    if (!row) return { ok: false, reason: `File not found: ${explicitPath}` };
    if (row.kind !== 'mermaid') {
      return {
        ok: false,
        reason: `${explicitPath} is .${row.kind}, not .mermaid. This tool only operates on Mermaid files.`,
        hint: 'Pass a `.mermaid` path, or call fileSystem to create one first.'
      };
    }
    return { ok: true, id: row.id, path: row.path, content: row.content };
  }

  if (target?.activeFile && target.activeFile.kind === 'mermaid') {
    const content = await readActiveFileContent(target, userId);
    return {
      ok: true,
      id: target.activeFile.id,
      path: target.activeFile.path,
      content
    };
  }

  if (target?.activeFile) {
    return {
      ok: false,
      reason: `Active file "${target.activeFile.path}" is .${target.activeFile.kind}. Pass a \`path\` to a .mermaid file, or no file is targeted.`,
      hint: 'fileSystem({operation: "list"}) to see your .mermaid files; pass that path here.'
    };
  }

  return {
    ok: false,
    reason: 'No active file and no `path` given. Specify a `.mermaid` path to operate on.',
    hint: 'fileSystem({operation: "list"}) to find a file, then re-run this tool with `path`.'
  };
}

/**
 * Persist new content back to a workspace file resolved earlier via
 * resolveMermaidTarget. Scoped to the current user.
 */
export async function persistFileContentById(
  fileId: string,
  userId: string,
  content: string
): Promise<void> {
  const db = (getDb() as NeonAdapter).db;
  await db
    .update(workspaceFiles)
    .set({ content, updated_at: new Date() })
    .where(and(eq(workspaceFiles.id, fileId), eq(workspaceFiles.user_id, userId)));
}
