<script lang="ts">
  import type { DiagramEngine } from '$lib/client/types/workspace';
  import {
    getVisibleObjectGraph,
    parseStructuredGraph,
    type ObjectGraph
  } from '$lib/client/features/diagram/structured-graph';
  import type { PanZoomState } from '$lib/client/features/diagram/panZoom';
  import dagre from 'dagre';
  import { mode } from 'mode-watcher';

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
    void layout.width;
    void layout.height;
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
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const next = new Set(collapsedBranchIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsedBranchIds = next;
  }

  function toggleCard(id: string) {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
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

<div class="structured-canvas {shouldShowGrid ? `grid-${gridStyle}-${$mode}` : ''}">
  <svg bind:this={svgElement} class="structured-svg" viewBox="0 0 {layout.width} {layout.height}">
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

  /* Grid lives on the wrapper (viewport-fixed) instead of inside the SVG
     so it doesn't pan with the cards and stays visible at any zoom. */
  .grid-dots-light {
    background-size: 16px 16px;
    background-image: radial-gradient(
      circle,
      color-mix(in oklab, var(--foreground) 5%, transparent) 1px,
      transparent 1px
    );
  }
  .grid-dots-dark {
    background-size: 16px 16px;
    background-image: radial-gradient(
      circle,
      color-mix(in oklab, var(--foreground) 7%, transparent) 1px,
      transparent 1px
    );
  }
  .grid-squares-light {
    background-size: 20px 20px;
    background-image: linear-gradient(
        to right,
        color-mix(in oklab, var(--foreground) 4%, transparent) 1px,
        transparent 1px
      ),
      linear-gradient(
        to bottom,
        color-mix(in oklab, var(--foreground) 4%, transparent) 1px,
        transparent 1px
      );
  }
  .grid-squares-dark {
    background-size: 20px 20px;
    background-image: linear-gradient(
        to right,
        color-mix(in oklab, var(--foreground) 6%, transparent) 1px,
        transparent 1px
      ),
      linear-gradient(
        to bottom,
        color-mix(in oklab, var(--foreground) 6%, transparent) 1px,
        transparent 1px
      );
  }

  /* Cards. Important: --card === --background in this theme, so we can't
     rely on bg-card for separation. Light mode: white card on subtle
     dotted bg, lean on shadow + border. Dark mode: lift the card with
     zinc-800 — distinct from the #181818 canvas without going pure black. */
  .object-card {
    @apply relative z-10 h-full overflow-visible rounded-lg border border-zinc-200/80 bg-white text-[13px] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_12px_-4px_rgba(0,0,0,0.08)] dark:border-zinc-700/70 dark:bg-zinc-900 dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_8px_24px_-8px_rgba(0,0,0,0.6)];
  }

  .card-header {
    @apply flex h-9 items-center justify-between gap-2 rounded-t-lg border-b border-zinc-200/70 px-3 font-mono text-[12px] font-semibold tracking-tight dark:border-zinc-700/60;
  }

  /* Header palettes — light uses 100/900 (good 9:1+ contrast); dark uses
     a richer 500/40 tint over the zinc-900 card with near-white text for
     legibility against the dotted background and tinted fill. */
  .card-header-purple {
    @apply bg-purple-100 text-purple-900 dark:bg-purple-500/30 dark:text-purple-100;
  }

  .card-header-teal {
    @apply bg-cyan-100 text-cyan-900 dark:bg-cyan-500/30 dark:text-cyan-100;
  }

  .card-header-green {
    @apply bg-emerald-100 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-100;
  }

  .card-header-beige {
    @apply bg-amber-50 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100;
  }

  /* Floating chrome — needs an explicit elevated bg in dark mode since
     bg-background blends into the canvas. */
  .collapse-button {
    @apply flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-zinc-300 bg-white font-mono text-[12px] leading-none text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-400 dark:hover:text-zinc-50;
  }

  /* Edges. Light: slate-500 reads cleanly over white cards and dotted bg.
     Dark: slate-400/50 keeps it present without out-glowing the cards. */
  .graph-edge {
    @apply fill-none stroke-slate-500 transition-[stroke,stroke-dasharray] duration-150 dark:stroke-slate-400/55;
  }

  .graph-edge:hover {
    @apply stroke-zinc-900 dark:stroke-zinc-100;
    stroke-dasharray: 8 7;
    animation: structured-flow 0.75s linear infinite;
  }

  .card-body {
    @apply overflow-visible rounded-b-lg font-mono;
  }

  .property-row {
    @apply relative flex h-8 items-center gap-2 border-b border-zinc-200/60 px-3 last:rounded-b-lg last:border-b-0 dark:border-zinc-700/50;
  }

  /* Keys: blue-700 hits 7:1 on white; blue-300 hits 7:1 on zinc-900. */
  .property-key {
    @apply shrink-0 font-semibold text-blue-700 dark:text-blue-300;
  }

  /* Values: lean toward the text color rather than the muted token so
     they stay readable against the patterned background. */
  .property-value {
    @apply min-w-0 truncate text-zinc-700 dark:text-zinc-300;
  }

  .property-port {
    @apply absolute top-1/2 right-[-10px] z-50 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-zinc-300 bg-white font-mono text-[12px] leading-none text-zinc-600 shadow-md transition-colors hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-400 dark:hover:text-zinc-50;
  }

  @keyframes structured-flow {
    to {
      stroke-dashoffset: -15;
    }
  }
</style>
