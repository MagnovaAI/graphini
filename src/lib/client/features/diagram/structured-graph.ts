import type { DiagramEngine } from '$lib/client/types/workspace';

export interface ObjectGraphRow {
  key: string;
  value: string;
  childId?: string;
}

export interface ObjectGraphCard {
  id: string;
  title: string;
  kind: 'object' | 'array' | 'primitive';
  rows: ObjectGraphRow[];
  depth: number;
}

export interface ObjectGraphEdge {
  id: string;
  from: string;
  fromRowId?: string;
  to: string;
}

export interface ObjectGraph {
  cards: ObjectGraphCard[];
  edges: ObjectGraphEdge[];
}

type YamlLine = { indent: number; text: string };

function formatPrimitive(value: unknown) {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return String(value);
}

function summaryFor(value: unknown) {
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).length} keys}`;
  return formatPrimitive(value);
}

function titleFor(path: string, value: unknown, rootTitle?: string) {
  if (path === 'root') return rootTitle || 'root';
  if (!path) return 'root';
  const name = path.split('.').at(-1) ?? path;
  if (Array.isArray(value)) return `${name}`;
  return name;
}

function addPrimitiveCard(value: unknown, path: string, depth: number, graph: ObjectGraph) {
  graph.cards.push({
    depth,
    id: path,
    kind: 'primitive',
    rows: [{ key: 'value', value: formatPrimitive(value) }],
    title: path.split('.').at(-1) ?? path
  });
}

function addValueToGraph(
  value: unknown,
  path: string,
  depth: number,
  graph: ObjectGraph,
  rootTitle?: string
) {
  if (!value || typeof value !== 'object') return undefined;

  const id = path || 'root';
  if (Array.isArray(value) && path !== 'root') {
    value.forEach((child, index) => {
      const childId = `${path}[${index}]`;
      const parentId = path.split('.').slice(0, -1).join('.') || 'root';
      graph.edges.push({
        from: parentId,
        fromRowId: path,
        id: `${path}->${childId}`,
        to: childId
      });
      if (child && typeof child === 'object') {
        addValueToGraph(child, childId, depth, graph, rootTitle);
      } else {
        addPrimitiveCard(child, childId, depth, graph);
      }
    });
    return id;
  }

  const entries = Array.isArray(value)
    ? value.map((item, index) => [`${index}`, item] as const)
    : Object.entries(value as Record<string, unknown>);
  const rows: ObjectGraphRow[] = [];

  graph.cards.push({
    depth,
    id,
    kind: Array.isArray(value) ? 'array' : 'object',
    rows,
    title: titleFor(path, value, rootTitle)
  });

  for (const [key, child] of entries) {
    if (Array.isArray(child)) {
      rows.push({ childId: `${id}.${key}`, key, value: summaryFor(child) });
      child.forEach((item, index) => {
        const childId = `${id}.${key}[${index}]`;
        graph.edges.push({
          from: id,
          fromRowId: `${id}.${key}`,
          id: `${id}->${childId}`,
          to: childId
        });
        if (item && typeof item === 'object') {
          addValueToGraph(item, childId, depth + 1, graph, rootTitle);
        } else {
          addPrimitiveCard(item, childId, depth + 1, graph);
        }
      });
    } else if (child && typeof child === 'object') {
      const childId = path ? `${path}.${key}` : key;
      rows.push({ childId, key, value: summaryFor(child) });
      graph.edges.push({ from: id, fromRowId: childId, id: `${id}->${childId}`, to: childId });
      addValueToGraph(child, childId, depth + 1, graph, rootTitle);
    } else {
      rows.push({ key, value: formatPrimitive(child) });
    }
  }

  return id;
}

function parseYamlScalar(value: string) {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function preprocessYaml(source: string): YamlLine[] {
  return source
    .split('\n')
    .map((raw) => raw.replace(/\s+#.*$/, ''))
    .filter((line) => line.trim())
    .map((line) => ({ indent: line.match(/^\s*/)?.[0].length ?? 0, text: line.trim() }));
}

function parseYamlBlock(lines: YamlLine[], index: number, indent: number): [unknown, number] {
  const isArray = lines[index]?.text.startsWith('- ');

  if (isArray) {
    const container: unknown[] = [];
    while (index < lines.length) {
      const line = lines[index];
      if (line.indent < indent) break;
      if (line.indent > indent) {
        index++;
        continue;
      }
      if (!line.text.startsWith('- ')) break;
      const content = line.text.slice(2).trim();
      if (!content) {
        const [child, next] = parseYamlBlock(lines, index + 1, indent + 2);
        container.push(child);
        index = next;
        continue;
      }
      const [key, ...rest] = content.split(':');
      if (rest.length > 0) {
        const item: Record<string, unknown> = {};
        const value = rest.join(':').trim();
        item[key.trim()] = value ? parseYamlScalar(value) : {};
        index++;
        while (index < lines.length && lines[index].indent > indent) {
          const nested = lines[index];
          if (nested.indent === indent + 2 && nested.text.includes(':')) {
            const [nestedKey, ...nestedRest] = nested.text.split(':');
            const nestedValue = nestedRest.join(':').trim();
            if (nestedValue) {
              item[nestedKey.trim()] = parseYamlScalar(nestedValue);
              index++;
            } else {
              const [child, next] = parseYamlBlock(lines, index + 1, nested.indent + 2);
              item[nestedKey.trim()] = child;
              index = next;
            }
          } else {
            index++;
          }
        }
        container.push(item);
      } else {
        container.push(parseYamlScalar(content));
        index++;
      }
    }
    return [container, index];
  }

  const container: Record<string, unknown> = {};
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      index++;
      continue;
    }

    const [key, ...rest] = line.text.split(':');
    if (!key || rest.length === 0) break;
    const value = rest.join(':').trim();
    if (value) {
      container[key.trim()] = parseYamlScalar(value);
      index++;
    } else {
      const [child, next] = parseYamlBlock(lines, index + 1, indent + 2);
      container[key.trim()] = child;
      index = next;
    }
  }

  return [container, index];
}

function parseSimpleYaml(source: string) {
  const lines = preprocessYaml(source);
  if (lines.length === 0) return {};
  return parseYamlBlock(lines, 0, lines[0].indent)[0];
}

export function parseStructuredGraph(
  engine: DiagramEngine,
  source: string,
  rootTitle?: string
): ObjectGraph {
  const raw = engine === 'json' ? JSON.parse(source) : parseSimpleYaml(source);
  const graph: ObjectGraph = { cards: [], edges: [] };
  addValueToGraph(raw, 'root', 0, graph, rootTitle);
  if (graph.cards.length === 0) {
    graph.cards.push({
      depth: 0,
      id: 'root',
      kind: 'object',
      rows: [{ key: 'value', value: formatPrimitive(raw) }],
      title: 'root'
    });
  }
  return graph;
}

export function getVisibleObjectGraph(
  graph: ObjectGraph,
  collapsedCardIds: Set<string>,
  collapsedBranchIds = new Set<string>()
) {
  const hiddenCardIds = [...collapsedCardIds];
  const hiddenBranchIds = [...collapsedBranchIds];
  const cards = graph.cards.filter(
    (card) =>
      !hiddenCardIds.some((id) => card.id.startsWith(`${id}.`) || card.id.startsWith(`${id}[`)) &&
      !hiddenBranchIds.some(
        (id) => card.id === id || card.id.startsWith(`${id}.`) || card.id.startsWith(`${id}[`)
      )
  );
  const visibleIds = new Set(cards.map((card) => card.id));
  const edges = graph.edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));
  return { cards, edges };
}
