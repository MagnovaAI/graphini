/**
 * Diagram ↔ Code Element Mapper
 *
 * Maps SVG element IDs (from rendered Mermaid diagrams) to their corresponding
 * code-level node/edge identifiers. Provides utilities to inject or remove
 * properties (icons, styles, shapes) into the Mermaid source code.
 */

/**
 * Extract the short mermaid node name from an SVG element ID.
 * Mermaid generates IDs like "flowchart-NodeName-0", "flowchart-A-12", etc.
 */
export function svgIdToNodeName(svgId: string): string {
  if (!svgId) return '';

  // Pattern: "flowchart-<NodeName>-<index>"
  const flowchartMatch = svgId.match(/^flowchart-(.+?)-\d+$/);
  if (flowchartMatch) return flowchartMatch[1];

  // Pattern: "<prefix>-<NodeName>-<index>" (sequence, state, etc.)
  const genericMatch = svgId.match(/^[a-zA-Z]+-(.+?)-\d+$/);
  if (genericMatch) return genericMatch[1];

  // If it looks like a raw node name already (no dashes with trailing number)
  if (/^\w+$/.test(svgId)) return svgId;

  // Fallback: return as-is
  return svgId;
}

/**
 * Find the line in the code where a node is first defined.
 * Returns { lineIndex, line, indent } or null.
 */
export function findNodeDefinition(
  code: string,
  nodeName: string
): { lineIndex: number; line: string; indent: string } | null {
  const lines = code.split('\n');
  // Match node definitions like: A["Label"], B(Label), C{Label}, D>Label], E((Label))
  // Also matches bare node references like: A --> B (we want the first occurrence)
  const defRegex = new RegExp(
    `^(\\s*)${escapeRegex(nodeName)}(?:\\s*(?:\\[|\\(|\\{|\\>|@|\\[\\[|\\(\\(|\\{\\{)|\\s*-->|\\s*---|\\s*-\\.->|\\s*==>|\\s*$)`,
    'm'
  );

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(defRegex);
    if (match) {
      return { lineIndex: i, line: lines[i], indent: match[1] || '    ' };
    }
  }
  return null;
}

/**
 * Inject an @{ icon: "..." } line after a node definition.
 * Removes any existing icon line for that node first.
 */
export function injectNodeIcon(code: string, nodeName: string, iconId: string): string {
  // Remove existing icon line for this node
  code = removeNodeIcon(code, nodeName);

  const def = findNodeDefinition(code, nodeName);
  if (!def) {
    // Fallback: append at end
    return code.trimEnd() + `\n    ${nodeName}@{ icon: "${iconId}" }\n`;
  }

  const lines = code.split('\n');
  const iconLine = `${def.indent}${nodeName}@{ icon: "${iconId}" }`;
  lines.splice(def.lineIndex + 1, 0, iconLine);
  return lines.join('\n');
}

/**
 * Remove any @{ icon: ... } line for a given node.
 */
export function removeNodeIcon(code: string, nodeName: string): string {
  const regex = new RegExp(`\\n\\s*${escapeRegex(nodeName)}@\\{\\s*icon:\\s*"[^"]*"\\s*\\}`, 'g');
  return code.replace(regex, '');
}

/**
 * Inject or update a `style NodeName ...` line in the code.
 * Merges new props with any existing style line for the same node.
 */
