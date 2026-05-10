/**
 * Unified `workspaceFiles` tool — single surface the model uses to read and edit
 * the user's workspace files (`.md`, `.json`, `.yaml`, `.mermaid`).
 *
 * Operations:
 *  - list           enumerate files (path, kind, updated_at)
 *  - read           full content of one file by path
 *  - create         new file with explicit path + content (duplicate/quota-checked)
 *  - edit           full rewrite or line-range SEARCH/REPLACE on an existing file
 *  - delete         remove one file
 *  - moveFolder     bulk-rename a subtree
 *  - deleteFolder   bulk-delete a subtree
 *
 * Guards (enforced server-side, returned as `error` on violation):
 *  - line-range `edit` requires a prior `read` of the same path in the same chat turn.
 *
 * Per-kind validation:
 *  - .mermaid → must be a single, valid Mermaid document; rejects content
 *    with markdown signals; preserves existing edges during line-range edits.
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
const MAX_READ_CONTENT_TOKENS = 50_000;
const MAX_READ_CONTENT_CHARS = MAX_READ_CONTENT_TOKENS * 4;

const MERMAID_EDGE_PATTERN = /(<-->|<-\.->|<==>|<---|-->|-\.->|==>|---|\.\.>|--x|--o)/;
type FileSystemOperation =
  | 'list'
  | 'read'
  | 'create'
  | 'edit'
  | 'delete'
  | 'moveFolder'
  | 'deleteFolder';

function inferOperation(input: {
  content?: string;
  from?: string;
  path?: string;
  startLine?: number;
  to?: string;
}): FileSystemOperation | undefined {
  if (input.from && input.to) return 'moveFolder';
  if (input.content !== undefined && input.path && input.startLine !== undefined) return 'edit';
  if (input.content !== undefined && input.path) return 'create';
  if (input.path) return 'read';
  return undefined;
}

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

function applyLineEdit(
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

function looksLikeFullDocumentLineEdit(
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

export function createFileSystemTool({ userId, workspaceFilesGuard }: ToolContext) {
  return tool({
    description: `Read and edit the user's workspace files. Single tool for all file operations.

Operations:
- list:         enumerate every file (path, kind, updated_at).
- read:         content of one file by path. Large files return a bounded preview unless \`startLine\`/\`endLine\` selects a smaller range. MUST be called before any line-range \`edit\`.
- create:       create a new file. Requires \`path\` ending in .md/.json/.yaml/.yml/.mermaid/.mmd, plus \`content\`. Duplicate/quota checks happen internally. Quota: 15 (guest) / 30 (signed-in).
- edit:         edit an existing file. With \`startLine\`/\`endLine\`, replaces that 1-based inclusive range; without line numbers, replaces the full file.
- delete:       remove one file by path.
- moveFolder:   rename every file under a folder prefix in one shot. Requires \`from\` and \`to\`.
- deleteFolder: delete every file under a folder prefix. Requires \`path\`.

Per-kind validation: .mermaid rejects markdown; .md rejects content starting with a Mermaid declaration; .json must parse; .yaml is stored as-is.`,
    inputSchema: z.object({
      content: z.string().optional(),
      endLine: z.number().int().min(1).optional(),
      from: z.string().optional(),
      operation: z
        .enum(['list', 'read', 'create', 'edit', 'delete', 'moveFolder', 'deleteFolder'])
        .optional(),
      path: z.string().optional(),
      startLine: z.number().int().min(1).optional(),
      to: z.string().optional()
    }),
    execute: async ({ operation, path, content, from, to, startLine, endLine }) => {
      operation = operation ?? inferOperation({ content, from, path, startLine, to });
      if (!operation) {
        return {
          success: false,
          error:
            'Missing `operation`. Use one of: list, read, create, edit, delete, moveFolder, deleteFolder.'
        };
      }
      if (operation === 'edit' && startLine !== undefined && endLine === undefined) {
        endLine = startLine;
      }
      if (!userId) {
        return { success: false, error: 'No user context — cannot use file system.' };
      }
      const db = drizzleDb();
      const guard: FileSystemTurnGuard = workspaceFilesGuard ?? {
        listed: false,
        readPaths: new Set()
      };

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
        const fullContent = row.content ?? '';
        const lines = fullContent.split('\n');
        const lineCount = lines.length;

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
          if (selected.length > MAX_READ_CONTENT_CHARS) {
            return {
              success: false,
              error: `Requested range is too large (${selected.length} characters). Read a smaller line range.`,
              file: {
                id: row.id,
                kind: row.kind,
                length: fullContent.length,
                lineCount,
                path: row.path
              }
            };
          }
          return {
            success: true,
            file: {
              ...row,
              content: selected,
              length: fullContent.length,
              lineCount,
              range: {
                endLine: Math.min(toLine, lineCount),
                startLine: fromLine
              }
            }
          };
        }

        if (fullContent.length > MAX_READ_CONTENT_CHARS) {
          return {
            success: true,
            file: {
              id: row.id,
              kind: row.kind,
              content: fullContent.slice(0, MAX_READ_CONTENT_CHARS),
              length: fullContent.length,
              lineCount,
              path: row.path,
              range: {
                endLine: fullContent.slice(0, MAX_READ_CONTENT_CHARS).split('\n').length,
                startLine: 1
              },
              truncated: true
            },
            hint: `File is too large to read in one tool call. Ask for a summary of this preview, or read a smaller range with startLine/endLine.`
          };
        }

        return {
          success: true,
          file: { ...row, length: fullContent.length, lineCount, truncated: false }
        };
      }

      if (operation === 'create') {
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
            error: `File already exists: ${path}. Use \`edit\` to modify it.`
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
          mode: 'create',
          quota: { used: count + 1, total: cap }
        };
      }

      if (operation === 'edit') {
        if (!path) return { success: false, error: 'edit requires `path`' };
        if (content === undefined) return { success: false, error: 'edit requires `content`' };
        const kind = deriveKind(path);
        if (!kind) return { success: false, error: 'Unsupported kind for edit.' };

        const [row] = await db
          .select({
            content: workspaceFiles.content,
            id: workspaceFiles.id,
            path: workspaceFiles.path
          })
          .from(workspaceFiles)
          .where(and(eq(workspaceFiles.user_id, userId), eq(workspaceFiles.path, path)));
        if (!row) {
          return {
            success: false,
            error: `File not found: ${path}. Use \`create\` to make a new one.`
          };
        }

        if (startLine === undefined && endLine === undefined) {
          const validation = validateContentForKind(kind, content);
          if (!validation.ok)
            return { success: false, error: validation.error, hint: validation.hint };

          await db
            .update(workspaceFiles)
            .set({ content, kind, updated_at: new Date() })
            .where(eq(workspaceFiles.id, row.id));
          return {
            success: true,
            file: {
              content,
              id: row.id,
              kind,
              length: content.length,
              path: row.path
            },
            mode: 'edit'
          };
        }

        if (!guard.readPaths.has(path)) {
          return {
            success: false,
            error: `REJECTED: call \`read\` for "${path}" before line-range \`edit\`. Line numbers must come from a fresh read.`,
            hint: 'workspaceFiles({operation: "read", path: "..."}) first, then retry edit.'
          };
        }
        if (startLine === undefined || endLine === undefined) {
          return {
            success: false,
            error: 'line-range edit requires `startLine` and `endLine` (1-based, inclusive).'
          };
        }

        const existing = row.content ?? '';
        const lineCount = existing.split('\n').length;
        if (looksLikeFullDocumentLineEdit(lineCount, startLine, endLine, content, kind)) {
          return {
            success: false,
            error: 'REJECTED: line-range edit received a full document instead of a focused range.',
            hint: 'Use `edit` without startLine/endLine for full rewrites.'
          };
        }

        const edited = applyLineEdit(existing, startLine, endLine, content);
        if (!edited.ok) return { success: false, error: edited.error, hint: edited.hint };

        if (kind === 'mermaid') {
          const before = countMermaidEdgeLines(existing);
          const after = countMermaidEdgeLines(edited.next);
          if (before > 0 && after === 0) {
            return {
              success: false,
              error:
                'REJECTED: line-range edit would remove every connection from the existing diagram.',
              hint: 'Keep edges intact when editing styles or icons; only remove edges when explicitly asked.'
            };
          }
        }

        const validation = validateContentForKind(kind, edited.next);
        if (!validation.ok)
          return { success: false, error: validation.error, hint: validation.hint };

        await db
          .update(workspaceFiles)
          .set({ content: edited.next, updated_at: new Date() })
          .where(eq(workspaceFiles.id, row.id));
        return {
          endLine,
          file: {
            content: edited.next,
            id: row.id,
            kind,
            length: edited.next.length,
            path
          },
          insertedLineCount: edited.insertedLineCount,
          mode: 'edit',
          newLineCount: edited.newLineCount,
          replacedLineCount: edited.replacedLineCount,
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
