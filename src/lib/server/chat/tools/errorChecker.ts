import {
  findMermaidDeclarations,
  validateMermaidSyntaxServer,
  validateSingleMermaidDocument
} from '$lib/server/chat/mermaid';
import { tool } from 'ai';
import { z } from 'zod';
import { resolveMermaidTarget, type ToolContext } from './context';

// NOTE: The browser renderer remains the final source of truth.
//
// The renderer that draws the canvas registers icon packs, layout loaders,
// and external diagrams (zenuml). A JSDOM-backed `mermaid.parse` in Node can
// miss renderer-specific failures, so the client still re-runs validation
// through the canvas pipeline (see `mermaid-parser.ts`). Server-side parse
// failures are still authoritative enough to return to the model; otherwise
// it sees a successful tool result and may claim completion while the UI shows
// a parse error.

const DARK_MODE_TEXT_COLOR = '#f1f5f9';
const MIN_TEXT_CONTRAST_RATIO = 4.5;
const MIN_SUBGRAPH_FILL_CONTRAST_RATIO = 1.3;

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  blue: '#0000ff',
  cyan: '#00ffff',
  gray: '#808080',
  green: '#008000',
  grey: '#808080',
  orange: '#ffa500',
  purple: '#800080',
  red: '#ff0000',
  transparent: '#000000',
  white: '#ffffff',
  yellow: '#ffff00'
};

function parseCssProperties(raw: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const part of raw.split(',')) {
    const [rawKey, ...rawValue] = part.split(':');
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue.join(':').trim().replace(/;$/, '');
    if (key && value) properties[key] = value;
  }
  return properties;
}

function parseColor(value: string): [number, number, number] | null {
  const normalized = value.trim().toLowerCase();
  const named = NAMED_COLORS[normalized];
  const color = named ?? normalized;
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1];
    const expanded =
      raw.length === 3
        ? raw
            .split('')
            .map((ch) => ch + ch)
            .join('')
        : raw;
    return [
      Number.parseInt(expanded.slice(0, 2), 16),
      Number.parseInt(expanded.slice(2, 4), 16),
      Number.parseInt(expanded.slice(4, 6), 16)
    ];
  }
  const rgb = color.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]].map((channel) =>
      Math.max(0, Math.min(255, Number.parseInt(channel, 10)))
    ) as [number, number, number];
  }
  return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const light = Math.max(relativeLuminance(a), relativeLuminance(b));
  const dark = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (light + 0.05) / (dark + 0.05);
}

function styleDeclaration(line: string): { label: string; props: string } | null {
  const trimmed = line.trim();
  const style = trimmed.match(/^style\s+([^\s]+)\s+(.+)$/i);
  if (style) return { label: `style ${style[1]}`, props: style[2] };
  const classDef = trimmed.match(/^classDef\s+([^\s]+)\s+(.+)$/i);
  if (classDef) return { label: `classDef ${classDef[1]}`, props: classDef[2] };
  return null;
}

function fillColorFromProperties(properties: Record<string, string>): string | undefined {
  const fill = properties.fill || properties['background-color'] || properties.background;
  if (!fill || fill === 'none' || fill.startsWith('url(')) return undefined;
  return fill;
}