export function injectNodeStyle(
  code: string,
  nodeName: string,
  styleProps: {
    fill?: string;
    stroke?: string;
    strokeWidth?: string;
    color?: string;
    fontSize?: string;
    fontFamily?: string;
  }
): string {
  const escaped = escapeRegex(nodeName);
  const existingRegex = new RegExp(`^(\\s*)style\\s+${escaped}\\s+(.+)$`, 'm');
  const existingMatch = code.match(existingRegex);

  // Parse existing props into a map
  const propMap = new Map<string, string>();
  if (existingMatch) {
    for (const part of existingMatch[2].split(',')) {
      const [k, ...v] = part.split(':');
      if (k && v.length) propMap.set(k.trim(), v.join(':').trim());
    }
  }

  // Merge new props
  if (styleProps.fill) propMap.set('fill', styleProps.fill);
  if (styleProps.stroke) propMap.set('stroke', styleProps.stroke);
  if (styleProps.strokeWidth) propMap.set('stroke-width', styleProps.strokeWidth);
  if (styleProps.color) propMap.set('color', styleProps.color);
  if (styleProps.fontSize) propMap.set('font-size', styleProps.fontSize);
  if (styleProps.fontFamily) propMap.set('font-family', styleProps.fontFamily);

  if (propMap.size === 0) return code;

  const styleLine = `    style ${nodeName} ${Array.from(propMap.entries())
    .map(([k, v]) => `${k}:${v}`)
    .join(',')}`;

  if (existingMatch) {
    return code.replace(existingRegex, styleLine);
  }
  return code.trimEnd() + '\n' + styleLine;
}

/**
 * Inject or update a `linkStyle <index> ...` line for an edge.
 * Merges new props with any existing linkStyle for the same index.
 */
export function injectEdgeStyle(
  code: string,
  edgeIndex: number,
  styleProps: {
    stroke?: string;
    strokeWidth?: string;
    strokeDasharray?: string;
  }
): string {
  const existingRegex = new RegExp(`^(\\s*)linkStyle\\s+${edgeIndex}\\s+(.+)$`, 'm');
  const existingMatch = code.match(existingRegex);

  const propMap = new Map<string, string>();
  if (existingMatch) {
    for (const part of existingMatch[2].split(',')) {
      const [k, ...v] = part.split(':');
      if (k && v.length) propMap.set(k.trim(), v.join(':').trim());
    }
  }

  // linkStyle only supports stroke-related SVG properties
  if (styleProps.stroke) propMap.set('stroke', styleProps.stroke);
  if (styleProps.strokeWidth) propMap.set('stroke-width', styleProps.strokeWidth);
  if (styleProps.strokeDasharray) propMap.set('stroke-dasharray', styleProps.strokeDasharray);

  if (propMap.size === 0) return code;

  const styleLine = `    linkStyle ${edgeIndex} ${Array.from(propMap.entries())
    .map(([k, v]) => `${k}:${v}`)
    .join(',')}`;

  if (existingMatch) {
    return code.replace(existingRegex, styleLine);
  }
  return code.trimEnd() + '\n' + styleLine + '\n';
}

/**
 * Inject or update a `style SubgraphId ...` line for a subgraph.
 * Border color is auto-derived from fill at 100% opacity.
 */
export function injectSubgraphStyle(
  code: string,
  subgraphId: string,
  styleProps: {
    fill?: string;
    stroke?: string;
    strokeDasharray?: string;
    color?: string;
    fontSize?: string;
    fontFamily?: string;
  }
): string {
  const escaped = escapeRegex(subgraphId);
  const existingRegex = new RegExp(`^(\\s*)style\\s+${escaped}\\s+(.+)$`, 'm');
  const existingMatch = code.match(existingRegex);

  const propMap = new Map<string, string>();
  if (existingMatch) {
    for (const part of existingMatch[2].split(',')) {
      const [k, ...v] = part.split(':');
      if (k && v.length) propMap.set(k.trim(), v.join(':').trim());
    }
  }

  if (styleProps.fill) {
    propMap.set('fill', styleProps.fill + 'CC');
    propMap.set('stroke', styleProps.fill);
    propMap.set('stroke-width', '2px');
    propMap.set('stroke-dasharray', '0');
  }
  if (styleProps.stroke) propMap.set('stroke', styleProps.stroke);
  if (styleProps.strokeDasharray !== undefined) {
    if (styleProps.strokeDasharray) {
      propMap.set('stroke-dasharray', styleProps.strokeDasharray);
    } else {
      propMap.delete('stroke-dasharray');
    }
  }
  if (styleProps.color) propMap.set('color', styleProps.color);
  if (styleProps.fontSize) propMap.set('font-size', styleProps.fontSize);
  if (styleProps.fontFamily) propMap.set('font-family', styleProps.fontFamily);

  if (propMap.size === 0) return code;

  const styleLine = `    style ${subgraphId} ${Array.from(propMap.entries())
    .map(([k, v]) => `${k}:${v}`)
    .join(',')}`;

  if (existingMatch) {
    return code.replace(existingRegex, styleLine);
  }
  return code.trimEnd() + '\n' + styleLine;
}

