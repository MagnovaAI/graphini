import type { DiagramEngine } from '$lib/client/types/workspace';

const MERMAID_KEYWORDS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'gitGraph',
  'C4Context',
  'C4Container',
  'requirementDiagram',
  'quadrantChart',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'architecture-beta',
  'zenuml',
  'kanban',
  'packet-beta',
  'radar-beta'
];

export function detectEngine(source: string, fallback: DiagramEngine = 'mermaid'): DiagramEngine {
  const trimmed = source.trim();
  if (!trimmed) return fallback;

  // JSON: starts with { or [
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // not valid JSON, keep checking
    }
  }

  // Mermaid: first non-empty, non-comment line starts with a known directive
  const firstLine = trimmed.split('\n').find((l) => {
    const s = l.trim();
    return s && !s.startsWith('%%') && !s.startsWith('---');
  });
  if (firstLine) {
    const head = firstLine.trim().split(/\s+/)[0];
    if (MERMAID_KEYWORDS.includes(head)) return 'mermaid';
  }

  // YAML front-matter or key: value pairs
  if (trimmed.startsWith('---\n') || /^[A-Za-z_][\w-]*\s*:/m.test(trimmed)) {
    return 'yaml';
  }

  // Markdown heuristics: starts with #, *, -, or has ## header
  if (/^#{1,6}\s/m.test(trimmed) || /^\s*[-*+]\s/m.test(trimmed)) {
    return 'markdown';
  }

  return fallback;
}
