/**
 * Mermaid parser — parsing and the shared diagram-type list used by validation.
 * No DOM dependency; safe for SSR or web-worker use.
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

export const parse = async (code: string) => {
  // Skip parsing for empty diagrams
  if (!code || !code.trim()) {
    return { diagramType: 'flowchart' };
  }

  // Suppress console.error/warn during mermaid.parse to eliminate noise
  const originalError = console.error;
  const originalWarn = console.warn;
  /* eslint-disable @typescript-eslint/no-empty-function */
  console.error = () => {};
  console.warn = () => {};
  /* eslint-enable @typescript-eslint/no-empty-function */

  try {
    return await mermaid.parse(code);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
};
