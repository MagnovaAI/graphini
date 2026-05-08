/**
 * Mermaid parser — parsing, syntax detection, validation, sample diagrams.
 * No DOM dependency; safe for SSR or web-worker use.
 */

import { diagramData } from '@mermaid-js/examples';
import mermaid from 'mermaid';

// ── Shared diagram type list for validation ──────────────────────────────

export const DIAGRAM_TYPES = [
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

// ── Standardize diagram type ─────────────────────────────────────────────

export const standardizeDiagramType = (diagramType: string) => {
  switch (diagramType) {
    case 'class':
    case 'classDiagram': {
      return 'classDiagram';
    }
    case 'graph':
    case 'flowchart':
    case 'flowchart-elk':
    case 'flowchart-v2': {
      return 'flowchart';
    }
    default: {
      return diagramType;
    }
  }
};

// ── Sample diagrams ──────────────────────────────────────────────────────

type DiagramDefinition = (typeof diagramData)[number];

const isValidDiagram = (diagram: DiagramDefinition): diagram is Required<DiagramDefinition> => {
  return Boolean(diagram.name && diagram.examples && diagram.examples.length > 0);
};

export const getSampleDiagrams = () => {
  const diagrams = diagramData
    .filter((d) => isValidDiagram(d))
    .map(({ examples, ...rest }) => ({
      ...rest,
      example: examples?.filter(({ isDefault }) => isDefault)[0]
    }));
  const examples: Record<string, string> = {};
  for (const diagram of diagrams) {
    examples[diagram.name.replace(/ (Diagram|Chart|Graph)/, '')] = diagram.example.code;
  }
  return examples;
};