/**
 * Find the subgraph definition line and extract its ID.
 * Handles: subgraph ID["Title"], subgraph ID[Title], subgraph ID
 */
export function findSubgraphDefinition(
  code: string,
  subgraphIdOrLabel: string
): { lineIndex: number; subgraphId: string; title: string; indent: string } | null {
  const lines = code.split('\n');
  const cleaned = cleanSubgraphId(subgraphIdOrLabel);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('subgraph')) continue;
    const match = trimmed.match(/^subgraph\s+(\S+)(?:\s*\[(.+?)\])?/);
    if (!match) continue;
    const id = match[1];
    const title = match[2] || id;
    if (id === cleaned || title === subgraphIdOrLabel || id === subgraphIdOrLabel) {
      const indent = lines[i].match(/^(\s*)/)?.[1] || '    ';
      return { lineIndex: i, subgraphId: id, title, indent };
    }
  }
  return null;
}

/**
 * Clean a subgraph ID from SVG element references.
 */
function cleanSubgraphId(raw: string): string {
  return raw
    .replace(/^flowchart-/, '')
    .replace(/^stateDiagram-/, '')
    .replace(/^classDiagram-/, '')
    .replace(/-\d+$/, '');
}

/**
 * Change the arrow type on a specific edge line.
 * Supports: --> (arrow), --- (no arrow), -.-> (dashed arrow), ==> (thick arrow),
 *           <--> (bidirectional), <--- (reverse no arrow), <-.-> (reverse dashed)
 */
export function changeEdgeArrow(
  code: string,
  edgeIndex: number,
  arrowType: '-->' | '---' | '-.->' | '==>' | '<-->' | '<---'
): string {
  const edgePattern = /(<-->|<-\.->|<==>|<---|-->|-\.->|==>|---)/;
  const lines = code.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (
      edgePattern.test(lines[i]) &&
      !lines[i].trim().startsWith('%%') &&
      !lines[i].trim().startsWith('style') &&
      !lines[i].trim().startsWith('linkStyle')
    ) {
      if (count === edgeIndex) {
        lines[i] = lines[i].replace(edgePattern, arrowType);
        break;
      }
      count++;
    }
  }
  return lines.join('\n');
}

/**
 * Update the label text on a specific edge.
 */
export function changeEdgeLabel(code: string, edgeIndex: number, label: string): string {
  const edgePattern = /(<-->|<-\.->|<==>|<---|-->|-\.->|==>|---)/;
  const lines = code.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (
      edgePattern.test(lines[i]) &&
      !lines[i].trim().startsWith('%%') &&
      !lines[i].trim().startsWith('style') &&
      !lines[i].trim().startsWith('linkStyle')
    ) {
      if (count === edgeIndex) {
        if (label.trim()) {
          lines[i] = lines[i].replace(
            /(<-->|<-\.->|<==>|<---|-->|-\.->|==>|---)(\|[^|]*\|)?/,
            `$1|${label}|`
          );
        } else {
          lines[i] = lines[i].replace(/(\|[^|]*\|)/, '');
        }
        break;
      }
      count++;
    }
  }
  return lines.join('\n');
}

/**
 * Read the label text of the Nth edge (0-indexed) in the code.
 * Returns the label string or empty string if no label.
 */
