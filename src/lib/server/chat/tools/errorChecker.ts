import { findMermaidDeclarations, validateSingleMermaidDocument } from '$lib/server/chat/mermaid';
import { tool } from 'ai';
import { z } from 'zod';
import { resolveMermaidTarget, type ToolContext } from './context';

// NOTE: We intentionally do NOT run `mermaid.parse` server-side.
//
// The renderer that draws the canvas registers icon packs, layout loaders,
// and external diagrams (zenuml). A JSDOM-backed `mermaid.parse` in Node
// does not, and reports diagrams as "valid" that the real renderer rejects
// with "Diagram has syntax errors". The client re-runs validation through
// the same pipeline as the renderer (see `mermaid-parser.ts`), so this
// tool returns structural checks plus the diagram content and lets the
// client be the source of truth.

export function createErrorCheckerTool({ target, userId }: ToolContext) {
  return tool({
    description:
      'Validate Mermaid diagram syntax. Pass `path` to target a specific .mermaid file; defaults to the active workspace file when omitted. Use this when the user reports rendering issues or after making complex edits.',
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe(
          'Path to the .mermaid file to validate. Defaults to the active workspace file when omitted; required when the active file is not a .mermaid.'
        )
    }),
    execute: async ({ path }) => {
      const resolved = await resolveMermaidTarget(target, userId, path);
      if (!resolved.ok) {
        return {
          errors: [],
          hint: resolved.hint,
          message: resolved.reason,
          success: true,
          valid: true
        };
      }
      const diagram = resolved.content;
      if (!diagram.trim()) {
        return {
          success: true,
          valid: true,
          errors: [],
          message: `No content in ${resolved.path} to validate`
        };
      }

      const errors: { line: number; message: string }[] = [];
      const pushError = (error: { line: number; message: string }) => {
        if (
          errors.some(
            (existing) => existing.line === error.line && existing.message === error.message
          )
        ) {
          return;
        }
        errors.push(error);
      };
      const lines = diagram.split('\n');
      const singleDocumentValidation = validateSingleMermaidDocument(diagram);
      if (!singleDocumentValidation.valid) {
        const declaration = findMermaidDeclarations(diagram)[1];
        pushError({
          line: declaration?.line ?? 1,
          message: `${singleDocumentValidation.error} ${singleDocumentValidation.hint}`
        });
      }

      // Basic syntax checks
      const firstLine = lines[0]?.trim() || '';
      const validStarts = [
        'graph',
        'flowchart',
        'sequenceDiagram',
        'classDiagram',
        'stateDiagram',
        'erDiagram',
        'gantt',
        'pie',
        'gitgraph',
        'mindmap',
        'timeline',
        'quadrantChart',
        'xychart',
        'block',
        'sankey',
        'packet',
        'kanban',
        'architecture'
      ];
      if (!validStarts.some((s) => firstLine.startsWith(s))) {
        pushError({
          line: 1,
          message: `Diagram must start with a valid type declaration (e.g. flowchart TD, sequenceDiagram)`
        });
      }

      // Detect diagram type for type-specific validation
      const diagramType = firstLine.split(/\s/)[0]?.toLowerCase() || '';

      // Diagram types that do NOT support style/classDef directives
      const noStyleTypes = [
        'mindmap',
        'timeline',
        'pie',
        'gantt',
        'gitgraph',
        'sequencediagram',
        'erdiagram',
        'sankey',
        'packet',
        'quadrantchart',
        'xychart',
        'journey'
      ];
      const supportsStyle = !noStyleTypes.includes(diagramType);

      // Check for style directives in diagram types that don't support them
      if (!supportsStyle) {
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (
            trimmed.startsWith('style ') ||
            trimmed.startsWith('classDef ') ||
            trimmed.startsWith('class ') ||
            trimmed.startsWith('linkStyle')
          ) {
            pushError({
              line: i + 1,
              message: `"${trimmed.split(' ')[0]}" directives are not supported in ${diagramType} diagrams. Remove this line.`
            });
          }
        }
      }

      // Check subgraph/end pairing (only for types that use subgraphs)
      if (['graph', 'flowchart', 'block'].includes(diagramType)) {
        let subgraphCount = 0;
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (trimmed.startsWith('subgraph ')) subgraphCount++;
          if (trimmed === 'end') subgraphCount--;
          if (subgraphCount < 0) {
            pushError({ line: i + 1, message: 'Unexpected "end" without matching subgraph' });
            subgraphCount = 0;
          }
        }
        if (subgraphCount > 0) {
          pushError({
            line: lines.length,
            message: `${subgraphCount} unclosed subgraph(s) — missing "end"`
          });
        }
      }

      // Check for common syntax issues
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.includes('-->') && trimmed.match(/-->\s*$/)) {
          pushError({ line: i + 1, message: 'Arrow "-->" has no target node' });
        }
        // Unmatched brackets (skip comment lines and style lines)
        if (
          !trimmed.startsWith('%%') &&
          !trimmed.startsWith('//') &&
          !trimmed.startsWith('style ')
        ) {
          const opens = (trimmed.match(/\[/g) || []).length;
          const closes = (trimmed.match(/\]/g) || []).length;
          if (opens !== closes) {
            pushError({ line: i + 1, message: 'Unmatched brackets [ ]' });
          }
        }
      }

      // Real syntax validation happens on the client through the same parse
      // pipeline the renderer uses; see Chat.simple.svelte.

      return {
        content: diagram,
        error: errors.length === 0 ? undefined : `Found ${errors.length} Mermaid syntax issue(s)`,
        errors,
        message:
          errors.length === 0 ? 'Diagram syntax looks valid' : `Found ${errors.length} issue(s)`,
        path: resolved.path,
        success: errors.length === 0,
        valid: errors.length === 0
      };
    }
  });
}
