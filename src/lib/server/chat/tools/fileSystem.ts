/**
 * Unified `fileSystem` tool — single surface the model uses to read and edit
 * the user's workspace files (`.md`, `.json`, `.yaml`, `.mermaid`).
 *
 * Operations:
 *  - list           enumerate files (path, kind, updated_at)
 *  - read           full content of one file by path
 *  - create         new file with explicit path + content (quota-checked)
 *  - update         full rewrite of an existing file
 *  - patch          line-range SEARCH/REPLACE on an existing file
 *  - delete         remove one file
 *  - moveFolder     bulk-rename a subtree
 *  - deleteFolder   bulk-delete a subtree
 *
 * Guards (enforced server-side, returned as `error` on violation):
 *  - `create` requires a prior `list` in the same chat turn.
 *  - `patch` requires a prior `read` of the same path in the same chat turn.
 *
 * Per-kind validation:
 *  - .mermaid → must be a single, valid Mermaid document; rejects content
 *    with markdown signals; preserves the edge-count guard from the legacy
 *    diagramPatch tool.
 *  - .md      → rejects content that starts with a Mermaid declaration.
 *  - .json    → must `JSON.parse` cleanly.
 *  - .yaml    → no structural validation here (no yaml lib bundled); the
 *    canvas surfaces parse errors.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import type { NeonAdapter } from '$lib/server/db/neon-adapter';
import { workspaceFiles, users as usersTable } from '$lib/server/db/schema';
import { PATH_RE, FOLDER_RE, deriveKind, type FileKind } from '$lib/server/workspace-paths';
import { MERMAID_DIAGRAM_DECLARATION, findMermaidDeclarations } from '$lib/server/chat/mermaid';
import { validateContentForKind } from '$lib/server/workspace-content-validation';
import type { FileSystemTurnGuard, ToolContext } from './context';

const drizzleDb = () => (getDb() as NeonAdapter).db;

const GUEST_QUOTA = 15;
const USER_QUOTA = 30;

const MERMAID_EDGE_PATTERN = /(<-->|<-\.->|<==>|<---|-->|-\.->|==>|---|\.\.>|--x|--o)/;

async function userQuota(userId: string): Promise<number> {
  const [row] = await drizzleDb()
    .select({ firebase_uid: usersTable.firebase_uid })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const isGuest = (row?.firebase_uid ?? '').startsWith('guest:');
  return isGuest ? GUEST_QUOTA : USER_QUOTA;
}

function countMermaidEdgeLines(source: string): number {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.startsWith('%%')) return false;
      if (/^(classDef|class|style|linkStyle|subgraph|end)\b/i.test(line)) return false;
      return MERMAID_EDGE_PATTERN.test(line);
    }).length;
}

function applyLinePatch(
  current: string,
  startLine: number,
  endLine: number,
  replacement: string
):
  | {
      ok: true;
      next: string;
      replacedLineCount: number;
      insertedLineCount: number;
      newLineCount: number;
    }
  | { ok: false; error: string; hint?: string } {
  if (startLine < 1) return { ok: false, error: `startLine (${startLine}) must be >= 1` };
  if (endLine < startLine)
    return { ok: false, error: `startLine (${startLine}) cannot exceed endLine (${endLine})` };
  const lines = current.split('\n');
  if (endLine > lines.length)
    return {
      ok: false,
      error: `endLine ${endLine} exceeds file length (${lines.length} lines)`
    };
  const replacementLines = replacement.split('\n');
  const next = [...lines];
  next.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
  return {
    insertedLineCount: replacementLines.length,
    newLineCount: next.length,
    next: next.join('\n'),
    ok: true,
    replacedLineCount: endLine - startLine + 1
  };
}

function looksLikeFullDocumentPatch(
  currentLineCount: number,
  startLine: number,
  endLine: number,
  replacement: string,
  kind: FileKind
): boolean {
  if (kind !== 'mermaid') return false;
  const replacementLines = replacement.split('\n');
  const replacementStartsWithDeclaration = MERMAID_DIAGRAM_DECLARATION.test(replacement.trim());
  const declarationCount = findMermaidDeclarations(replacement).length;
  const replacesEntireDocument =
    startLine === 1 && endLine === currentLineCount && currentLineCount > 1;
  const replacesMostDocument =
    currentLineCount >= 6 &&
    endLine - startLine + 1 >= Math.ceil(currentLineCount * 0.75) &&
    replacementLines.length >= Math.ceil(currentLineCount * 0.75);
  return (
    replacementStartsWithDeclaration &&
    declarationCount > 0 &&
    (replacesEntireDocument || replacesMostDocument)
  );
}

export function createFileSystemTool({ userId, fileSystemGuard }: ToolContext) {
  return tool({
    description: `Read and edit the user's workspace files. Single tool for all file operations.

Operations:
- list:         enumerate every file (path, kind, updated_at). MUST be called before any \`create\`.
- read:         full content of one file by path. MUST be called before any \`patch\` to that file.
- create:       create a new file. Requires \`path\` ending in .md/.json/.yaml/.yml/.mermaid/.mmd, plus \`content\`. Quota: 15 (guest) / 30 (signed-in).
- update:       full rewrite of an existing file. Requires \`path\` and \`content\`.
- patch:        line-range replace on an existing file. Requires \`path\`, \`startLine\`, \`endLine\`, \`content\`. 1-based, inclusive. Use for small local edits (≤ ~5 lines changing). For larger rewrites, use \`update\`.
- delete:       remove one file by path.
- moveFolder:   rename every file under a folder prefix in one shot. Requires \`from\` and \`to\`.
- deleteFolder: delete every file under a folder prefix. Requires \`path\`.

Per-kind validation: .mermaid rejects markdown; .md rejects content starting with a Mermaid declaration; .json must parse; .yaml is stored as-is.`,
    inputSchema: z.object({
      content: z.string().optional(),
      endLine: z.number().int().min(1).optional(),
      from: z.string().optional(),
      operation: z.enum([
        'list',
        'read',
        'create',
        'update',
        'patch',
        'delete',
        'moveFolder',
        'deleteFolder'
      ]),
      path: z.string().optional(),
      startLine: z.number().int().min(1).optional(),
      to: z.string().optional()
    }),
    execute: async ({ operation, path, content, from, to, startLine, endLine }) => {
      if (!userId) {
        return { success: false, error: 'No user context — cannot use file system.' };
      }
      const db = drizzleDb();
      const guard: FileSystemTurnGuard = fileSystemGuard ?? { listed: false, readPaths: new Set() };

      if (operation === 'list') {
        const rows = await db
          .select({
            id: workspaceFiles.id,
            path: workspaceFiles.path,
            kind: workspaceFiles.kind,
            updated_at: workspaceFiles.updated_at
          })
          .from(workspaceFiles)
          .where(eq(workspaceFiles.user_id, userId))
          .orderBy(asc(workspaceFiles.path));
        const cap = await userQuota(userId);
        guard.listed = true;
        return {
          success: true,
          quota: { used: rows.length, total: cap },
          files: rows.map((r) => ({
            id: r.id,
            path: r.path,
            kind: r.kind,
            updated_at: r.updated_at.toISOString()
          }))
        };
      }

      if (operation === 'read') {
        if (!path) return { success: false, error: 'read requires `path`' };
        const [row] = await db
          .select({
            id: workspaceFiles.id,
            path: workspaceFiles.path,
            kind: workspaceFiles.kind,
            content: workspaceFiles.content
          })
          .from(workspaceFiles)
          .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, path)));
        if (!row) return { success: false, error: `File not found: ${path}` };
        guard.readPaths.add(path);
        return { success: true, file: row };
      }

      if (operation === 'create') {
        if (!guard.listed) {
          return {
            success: false,
            error:
              'REJECTED: call `list` before `create`. Avoids accidental duplicates and exceeded quotas.',
            hint: 'fileSystem({operation: "list"}) first, then retry create.'
          };
        }
        if (!path) return { success: false, error: 'create requires `path`' };
        if (!PATH_RE.test(path))
          return {
            success: false,
            error: 'Invalid path. Use letters, digits, dot, dash, underscore, slash, single spaces.'
          };
        const kind = deriveKind(path);
        if (!kind)
          return {
            success: false,
            error: 'Unsupported kind. Allowed: .md, .json, .yaml/.yml, .mermaid/.mmd'
          };
        const body = content ?? '';
        const validation = validateContentForKind(kind, body);
        if (!validation.ok)
          return { success: false, error: validation.error, hint: validation.hint };

        const [existing] = await db
          .select({ id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, path)));
        if (existing) {
          return {
            success: false,
            error: `File already exists: ${path}. Use \`update\` to overwrite or \`patch\` for line edits.`
          };
        }

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(workspaceFiles)
          .where(eq(workspaceFiles.user_id, userId));
        const cap = await userQuota(userId);
        if (count >= cap) {
          return {
            success: false,
            error: `File quota reached (${count}/${cap}). Delete a file before creating a new one.`
          };
        }

        const [inserted] = await db
          .insert(workspaceFiles)
          .values({ user_id: userId, path, kind, content: body })
          .returning();
        return {
          success: true,
          file: {
            content: body,
            id: inserted.id,
            kind: inserted.kind,
            length: body.length,
            path: inserted.path
          },
          mode: 'create'
        };
      }

      if (operation === 'update') {
        if (!path) return { success: false, error: 'update requires `path`' };
        if (content === undefined) return { success: false, error: 'update requires `content`' };
        const kind = deriveKind(path);
        if (!kind) return { success: false, error: 'Unsupported kind for update.' };
        const validation = validateContentForKind(kind, content);
        if (!validation.ok)
          return { success: false, error: validation.error, hint: validation.hint };

        const result = await db
          .update(workspaceFiles)
          .set({ content, kind, updated_at: new Date() })
          .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, path)))
          .returning();
        if (result.length === 0)
          return {
            success: false,
            error: `File not found: ${path}. Use \`create\` to make a new one.`
          };
        const r = result[0];
        return {
          success: true,
          file: {
            content,
            id: r.id,
            kind: r.kind,
            length: content.length,
            path: r.path
          },
          mode: 'update'
        };
      }

      if (operation === 'patch') {
        if (!path) return { success: false, error: 'patch requires `path`' };
        if (!guard.readPaths.has(path)) {
          return {
            success: false,
            error: `REJECTED: call \`read\` for "${path}" before \`patch\`. Line numbers must come from a fresh read.`,
            hint: 'fileSystem({operation: "read", path: "..."}) first, then retry patch.'
          };
        }
        if (startLine === undefined || endLine === undefined)
          return {
            success: false,
            error: 'patch requires `startLine` and `endLine` (1-based, inclusive).'
          };
        if (content === undefined)
          return { success: false, error: 'patch requires `content` (replacement lines).' };
        const kind = deriveKind(path);
        if (!kind) return { success: false, error: 'Unsupported kind for patch.' };

        const [row] = await db
          .select({ content: workspaceFiles.content, id: workspaceFiles.id })
          .from(workspaceFiles)
          .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, path)));
        if (!row) return { success: false, error: `File not found: ${path}` };

        const existing = row.content ?? '';
        const lineCount = existing.split('\n').length;
        if (looksLikeFullDocumentPatch(lineCount, startLine, endLine, content, kind)) {
          return {
            success: false,
            error: 'REJECTED: patch received a full document instead of a focused line range.',
            hint: 'Use `update` for full rewrites; `patch` is for narrow line edits.'
          };
        }

        const patched = applyLinePatch(existing, startLine, endLine, content);
        if (!patched.ok) return { success: false, error: patched.error, hint: patched.hint };

        if (kind === 'mermaid') {
          // Edge-preservation guard ported from legacy diagramPatch.
          const before = countMermaidEdgeLines(existing);
          const after = countMermaidEdgeLines(patched.next);
          if (before > 0 && after === 0) {
            return {
              success: false,
              error: 'REJECTED: patch would remove every connection from the existing diagram.',
              hint: 'Keep edges intact when patching styles or icons; only remove edges when explicitly asked.'
            };
          }
        }

        const validation = validateContentForKind(kind, patched.next);
        if (!validation.ok)
          return { success: false, error: validation.error, hint: validation.hint };

        await db
          .update(workspaceFiles)
          .set({ content: patched.next, updated_at: new Date() })
          .where(eq(workspaceFiles.id, row.id));
        return {
          endLine,
          file: {
            content: patched.next,
            id: row.id,
            kind,
            length: patched.next.length,
            path
          },
          insertedLineCount: patched.insertedLineCount,
          mode: 'patch',
          newLineCount: patched.newLineCount,
          replacedLineCount: patched.replacedLineCount,
          startLine,
          success: true
        };
      }

      if (operation === 'delete') {
        if (!path) return { success: false, error: 'delete requires `path`' };
        const result = await db
          .delete(workspaceFiles)
          .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, path)))
          .returning({ id: workspaceFiles.id });
        if (result.length === 0) return { success: false, error: `File not found: ${path}` };
        return { success: true, deleted: 1 };
      }

      if (operation === 'moveFolder') {
        if (!from || !to) return { success: false, error: 'moveFolder requires `from` and `to`' };
        const fromN = from.replace(/^\/+|\/+$/g, '');
        const toN = to.replace(/^\/+|\/+$/g, '');
        if (!FOLDER_RE.test(fromN) || !FOLDER_RE.test(toN))
          return { success: false, error: 'Invalid folder path' };
        if (fromN === toN) return { success: true, moved: 0 };
        const fromPrefix = `${fromN}/`;
        const toPrefix = `${toN}/`;
        const result = await db
          .update(workspaceFiles)
          .set({
            path: sql`${toPrefix} || substring(${workspaceFiles.path} from ${
              fromPrefix.length + 1
            })`,
            updated_at: new Date()
          })
          .where(
            and(eq(workspaceFiles.user_id, userId), like(workspaceFiles.path, `${fromPrefix}%`))
          )
          .returning({ id: workspaceFiles.id });
        return { success: true, moved: result.length };
      }

      if (operation === 'deleteFolder') {
        const folder = (path ?? '').replace(/^\/+|\/+$/g, '');
        if (!folder || !FOLDER_RE.test(folder))
          return { success: false, error: 'deleteFolder requires a valid `path`' };
        const prefix = `${folder}/`;
        const result = await db
          .delete(workspaceFiles)
          .where(and(eq(workspaceFiles.user_id, userId), like(workspaceFiles.path, `${prefix}%`)))
          .returning({ id: workspaceFiles.id });
        return { success: true, deleted: result.length };
      }

      return { success: false, error: `Unknown operation: ${operation}` };
    }
  });
}
