<script lang="ts">
  import type { DiagramEngine } from '$lib/types/workspace';
  import {
    getVisibleObjectGraph,
    parseStructuredGraph,
    type ObjectGraph
  } from '$lib/features/diagram/structured-graph';
  import type { PanZoomState } from '$lib/features/diagram/panZoom';
  import dagre from 'dagre';

  type PositionedCard = ObjectGraph['cards'][number] & {
    height: number;
    width: number;
    x: number;
    y: number;
  };

  let {
    engine,
    gridStyle = 'dots',
    panZoomState,
    shouldShowGrid = true,
    source,
    title = 'Untitled'
  }: {
    engine: Exclude<DiagramEngine, 'mermaid'>;
    gridStyle?: 'dots' | 'squares';
    panZoomState?: PanZoomState;
    shouldShowGrid?: boolean;
    source: string;
    title?: string;
  } = $props();

  let svgElement = $state<SVGSVGElement>();
  let collapsedBranchIds = $state(new Set<string>());
  let collapsedCardIds = $state(new Set<string>());
  const gridPatternId = $derived(gridStyle === 'dots' ? 'structured-dots' : 'structured-squares');

  const parsed = $derived.by<ObjectGraph>(() => {
    try {
      return parseStructuredGraph(engine, source, title);
    } catch {
      return {
        cards: [
          {
            depth: 0,
            id: 'error',
            kind: 'object',
            rows: [{ key: 'error', value: `Invalid ${engine.toUpperCase()}` }],
            title: 'error'
          }
        ],
        edges: []
      };
    }
  });

  const layout = $derived.by(() => {
    const visible = getVisibleObjectGraph(parsed, collapsedCardIds, collapsedBranchIds);
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ marginx: 56, marginy: 48, nodesep: 56, rankdir: 'LR', ranksep: 72 });
    graph.setDefaultEdgeLabel(() => ({}));

    for (const card of visible.cards) {
      const width = card.depth === 0 ? 420 : card.kind === 'primitive' ? 138 : 230;
      graph.setNode(card.id, {
        height: 36 + Math.max(1, card.rows.length) * 32,
        width: Math.max(width, card.title.length * 8 + 56)
      });
    }
    for (const edge of visible.edges) graph.setEdge(edge.from, edge.to);
    dagre.layout(graph);

    const cards = visible.cards.map((card): PositionedCard => {
      const positioned = graph.node(card.id) ?? { height: 90, width: 220, x: 0, y: 0 };
      return { ...card, ...positioned };
    });
    const cardById = new Map(cards.map((card) => [card.id, card]));
    const edges = visible.edges.map((edge) => ({
      ...edge,
      path: edgePath(edge, cardById)
    }));
    const width = Math.max(900, ...cards.map((card) => card.x + card.width / 2 + 64));
    const height = Math.max(540, ...cards.map((card) => card.y + card.height / 2 + 64));
    return { cards, edges, height, width };
  });

  $effect(() => {
    if (!svgElement || !panZoomState) return;
    layout.width;
    layout.height;
    panZoomState.updateElement(svgElement, {});
  });

  function hasChildren(id: string) {
    return parsed.cards.some(
      (card) => card.id.startsWith(`${id}.`) || card.id.startsWith(`${id}[`)
    );
  }

  function rowHasChildren(id: string) {
    return parsed.cards.some(
      (card) => card.id === id || card.id.startsWith(`${id}.`) || card.id.startsWith(`${id}[`)
    );
  }

  function toggleBranch(id: string) {
    const next = new Set(collapsedBranchIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedBranchIds = next;
  }

  function toggleCard(id: string) {
    const next = new Set(collapsedCardIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedCardIds = next;
  }

  function headerClass(kind: ObjectGraph['cards'][number]['kind'], depth: number) {
    if (depth === 0) return 'card-header-purple';
    if (kind === 'primitive') return 'card-header-beige';
    if (kind === 'array') return 'card-header-teal';
    return 'card-header-green';
  }

  function edgePath(edge: ObjectGraph['edges'][number], cardById: Map<string, PositionedCard>) {
    const from = cardById.get(edge.from);
    const to = cardById.get(edge.to);
    if (!from || !to) return '';

    const rowIndex = Math.max(
      0,
      from.rows.findIndex((row) => row.childId === edge.fromRowId || row.childId === edge.to)
    );
    const sourceX = from.x + from.width / 2;
    const sourceY = from.y - from.height / 2 + 36 + rowIndex * 32 + 16;
    const targetX = to.x - to.width / 2;
    const targetY = to.y;
    const bendX = sourceX + Math.max(50, Math.min(140, (targetX - sourceX) * 0.45));
    const radius = 6;
    const verticalDirection = targetY >= sourceY ? 1 : -1;
    const targetDirection = targetX >= bendX ? 1 : -1;
    const verticalStartY = sourceY + verticalDirection * radius;
    const verticalEndY = targetY - verticalDirection * radius;
    const targetStartX = bendX + targetDirection * radius;

    if (Math.abs(targetY - sourceY) < radius * 2) {
      return `M ${sourceX} ${sourceY} C ${bendX} ${sourceY}, ${bendX} ${targetY}, ${targetX} ${targetY}`;
    }

    return [
      `M ${sourceX} ${sourceY}`,
      `H ${bendX - radius}`,
      `Q ${bendX} ${sourceY} ${bendX} ${verticalStartY}`,
      `V ${verticalEndY}`,
      `Q ${bendX} ${targetY} ${targetStartX} ${targetY}`,
      `H ${targetX}`
    ].join(' ');
  }
</script>

<div class="structured-canvas">
  <svg bind:this={svgElement} class="structured-svg" viewBox="0 0 {layout.width} {layout.height}">
    <defs>
      <pattern id="structured-dots" width="16" height="16" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1" class="fill-muted-foreground/15" />
      </pattern>
      <pattern id="structured-squares" width="30" height="30" patternUnits="userSpaceOnUse">
        <path d="M 30 0 H 0 V 30" class="structured-grid-line" />
      </pattern>
    </defs>
    {#if shouldShowGrid}
      <rect width={layout.width} height={layout.height} fill="url(#{gridPatternId})" />
    {/if}

    {#each layout.edges as edge (edge.id)}
      <path
        d={edge.path}
        class="graph-edge"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2" />
    {/each}

    {#each layout.cards as card (card.id)}
      <foreignObject
        x={card.x - card.width / 2 - 18}
        y={card.y - card.height / 2 - 10}
        width={card.width + 36}
        height={card.height + 20}>
        <div
          class="object-card"
          style="width: {card.width}px; height: {card.height}px; margin: 10px 18px;">
          <div class="card-header {headerClass(card.kind, card.depth)}">
            <span class="truncate">{card.title}</span>
            {#if hasChildren(card.id)}
              <button
                type="button"
                class="collapse-button"
                onclick={() => toggleCard(card.id)}
                aria-label={collapsedCardIds.has(card.id) ? 'Expand' : 'Collapse'}>
                {collapsedCardIds.has(card.id) ? '+' : '-'}
              </button>
            {/if}
          </div>
          <div class="card-body">
            {#each card.rows as row (row.key)}
              <div class="property-row">
                {#if card.kind !== 'primitive' || row.key !== 'value'}
                  <span class="property-key">{row.key}:</span>
                {/if}
                <span class="property-value">{row.value}</span>
                {#if row.childId && rowHasChildren(row.childId)}
                  <button
                    type="button"
                    class="property-port"
                    onclick={() => toggleBranch(row.childId)}
                    aria-label={collapsedBranchIds.has(row.childId)
                      ? 'Expand branch'
                      : 'Collapse branch'}>
                    {collapsedBranchIds.has(row.childId) ? '+' : '-'}
                  </button>
                {:else if row.childId}
                  <span class="property-port" aria-hidden="true"></span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </foreignObject>
    {/each}
  </svg>
</div>

<style>
  @reference "../../../app.css";

  .structured-canvas {
    @apply h-full overflow-hidden bg-background;
  }

  .structured-svg {
    @apply h-full w-full;
  }

  .object-card {
    @apply relative z-10 h-full overflow-visible rounded-md border border-border bg-card text-[13px] shadow-sm;
  }

  .card-header {
    @apply flex h-9 items-center justify-between gap-2 border-b border-border px-3 font-mono text-[12px] font-semibold;
  }

  .card-header-purple {
    @apply bg-purple-100 text-purple-900 dark:bg-purple-500/20 dark:text-purple-100;
  }

  .card-header-rose {
    @apply bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-100;
  }

  .card-header-teal {
    @apply bg-cyan-100 text-cyan-900 dark:bg-cyan-500/20 dark:text-cyan-100;
  }

  .card-header-green {
    @apply bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100;
  }

  .card-header-beige {
    @apply bg-stone-100 text-stone-700 dark:bg-stone-500/20 dark:text-stone-100;
  }

  .collapse-button {
    @apply flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background/70 font-mono text-[12px] leading-none text-muted-foreground hover:text-foreground;
  }

  .graph-edge {
    @apply fill-none stroke-slate-500/70 transition-[stroke,stroke-dasharray] duration-150 dark:stroke-slate-300/70;
  }

  .structured-grid-line {
    @apply fill-none stroke-muted-foreground/15;
    stroke-width: 1;
  }

  .graph-edge:hover {
    @apply stroke-slate-700 dark:stroke-slate-100;
    stroke-dasharray: 8 7;
    animation: structured-flow 0.75s linear infinite;
  }

  .card-body {
    @apply overflow-visible font-mono;
  }

  .property-row {
    @apply relative flex h-8 items-center gap-2 border-b border-border/70 px-3 last:border-b-0;
  }

  .property-key {
    @apply shrink-0 font-semibold text-blue-600 dark:text-blue-300;
  }

  .property-value {
    @apply min-w-0 truncate text-muted-foreground;
  }

  .property-port {
    @apply absolute top-1/2 right-[-10px] z-50 flex size-5 -translate-y-1/2 items-center justify-center rounded-full border border-purple-200 bg-background font-mono text-[12px] leading-none text-muted-foreground shadow-md transition-colors hover:border-purple-300 hover:text-foreground dark:border-purple-400/40;
  }

  @keyframes structured-flow {
    to {
      stroke-dashoffset: -15;
    }
  }
</style>
