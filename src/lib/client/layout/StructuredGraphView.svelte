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
  let containerWidth = $state(0);
  let containerHeight = $state(0);
  let collapsedBranchIds = $state(new Set<string>());
  // Still passed to getVisibleObjectGraph for API compatibility; per-card
  // collapse UI was dropped in favor of the per-row branch port.
  const collapsedCardIds = new Set<string>();

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
    // Pad the layout to at least the container size. svg-pan-zoom's
    // fit:true scales the SVG content to fill the viewport — when the
    // content bbox is smaller than the container (one small card), this
    // zooms everything up. Padding to container size pins fit to 1:1.
    const contentWidth = Math.max(...cards.map((card) => card.x + card.width / 2 + 64), 0);
    const contentHeight = Math.max(...cards.map((card) => card.y + card.height / 2 + 64), 0);
    const width = Math.max(containerWidth || 900, contentWidth);
    const height = Math.max(containerHeight || 540, contentHeight);
    return { cards, edges, height, width };
  });

  $effect(() => {
    if (!svgElement || !panZoomState) return;
    void layout.width;
    void layout.height;
    panZoomState.updateElement(svgElement, {});
  });

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

  // Pastel rotation. Hash the card id so the same title keeps the same
  // hue across re-renders, but the layout still gets a mix of colors.
  const HEADER_PALETTES = [
    'card-header-rose',
    'card-header-violet',
    'card-header-peach',
    'card-header-mint'
  ] as const;

  function hueIndex(id: string): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % HEADER_PALETTES.length;
  }

  function headerClass(id: string): string {
    return HEADER_PALETTES[hueIndex(id)];
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

<div
  class="structured-canvas {shouldShowGrid ? `grid-${gridStyle}-${$mode}` : ''}"
  bind:clientWidth={containerWidth}
  bind:clientHeight={containerHeight}>
  <!-- layout.{width,height} is padded to the container size in the derived
       layout — keeps pan-zoom's fit:true at 1:1 when content is small. -->
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
        x={card.x - card.width / 2 - 14}
        y={card.y - card.height / 2}
        width={card.width + 28}
        height={card.height}
        style="overflow: visible">
        <div
          class="object-card"
          style="width: {card.width}px; height: {card.height}px; margin-left: 14px;">
          <div class="card-header {headerClass(card.id)}">
            <span class="truncate">{card.title}</span>
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

  /* Cards. Subtle 1px ambient shadow — matches the reference screenshot's
     near-flat look. overflow-visible so the right-edge branch port can
     hang outside the card. Rounded corners come from the header (top)
     and last property-row (bottom) clipping with their own radius. */
  .object-card {
    @apply relative h-full rounded-xl border border-zinc-200 bg-white text-[13px] shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:border-zinc-700 dark:bg-zinc-800 dark:shadow-[0_1px_2px_rgba(0,0,0,0.35)];
  }

  .card-header {
    @apply flex h-9 items-center justify-between gap-2 rounded-t-xl px-3 font-mono text-[12px] font-semibold tracking-tight;
  }

  /* Headers — soft pastel tint in light, low-saturation in dark. Dark uses
     /15 opacity over zinc-800 (the prior /25 produced muddy bricks against
     the dark canvas). Text uses the 200 shade for legibility without glow. */
  .card-header-rose {
    @apply bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200;
  }
  .card-header-violet {
    @apply bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-200;
  }
  .card-header-peach {
    @apply bg-orange-100 text-orange-900 dark:bg-orange-500/15 dark:text-orange-200;
  }
  .card-header-mint {
    @apply bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200;
  }

  /* Edges. Light: slate-400 (neutral grey, matches screenshot).
     Dark: zinc-600 — present without the glow of a saturated stroke. */
  .graph-edge {
    @apply fill-none stroke-slate-400 transition-[stroke,stroke-dasharray] duration-150 dark:stroke-zinc-600;
  }

  .graph-edge:hover {
    @apply stroke-zinc-700 dark:stroke-zinc-300;
    stroke-dasharray: 8 7;
    animation: structured-flow 0.75s linear infinite;
  }

  .card-body {
    @apply font-mono;
  }

  /* Row dividers: zinc-100 light, zinc-700/60 dark for visible-but-quiet lines.
     Last row rounds its bottom corners so the card edge stays clean even
     though .object-card itself is overflow-visible. */
  .property-row {
    @apply relative flex h-8 items-center gap-2 border-t border-zinc-100 px-3 first:border-t-0 last:rounded-b-xl dark:border-zinc-700/60;
  }

  .property-key {
    @apply shrink-0 font-semibold text-blue-600 dark:text-blue-300;
  }

  .property-value {
    @apply min-w-0 truncate text-zinc-700 dark:text-zinc-200;
  }

  /* Branch port — sits just outside the card. Uses card-body bg so it
     visually belongs to the row, not the canvas. */
  .property-port {
    @apply absolute top-1/2 right-[-10px] z-50 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-zinc-300 bg-white font-mono text-[12px] leading-none text-zinc-600 transition-colors hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-400 dark:hover:text-white;
  }

  @keyframes structured-flow {
    to {
      stroke-dashoffset: -15;
    }
  }
</style>
