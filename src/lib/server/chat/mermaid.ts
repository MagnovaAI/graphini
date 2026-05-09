export const MERMAID_DIAGRAM_DECLARATION =
  /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|kanban|gitGraph|gitgraph|quadrantChart|xyChart|xychart|sankey|block|packet|architecture|C4Context|C4Container|C4Component|C4Deployment|requirementDiagram|zenuml)\b/i;

export function findMermaidDeclarations(source: string): { line: number; text: string }[] {
  return source
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(({ text }) => MERMAID_DIAGRAM_DECLARATION.test(text));
}

export function validateSingleMermaidDocument(
  source: string
): { valid: true } | { error: string; hint: string; valid: false } {
  const trimmed = source.trim();
  if (!MERMAID_DIAGRAM_DECLARATION.test(trimmed)) {
    return {
      error:
        'REJECTED: Content does not start with a valid Mermaid diagram type. Save documentation/prose to a .md file via fileSystem. Redo with valid Mermaid code that starts with a diagram type like "graph TD", "flowchart LR", "sequenceDiagram", etc.',
      hint: 'Mermaid content must start with exactly one diagram declaration.',
      valid: false
    };
  }

  const declarations = findMermaidDeclarations(source);
  if (declarations.length !== 1) {
    const declarationLines = declarations.map(({ line }) => line).join(', ') || 'none';
    return {
      error: `REJECTED: Mermaid content contains ${declarations.length} diagram declarations at lines ${declarationLines}. Use exactly one top-level diagram declaration.`,
      hint: 'Do not prepend placeholder graphs or mix declarations like "flowchart TD" and "graph TD" in one artifact.',
      valid: false
    };
  }

  return { valid: true };
}

export function parseMermaidNodes(diagram: string): { id: string; text: string; line: number }[] {
  const lines = diagram.split('\n');
  const nodes: { id: string; text: string; line: number }[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('subgraph')) continue;

    const nodeMatches = line.matchAll(
      /\b([A-Za-z][A-Za-z0-9_]*)\s*(?:\["([^"]+)"\]|\[([^\]]+)\]|\("([^"]+)"\)|\(([^)]+)\)|\{"([^"]+)"\}|\{([^}]+)\}|\(\["([^"]+)"\]\)|\(\[([^\]]+)\]\)|\[\["([^"]+)"\]\]|\[\[([^\]]+)\]\])/g
    );
    for (const match of nodeMatches) {
      const id = match[1];
      const text =
        match[2] ||
        match[3] ||
        match[4] ||
        match[5] ||
        match[6] ||
        match[7] ||
        match[8] ||
        match[9] ||
        match[10] ||
        match[11] ||
        '';
      if (!seen.has(id) && text) {
        seen.add(id);
        nodes.push({ id, text, line: i });
      }
    }
  }
  return nodes;
}

export function buildDiagramReview(diagram: string): {
  improvements: { description: string; severity: 'info' | 'medium' | 'high'; title: string }[];
  summary: string;
} {
  const lines = diagram.split('\n');
  const nodes = parseMermaidNodes(diagram);
  const hasComments = lines.some((line) => line.trim().startsWith('%%'));
  const hasStyles = lines.some((line) => line.trim().startsWith('style '));
  const hasClasses = lines.some((line) => line.trim().startsWith('classDef '));
  const hasSubgraphs = lines.some((line) => line.trim().startsWith('subgraph '));
  const hasQueue = /\b(queue|kafka|rabbitmq|pubsub|sqs|event|message)\b/i.test(diagram);
  const hasDatabase = /\b(db|database|postgres|mysql|mongo|redis|dynamodb|cassandra)\b/i.test(
    diagram
  );
  const hasObservability = /\b(log|metric|monitor|grafana|prometheus|trace|alert)\b/i.test(diagram);
  const hasSecurity = /\b(auth|oauth|iam|waf|firewall|secret|token|identity)\b/i.test(diagram);
  const hasIngress = /\b(load balancer|gateway|ingress|cdn|nginx|api gateway)\b/i.test(diagram);
  const ids = nodes.map((node) => node.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

  const improvements: {
    description: string;
    severity: 'info' | 'medium' | 'high';
    title: string;
  }[] = [];

  if (nodes.length < 10) {
    improvements.push({
      description:
        'The diagram is likely under-specified. Add meaningful supporting components such as auth, cache, queue, observability, CI/CD, external clients, and deployment/runtime boundaries.',
      severity: 'high',
      title: 'Expand component coverage'
    });
  }

  if (!hasSubgraphs && nodes.length >= 8) {
    improvements.push({
      description:
        'Group related nodes into subgraphs such as Client, Edge, Services, Data, Async Processing, and Observability so the architecture scans cleanly.',
      severity: 'medium',
      title: 'Add architectural boundaries'
    });
  }

  if (!hasIngress) {
    improvements.push({
      description:
        'Show the request entry point with a CDN, load balancer, ingress, or API gateway before traffic reaches internal services.',
      severity: 'medium',
      title: 'Clarify ingress path'
    });
  }

  if (!hasDatabase) {
    improvements.push({
      description:
        'Add the persistence layer and label which services own or query each datastore.',
      severity: 'high',
      title: 'Add data ownership'
    });
  }

  if (!hasQueue) {
    improvements.push({
      description:
        'For production systems, add an async message queue or event bus where work can be retried, buffered, or processed out of band.',
      severity: 'medium',
      title: 'Represent async workflows'
    });
  }

  if (!hasSecurity) {
    improvements.push({
      description:
        'Add authentication/authorization and any boundary controls such as IAM, WAF, or secrets management.',
      severity: 'medium',
      title: 'Show security controls'
    });
  }

  if (!hasObservability) {
    improvements.push({
      description:
        'Add logs, metrics, traces, alerts, or a monitoring dashboard so operational readiness is visible.',
      severity: 'medium',
      title: 'Add observability'
    });
  }

  if (!hasStyles && !hasClasses) {
    improvements.push({
      description:
        'Use class definitions or styling to visually distinguish clients, services, data stores, queues, and external systems.',
      severity: 'info',
      title: 'Improve visual hierarchy'
    });
  }

  if (!hasComments && lines.length > 25) {
    improvements.push({
      description:
        'For larger diagrams, lightweight Mermaid comments can explain non-obvious flows without cluttering node labels.',
      severity: 'info',
      title: 'Document complex flows'
    });
  }

  if (duplicateIds.length > 0) {
    improvements.push({
      description: `Duplicate node IDs detected: ${[...new Set(duplicateIds)].join(', ')}. Mermaid nodes should have stable unique IDs to avoid accidental merges.`,
      severity: 'high',
      title: 'Fix duplicate node IDs'
    });
  }

  if (improvements.length === 0) {
    improvements.push({
      description:
        'The diagram covers the main structural concerns. The next improvement would be adding more precise edge labels for protocols, ownership, and sync versus async calls.',
      severity: 'info',
      title: 'Refine edge semantics'
    });
  }

  return {
    improvements,
    summary: `Reviewed diagram: ${nodes.length} nodes, ${lines.length} lines, ${improvements.length} improvement${improvements.length !== 1 ? 's' : ''} suggested`
  };
}