function parseSubgraphDeclaration(
  line: string
): { id: string; label: string; lineText: string } | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^subgraph\s+([^\s[]+)(?:\s*\[(.+?)\])?/i);
  if (!match) return null;
  const id = match[1].replace(/^["']|["']$/g, '');
  const label = (match[2] || id).replace(/^["']|["']$/g, '');
  return { id, label, lineText: trimmed };
}

function collectStyleData(lines: string[]): {
  classAssignments: Map<string, string[]>;
  classDefs: Map<string, Record<string, string>>;
  styles: Map<string, Record<string, string>>;
} {
  const styles = new Map<string, Record<string, string>>();
  const classDefs = new Map<string, Record<string, string>>();
  const classAssignments = new Map<string, string[]>();

  for (const line of lines) {
    const trimmed = line.trim();
    const style = trimmed.match(/^style\s+([^\s]+)\s+(.+)$/i);
    if (style) {
      styles.set(style[1], parseCssProperties(style[2]));
      continue;
    }

    const classDef = trimmed.match(/^classDef\s+([^\s]+)\s+(.+)$/i);
    if (classDef) {
      classDefs.set(classDef[1], parseCssProperties(classDef[2]));
      continue;
    }

    const classLine = trimmed.match(/^class\s+(.+?)\s+([^\s;]+)\s*;?$/i);
    if (classLine) {
      const className = classLine[2];
      for (const id of classLine[1].split(',')) {
        const cleanId = id.trim();
        if (!cleanId) continue;
        classAssignments.set(cleanId, [...(classAssignments.get(cleanId) ?? []), className]);
      }
    }
  }

  return { classAssignments, classDefs, styles };
}

function contrastWarningsForDarkMode(
  lines: string[]
): { line: number; message: string; contrastRatio?: number }[] {
  const warnings: { line: number; message: string; contrastRatio?: number }[] = [];
  const defaultText = parseColor(DARK_MODE_TEXT_COLOR);
  if (!defaultText) return warnings;

  for (let i = 0; i < lines.length; i++) {
    const declaration = styleDeclaration(lines[i]);
    if (!declaration) continue;
    const properties = parseCssProperties(declaration.props);
    const fillValue = fillColorFromProperties(properties);
    if (!fillValue) continue;
    const fill = parseColor(fillValue);
    if (!fill) continue;
    const textValue = properties.color || DARK_MODE_TEXT_COLOR;
    const text = parseColor(textValue);
    if (!text) continue;
    const ratio = contrastRatio(fill, text);
    if (ratio < MIN_TEXT_CONTRAST_RATIO) {
      warnings.push({
        contrastRatio: Number(ratio.toFixed(2)),
        line: i + 1,
        message: `${declaration.label} has low dark-mode text contrast (${ratio.toFixed(2)}:1) between fill ${fillValue} and text ${textValue}. Use a darker fill with light text or a lighter fill with dark text.`
      });
    }
  }
  return warnings;
}

function subgraphColorWarnings(
  lines: string[]
): { line: number; message: string; contrastRatio?: number }[] {
  interface SubgraphInfo {
    color?: [number, number, number];
    colorValue?: string;
    id: string;
    label: string;
    line: number;
    parentId?: string;
  }

  const { classAssignments, classDefs, styles } = collectStyleData(lines);
  const subgraphs: SubgraphInfo[] = [];
  const stack: SubgraphInfo[] = [];

  const fillForSubgraph = (id: string): string | undefined => {
    const directFill = fillColorFromProperties(styles.get(id) ?? {});
    if (directFill) return directFill;

    for (const className of classAssignments.get(id) ?? []) {
      const classFill = fillColorFromProperties(classDefs.get(className) ?? {});
      if (classFill) return classFill;
    }
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const declaration = parseSubgraphDeclaration(lines[i]);
    if (declaration) {
      const colorValue = fillForSubgraph(declaration.id);
      const info: SubgraphInfo = {
        color: colorValue ? (parseColor(colorValue) ?? undefined) : undefined,
        colorValue,
        id: declaration.id,
        label: declaration.label,
        line: i + 1,
        parentId: stack.at(-1)?.id
      };
      subgraphs.push(info);
      stack.push(info);
      continue;
    }

    if (lines[i].trim() === 'end') stack.pop();
  }

  const warnings: { line: number; message: string; contrastRatio?: number }[] = [];
  const warned = new Set<string>();
  const warn = (a: SubgraphInfo, b: SubgraphInfo, relationship: string, ratio: number) => {
    const key = [a.id, b.id, relationship].sort().join('|');
    if (warned.has(key)) return;
    warned.add(key);
    const identical = a.colorValue?.toLowerCase() === b.colorValue?.toLowerCase();
    warnings.push({
      contrastRatio: Number(ratio.toFixed(2)),
      line: b.line,
      message: `${relationship} subgraphs "${a.label}" (line ${a.line}) and "${b.label}" (line ${b.line}) use ${identical ? 'the same' : 'very similar'} fill colors (${a.colorValue} vs ${b.colorValue}, contrast ${ratio.toFixed(2)}:1). Use distinct subgraph fills or stronger borders so overlapping groups remain separable.`
    });
  };

  for (let i = 0; i < subgraphs.length; i++) {
    const current = subgraphs[i];
    if (!current.color) continue;

    const parent = subgraphs.find((candidate) => candidate.id === current.parentId);
    if (parent?.color) {
      const ratio = contrastRatio(parent.color, current.color);
      if (ratio < MIN_SUBGRAPH_FILL_CONTRAST_RATIO) warn(parent, current, 'Nested', ratio);
    }

    for (let j = 0; j < i; j++) {
      const previous = subgraphs[j];
      if (!previous.color || previous.parentId !== current.parentId) continue;
      const ratio = contrastRatio(previous.color, current.color);
      if (ratio < MIN_SUBGRAPH_FILL_CONTRAST_RATIO) warn(previous, current, 'Sibling', ratio);
    }
  }

  return warnings;
}

export function createErrorCheckerTool({ target, userId }: ToolContext) {
  return tool({
    description:
      'Validate Mermaid diagram syntax and dark-mode color contrast. Pass `path` to target a specific .mermaid file; defaults to the active workspace file when omitted. Use this when the user reports rendering issues or after making complex edits. Skip when the editor is empty — there is nothing to check.',
    inputSchema: z.object({
      path: z
        .string()
        .optional()
        .describe(
          'Path to the .mermaid file to validate. Defaults to the active workspace file when omitted; required when the active file is not a .mermaid.'
        ),
      themeMode: z
        .enum(['light', 'dark'])
        .optional()
        .default('dark')
        .describe(
          'Theme mode to validate visual contrast against. Dark mode enables color contrast warnings.'
        )
    }),
    execute: async ({ path, themeMode = 'dark' }) => {
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
      const warnings: { line: number; message: string; contrastRatio?: number }[] = [];
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
      warnings.push(...subgraphColorWarnings(lines));
      if (themeMode === 'dark') {
        warnings.push(...contrastWarningsForDarkMode(lines));
      }
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

      const parserValidation = await validateMermaidSyntaxServer(diagram);
      if (!parserValidation.valid) {
        pushError(parserValidation.error);
      }

      return {
        content: diagram,
        error: errors.length === 0 ? undefined : `Found ${errors.length} Mermaid syntax issue(s)`,
        errors,
        message:
          errors.length === 0
            ? warnings.length === 0
              ? 'Diagram syntax looks valid'
              : `Diagram syntax looks valid with ${warnings.length} contrast warning(s)`
            : `Found ${errors.length} issue(s)`,
        path: resolved.path,
        success: errors.length === 0,
        themeMode,
        valid: errors.length === 0,
        warning: warnings.length === 0 ? undefined : `Found ${warnings.length} visual warning(s)`,
        warnings
      };
    }
  });
}
