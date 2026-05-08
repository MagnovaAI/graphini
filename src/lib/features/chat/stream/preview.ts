export const mermaidDeclarationPattern =
  /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|kanban|gitGraph|gitgraph|quadrantChart|xyChart|xychart|sankey|block|packet|architecture|C4Context|C4Container|C4Component|C4Deployment|requirementDiagram|zenuml)\b/i;

export function extractStreamingJsonNumber(inputJson: string, key: string): number | null {
  const match = inputJson.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
  return match ? Number(match[1]) : null;
}

export function buildDiagramPatchPreview(
  inputJson: string,
  replacement: string,
  previousCode: string
): string | null {
  const startLine = extractStreamingJsonNumber(inputJson, 'startLine');
  const endLine = extractStreamingJsonNumber(inputJson, 'endLine');
  if (!startLine || !endLine || startLine > endLine || !previousCode.trim()) return null;

  const lines = previousCode.split('\n');
  if (endLine > lines.length) return null;

  const replacementLines = replacement.split('\n');
  const replacingWholeDocument = startLine === 1 && endLine === lines.length && lines.length > 1;
  if (replacingWholeDocument && mermaidDeclarationPattern.test(replacement.trim())) return null;

  const nextLines = [...lines];
  nextLines.splice(startLine - 1, endLine - startLine + 1, ...replacementLines);
  return nextLines.join('\n');
}
