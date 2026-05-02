/* eslint-disable @typescript-eslint/no-unused-vars */
import { deleteFile, getFileById, getSessionFiles } from '$lib/server/file-store';
import {
  codeStore,
  diagramStore,
  markdownStore,
  memoryStore,
  planStore,
  subagentStore
} from '$lib/server/chat/state';
import {
  buildDiagramReview,
  findMermaidDeclarations,
  parseMermaidNodes,
  validateSingleMermaidDocument
} from '$lib/server/chat/mermaid';
import { detectCodeLanguage, validateCodeArtifact } from '$lib/server/chat/code-artifacts';
import { openrouterFastChat } from '$lib/server/chat/model';
import { instructionsForSubagent } from '$lib/server/chat/subagents';
import { generateText, tool } from 'ai';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { resolveIconForNode } from './icon-resolver';

const execFileAsync = promisify(execFile);

interface ToolContext {
  modelId?: string;
  sessionId: string;
}

let parserInit: Promise<typeof import('mermaid').default> | null = null;

async function installDomGlobalsForMermaidParser() {
  if (typeof document !== 'undefined' && typeof window !== 'undefined') return;

  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const globals = {
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    SVGElement: dom.window.SVGElement,
    document: dom.window.document,
    navigator: dom.window.navigator,
    window: dom.window
  };

  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true
    });
  }
}

async function getMermaidParser() {
  parserInit ??= (async () => {
    await installDomGlobalsForMermaidParser();
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      securityLevel: 'loose',
      startOnLoad: false
    });
    return mermaid;
  })();

  return parserInit;
}

function parseErrorLine(message: string): number {
  const match = message.match(/line\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : 1;
}

function cleanParseErrorMessage(message: string): string {
  return message
    .replace(/\s+/g, ' ')
    .replace(/^Error:\s*/i, '')
    .trim();
}

export async function findMermaidSyntaxErrors(
  diagram: string
): Promise<{ line: number; message: string }[]> {
  if (!diagram.trim()) return [];

  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  console.error = () => undefined;
  console.warn = () => undefined;

  try {
    const mermaid = await getMermaidParser();
    await mermaid.parse(diagram);
    return [];
  } catch (error) {
    const message = cleanParseErrorMessage(
      error instanceof Error ? error.message : 'Invalid Mermaid syntax'
    );
    return [{ line: parseErrorLine(message), message }];
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
}

export function createErrorCheckerTool({ modelId, sessionId }: ToolContext) {
  return tool({
    description:
      'Validate the current Mermaid diagram syntax. Returns any syntax errors found. Use this when the user reports rendering issues or after making complex edits.',
    inputSchema: z.object({}),
    execute: async () => {
      const diagram = diagramStore.get(sessionId) || '';
      if (!diagram.trim()) {
        return { success: true, valid: true, errors: [], message: 'No diagram to validate' };
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

      const parserErrors = await findMermaidSyntaxErrors(diagram);
      for (const parserError of parserErrors) {
        pushError(parserError);
      }

      return {
        content: diagram,
        error: errors.length === 0 ? undefined : `Found ${errors.length} Mermaid syntax issue(s)`,
        errors,
        message:
          errors.length === 0 ? 'Diagram syntax looks valid' : `Found ${errors.length} issue(s)`,
        success: errors.length === 0,
        valid: errors.length === 0
      };
    }
  });
}
