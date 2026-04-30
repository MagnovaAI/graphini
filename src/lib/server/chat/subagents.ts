export function instructionsForSubagent(role: string): string {
  const base =
    'You are one specialist subagent in Graphini. Return concise, concrete output for your assignment. Do not claim you changed files or tools. Do not include hidden reasoning.';

  switch (role) {
    case 'planner':
      return `${base} Focus on decomposition, risks, and execution order.`;
    case 'diagram-engineer':
      return `${base} Focus on Mermaid architecture, entities, flows, and syntax risks.`;
    case 'visual-polish':
      return `${base} Focus on layout, grouping, labels, icons, and visual readability.`;
    case 'research-agent':
      return `${base} Focus on facts, relevant sources, and assumptions.`;
    case 'document-agent':
      return `${base} Focus on clear documentation structure and concise prose.`;
    case 'data-agent':
      return `${base} Focus on datasets, calculations, and chart-ready summaries.`;
    case 'critic':
      return `${base} Focus on bugs, missing requirements, edge cases, and verification.`;
    case 'code-agent':
      return `${base} Focus on implementable code changes and tests.`;
    default:
      return base;
  }
}
