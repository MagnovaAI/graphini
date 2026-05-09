/**
 * Shared content validator for workspace files.
 *
 * Used by:
 *  - the chat tool path (src/lib/server/chat/tools/fileSystem.ts) where
 *    the model creates / patches files via tool calls
 *  - the REST API (src/routes/api/workspace-files/*) where the client
 *    creates / updates files directly
 *
 * Both paths must enforce the same contract or files saved through one
 * surface render incorrectly through the other (e.g. markdown stored as
 * .mermaid, raw mermaid stored as .md).
 *
 * Validation per kind:
 *   .mermaid   rejects markdown formatting; runs full Mermaid parse.
 *   .md        rejects content that starts with a Mermaid diagram
 *              declaration (looks like a misfiled .mermaid).
 *   .json      must JSON.parse cleanly.
 *   .yaml/.yml stored as-is (no bundled parser).
 *
 * Empty content is accepted for every kind so callers can write the file
 * and fill it in subsequent updates.
 */

import {
  MERMAID_DIAGRAM_DECLARATION,
  validateSingleMermaidDocument
} from '$lib/server/chat/mermaid';
import type { FileKind } from '$lib/server/workspace-paths';

const MARKDOWN_SIGNALS = /^(#{1,6}\s|\*\*|__|\[.*\]\(.*\)|^>\s|^-{3,}$|^\*{3,}$|^```)/m;

export type WorkspaceContentValidation = { ok: true } | { ok: false; error: string; hint?: string };

export function validateContentForKind(
  kind: FileKind,
  content: string
): WorkspaceContentValidation {
  if (kind === 'mermaid') {
    const trimmed = content.trim();
    if (!trimmed) return { ok: true };
    if (MARKDOWN_SIGNALS.test(trimmed)) {
      return {
        error:
          'REJECTED: .mermaid content contains markdown formatting. Save markdown to a .md file instead.',
        hint: 'Mermaid files only accept diagram syntax (graph/flowchart/sequenceDiagram/...).',
        ok: false
      };
    }
    const v = validateSingleMermaidDocument(trimmed);
    if (!v.valid) return { error: v.error ?? 'Invalid Mermaid', hint: v.hint, ok: false };
    return { ok: true };
  }
  if (kind === 'md') {
    const trimmed = content.trim();
    if (!trimmed) return { ok: true };
    if (MERMAID_DIAGRAM_DECLARATION.test(trimmed)) {
      return {
        error: 'REJECTED: .md content starts with a Mermaid diagram declaration.',
        hint: 'Save diagram code to a .mermaid file. Use .md for prose only.',
        ok: false
      };
    }
    return { ok: true };
  }
  if (kind === 'json') {
    if (!content.trim()) return { ok: true };
    try {
      JSON.parse(content);
      return { ok: true };
    } catch (err) {
      return {
        error: `REJECTED: .json failed to parse: ${err instanceof Error ? err.message : String(err)}`,
        ok: false
      };
    }
  }
  // yaml: no bundled parser, accept as-is.
  return { ok: true };
}
