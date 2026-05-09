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
  MERMAID_DIAGRAM_DECLARATION,
  parseMermaidNodes,
  validateSingleMermaidDocument
} from '$lib/server/chat/mermaid';
import { detectCodeLanguage, validateCodeArtifact } from '$lib/server/chat/code-artifacts';
import { instructionsForSubagent } from '$lib/server/chat/subagents';
import { tool } from 'ai';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { resolveIconForNode } from './icon-resolver';
import {
  targetMetadata,
  targetTabNameSchema,
  validateMermaidTarget,
  type ToolContext
} from './context';

const execFileAsync = promisify(execFile);

const markdownSignals = /^(#{1,6}\s|\*\*|__|\[.*\]\(.*\)|^>\s|^-{3,}$|^\*{3,}$|^```)/m;
const mermaidEdgePattern = /(<-->|<-\.->|<==>|<---|-->|-\.->|==>|---|\.\.>|--x|--o)/;

function normalizeMermaidToolContent(content: string): string {
  return content.replace(/\\n/g, '\n').replace(/\\"/g, '"');
}

function countMermaidEdgeLines(source: string): number {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.startsWith('%%')) return false;
      if (/^(classDef|class|style|linkStyle|subgraph|end)\b/i.test(line)) return false;
      return mermaidEdgePattern.test(line);
    }).length;
}

function isFullDocumentPatchAttempt(
  currentLineCount: number,
  startLine: number,
  endLine: number,
  replacement: string
) {
  const replacementLines = replacement.split('\n');
  const replacementStartsWithDeclaration = MERMAID_DIAGRAM_DECLARATION.test(replacement.trim());
  const replacementDeclarationCount = findMermaidDeclarations(replacement).length;
  const replacesEntireDocument =
    startLine === 1 && endLine === currentLineCount && currentLineCount > 1;
  const replacesMostDocument =
    currentLineCount >= 6 &&
    endLine - startLine + 1 >= Math.ceil(currentLineCount * 0.75) &&
    replacementLines.length >= Math.ceil(currentLineCount * 0.75);

  return (
    replacementStartsWithDeclaration &&
    replacementDeclarationCount > 0 &&
    (replacesEntireDocument || replacesMostDocument)
  );
}

export function applyDiagramLinePatch({
  content,
  diagram,
  endLine,
  startLine
}: {
  content: string;
  diagram: string;
  endLine: number;
  startLine: number;
}):
  | {
      content: string;
      insertedLineCount: number;
      newLineCount: number;
      previousLineCount: number;
      replacedLineCount: number;
      success: true;
    }
  | { error: string; hint?: string; success: false } {
  if (!diagram.trim()) {
    return {
      error: 'REJECTED: There is no existing Mermaid diagram to patch.',
      hint: 'Use diagramWrite to create a new diagram. Use diagramPatch only for edits to an existing diagram.',
      success: false
    };
  }

  if (startLine > endLine) {
    return { error: `startLine (${startLine}) cannot exceed endLine (${endLine})`, success: false };
  }

  const lines = diagram.split('\n');
  if (endLine > lines.length) {
    return {
      error: `endLine ${endLine} exceeds diagram length (${lines.length} lines)`,
      success: false
    };
  }

  const unescapedContent = normalizeMermaidToolContent(content);
  if (markdownSignals.test(unescapedContent)) {
    return {
      error:
        'REJECTED: Content appears to be markdown/documentation, not Mermaid diagram syntax. Use markdownWrite for documentation. Redo with valid Mermaid code only.',
      hint: 'diagramPatch only accepts Mermaid diagram syntax (graph, flowchart, sequenceDiagram, etc.)',
      success: false
    };
  }

  if (isFullDocumentPatchAttempt(lines.length, startLine, endLine, unescapedContent)) {
    return {
      error:
        'REJECTED: diagramPatch received a full Mermaid document instead of a focused line patch.',
      hint: 'Call diagramRead, then retry diagramPatch with only the changed line range and replacement lines. If the existing diagram starts with a bare subgraph, repair it with startLine: 1, endLine: 1, content: "flowchart TD\\n<existing first line>". Use diagramWrite only when the user explicitly asks for a full rewrite.',
      success: false
    };
  }

  const replacementLines = unescapedContent.split('\n');
  const nextLines = [...lines];
  nextLines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
  const newDiagram = nextLines.join('\n');
  const previousEdgeCount = countMermaidEdgeLines(diagram);
  const nextEdgeCount = countMermaidEdgeLines(newDiagram);
  if (previousEdgeCount > 0 && nextEdgeCount === 0) {
    return {
      error: 'REJECTED: diagramPatch would remove every connection from the existing diagram.',
      hint: 'Keep the existing edges when styling or adding icons. Patch only the relevant node, style, or icon lines unless the user explicitly asks to delete all relationships.',
      success: false
    };
  }

  const validation = validateSingleMermaidDocument(newDiagram);
  if (!validation.valid) {
    return {
      error: validation.error,
      hint: validation.hint,
      success: false
    };
  }

  return {
    content: newDiagram,
    insertedLineCount: replacementLines.length,
    newLineCount: nextLines.length,
    previousLineCount: lines.length,
    replacedLineCount: endLine - startLine + 1,
    success: true
  };
}

export function createDiagramPatchTool({ modelId, sessionId, target }: ToolContext) {
  return tool({
    description:
      'Apply a focused patch to the active Mermaid tab by replacing only the lines from startLine to endLine (1-based, inclusive). The content field must contain only the replacement lines, not the whole Mermaid document. ONLY Mermaid diagram syntax is allowed. Requires targetTabName to match the active Mermaid tab. Do NOT write markdown, JSON, YAML, documentation, or prose here. Use for SMALL LOCAL edits (≤ ~5 nodes changing, adding icons to specific nodes, restyling individual lines, fixing a typo). Requires exact line numbers from a recent diagramRead — if you are not sure of the line range, use diagramWrite with the full corrected document instead.',
    inputSchema: z.object({
      startLine: z.number().int().min(1).describe('1-based starting line number'),
      endLine: z.number().int().min(1).describe('1-based ending line number'),
      content: z
        .string()
        .describe(
          'Replacement Mermaid lines for the specified range only. Do not include the whole diagram unless you are replacing a single declaration line.'
        ),
      targetTabName: targetTabNameSchema
    }),
    execute: async ({ startLine, endLine, content, targetTabName }) => {
      const targetError = validateMermaidTarget(target, targetTabName);
      if (targetError) return targetError;

      const diagram = diagramStore.get(sessionId) || '';
      const patchResult = applyDiagramLinePatch({ content, diagram, endLine, startLine });
      if (!patchResult.success) return patchResult;

      diagramStore.set(sessionId, patchResult.content);

      return {
        ...targetMetadata(target, targetTabName),
        content: patchResult.content,
        insertedLineCount: patchResult.insertedLineCount,
        newLineCount: patchResult.newLineCount,
        previousLineCount: patchResult.previousLineCount,
        replacedLineCount: patchResult.replacedLineCount,
        success: true
      };
    }
  });
}