export function getEdgeLabelText(code: string, edgeIndex: number): string {
  const edgePattern = /(<-->|<-\.->|<==>|<---|-->|-\.->|==>|---)/;
  const lines = code.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (
      edgePattern.test(lines[i]) &&
      !lines[i].trim().startsWith('%%') &&
      !lines[i].trim().startsWith('style') &&
      !lines[i].trim().startsWith('linkStyle')
    ) {
      if (count === edgeIndex) {
        const labelMatch = lines[i].match(/(?:<-->|<-\.->|<==>|<---|-->|-\.->|==>|---)\|([^|]*)\|/);
        return labelMatch ? labelMatch[1] : '';
      }
      count++;
    }
  }
  return '';
}

/**
 * Font size presets for text styling.
 */
export const TEXT_SIZE_MAP = {
  sm: '11px',
  md: '14px',
  lg: '18px'
} as const;

/**
 * Font family presets.
 */
export const FONT_MAP = {
  sans: 'sans-serif',
  serif: 'serif',
  mono: 'monospace'
} as const;

/**
 * Edge thickness presets.
 */
export const EDGE_THICKNESS_MAP = {
  thin: '1px',
  normal: '2px',
  thick: '4px'
} as const;

/**
 * Read existing linkStyle properties for a given edge index.
 * Returns a map of CSS property → value, or null if no linkStyle exists.
 */
export function getEdgeStyle(code: string, edgeIndex: number): Map<string, string> | null {
  const regex = new RegExp(`^\\s*linkStyle\\s+${edgeIndex}\\s+(.+)$`, 'm');
  const match = code.match(regex);
  if (!match) return null;
  const propMap = new Map<string, string>();
  for (const part of match[1].split(',')) {
    const [k, ...v] = part.split(':');
    if (k && v.length) propMap.set(k.trim(), v.join(':').trim());
  }
  return propMap;
}

/**
 * Get the arrow type of the Nth edge (0-indexed) in the code.
 * Returns the arrow syntax string or null.
 */
export function getEdgeArrowType(code: string, edgeIndex: number): string | null {
  const arrowPatterns = ['<-->', '<---', '==>', '-.->', '-->', '---'];
  const edgeRegex = new RegExp(
    `(?:^|\\n)\\s*\\S+\\s*(${arrowPatterns.map((a) => escapeRegex(a)).join('|')})`,
    'g'
  );
  let idx = 0;
  let match;
  while ((match = edgeRegex.exec(code)) !== null) {
    // Skip lines that are linkStyle, style, classDef, subgraph, end, or comments
    const line = code.substring(
      code.lastIndexOf('\n', match.index) + 1,
      code.indexOf('\n', match.index + 1)
    );
    if (/^\s*(linkStyle|style|classDef|subgraph|end|%%)/.test(line)) continue;
    if (idx === edgeIndex) return match[1];
    idx++;
  }
  return null;
}

/**
 * Inject an @{ img: "...", pos: "b", w: 60, h: 60, constraint: "on" } line after a node definition.
 * Removes any existing img line for that node first.
 */
export function injectNodeImg(
  code: string,
  nodeName: string,
  imgUrl: string,
  _label?: string
): string {
  // Remove existing img line for this node
  code = removeNodeImg(code, nodeName);

  const def = findNodeDefinition(code, nodeName);
  if (!def) {
    // Fallback: append at end
    return (
      code.trimEnd() +
      `\n    ${nodeName}@{ img: "${imgUrl}", pos: "b", w: 60, h: 60, constraint: "on" }\n`
    );
  }

  const lines = code.split('\n');
  const imgLine = `${def.indent}${nodeName}@{ img: "${imgUrl}", pos: "b", w: 60, h: 60, constraint: "on" }`;
  lines.splice(def.lineIndex + 1, 0, imgLine);
  return lines.join('\n');
}

/**
 * Remove any @{ img: ... } line for a given node.
 */
export function removeNodeImg(code: string, nodeName: string): string {
  const regex = new RegExp(`\\n\\s*${escapeRegex(nodeName)}@\\{\\s*img:\\s*"[^"]*"[^}]*\\}`, 'g');
  return code.replace(regex, '');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
