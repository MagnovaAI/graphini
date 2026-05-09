/**
 * Mermaid parser — parsing and the shared diagram-type list used by validation.
 * Browser-only: parse() lazy-loads the renderer module so icon packs, layout
 * loaders, and zenuml are registered before validation, keeping parse and
 * render in lockstep.
 */

import mermaid from 'mermaid';

// ── Shared diagram type list for validation ──────────────────────────────

const DIAGRAM_TYPES = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'gitgraph',
  'journey',
  'timeline',
  'quadrantChart',
  'mindmap',
  'architecture',
  'block',
  'packet',
  'network',
  'sankey',
  'requirement',
  'c4'
] as const;

export const DIAGRAM_TYPES_LOWER = DIAGRAM_TYPES.map((t) => t.toLowerCase());

// ── Parse ────────────────────────────────────────────────────────────────

/**
 * Apply the same pre-parse transform the renderer uses, so validation matches
 * what the canvas actually attempts to render.
 */
export const buildEnhancedCode = (code: string): string => {
  const trimmed = (code ?? '').trim();
  if (!trimmed) return '';
  const firstNonComment = trimmed
    .split('\n')
    .find((line) => !line.trim().startsWith('%%') && line.trim().length > 0);
  if (!firstNonComment) return trimmed;
  const firstLine = firstNonComment.trim().toLowerCase();
  const hasValidStart = DIAGRAM_TYPES_LOWER.some((type) => firstLine.startsWith(type));
  return hasValidStart ? trimmed : `flowchart TD\n${trimmed}`;
};

export const parse = async (code: string) => {
  // Skip parsing for empty diagrams
  if (!code || !code.trim()) {
    return { diagramType: 'flowchart' };
  }

  // Use the same code shape the renderer parses, so validation === render.
  // Importing the renderer registers icon packs, layout loaders, and zenuml,
  // and gives us the broken-icon-annotation stripper. Without the strip the
  // parser sees raw `Node@{ img: "broken-url" }` lines while the renderer
  // strips them — and the canvas reports "Diagram has syntax errors" on
  // diagrams that actually render fine.
  const { stripBrokenIconAnnotations } = await import('./mermaid-renderer');
  let enhancedCode = buildEnhancedCode(code);
  enhancedCode = await stripBrokenIconAnnotations(enhancedCode);

  // Suppress console.error/warn during mermaid.parse to eliminate noise
  const originalError = console.error;
  const originalWarn = console.warn;
  /* eslint-disable @typescript-eslint/no-empty-function */
  console.error = () => {};
  console.warn = () => {};
  /* eslint-enable @typescript-eslint/no-empty-function */

  try {
    return await mermaid.parse(enhancedCode);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
};
