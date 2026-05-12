<script lang="ts">
  import { inputStateStore, updateCodeStore } from '$lib/client/util/state/state';
  import { Button } from '$lib/client/ui/button';
  import {
    injectEdgeStyle,
    injectNodeStyle,
    svgIdToNodeName
  } from '$lib/client/util/diagram/diagramMapper';
  import { Image, Loader2, Pipette, X } from 'lucide-svelte';
  import { mode } from 'mode-watcher';
  import { onDestroy, onMount } from 'svelte';
  import { derived, get } from 'svelte/store';

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let selectionType = $state<'node' | 'edge' | null>(null);
  let selectionId = $state<string>('');
  let selectionNodeIds = $state<string[]>([]);
  let selectionEdgeIndex = $state<number>(-1);
  let isApplying = $state(false);
  let selectedColor = $state('#6366f1');
  let selectedBgColor = $state('#e0e7ff');
  let selectedBorderColor = $state('#6366f1');

  // Stroke / border / text swatches. Two mode-tuned sets so the same hue
  // stays legible in both themes — *-700 on white, *-300 on near-black, both
  // landing ≥ 4.5:1 contrast against their respective surface.
  //
  // Light: deep, muted tones that read as ink on paper.
  const lightStrokeColors = [
    '#b91c1c', // red 700
    '#c2410c', // orange 700
    '#b45309', // amber 700
    '#4d7c0f', // lime 700
    '#15803d', // green 700
    '#047857', // emerald 700
    '#0e7490', // cyan 700
    '#0369a1', // sky 700
    '#1d4ed8', // blue 700
    '#4338ca', // indigo 700
    '#6d28d9', // violet 700
    '#7e22ce', // purple 700
    '#a21caf', // fuchsia 700
    '#be185d', // pink 700
    '#57534e', // stone 600
    '#475569', // slate 600
    '#1f2937', // gray 800
    '#0f172a' // slate 900 (near-black, safe on white)
  ];

  // Dark: brighter siblings of the same hue ladder — readable on a near-black
  // canvas (#0a0a0a-ish) while still feeling restrained rather than neon.
  const darkStrokeColors = [
    '#fca5a5', // red 300
    '#fdba74', // orange 300
    '#fcd34d', // amber 300
    '#bef264', // lime 300
    '#86efac', // green 300
    '#6ee7b7', // emerald 300
    '#67e8f9', // cyan 300
    '#7dd3fc', // sky 300
    '#93c5fd', // blue 300
    '#a5b4fc', // indigo 300
    '#c4b5fd', // violet 300
    '#d8b4fe', // purple 300
    '#f0abfc', // fuchsia 300
    '#f9a8d4', // pink 300
    '#d6d3d1', // stone 300
    '#cbd5e1', // slate 300
    '#e5e7eb', // gray 200
    '#f8fafc' // slate 50 (near-white, safe on dark)
  ];

  // Light fills — soft, low-chroma tints (~*-100/*-50). Dark ink on these
  // surfaces holds well above 4.5:1; nothing here screams candy.
  const lightFillColors = [
    '#fee2e2', // red 100
    '#ffedd5', // orange 100
    '#fef3c7', // amber 100
    '#ecfccb', // lime 100
    '#dcfce7', // green 100
    '#d1fae5', // emerald 100
    '#cffafe', // cyan 100
    '#e0f2fe', // sky 100
    '#dbeafe', // blue 100
    '#e0e7ff', // indigo 100
    '#ede9fe', // violet 100
    '#f3e8ff', // purple 100
    '#fae8ff', // fuchsia 100
    '#fce7f3', // pink 100
    '#f5f5f4', // stone 100
    '#f1f5f9', // slate 100
    '#e5e7eb', // gray 200 — visible neutral border
    '#ffffff' // pure white
  ];

  // Dark fills — *-900/*-950 tonal floor. These read as "tinted black" rather
  // than muddy mid-tones; light text on them clears 4.5:1 by a comfortable
  // margin and the hue is still recognisable.
  const darkFillColors = [
    '#450a0a', // red 950
    '#431407', // orange 950
    '#451a03', // amber 950
    '#1a2e05', // lime 950
    '#052e16', // green 950
    '#022c22', // emerald 950
    '#083344', // cyan 950
    '#082f49', // sky 950
    '#172554', // blue 950
    '#1e1b4b', // indigo 950
    '#2e1065', // violet 950
    '#3b0764', // purple 950
    '#4a044e', // fuchsia 950
    '#500724', // pink 950
    '#1c1917', // stone 900
    '#0f172a', // slate 900
    '#1f2937', // gray 800 — visible neutral surface
    '#000000' // pure black
  ];

  // Reactive fill + stroke palettes based on current mode.
  const fillColors = derived([mode], ([$mode]) =>
    $mode === 'dark' ? darkFillColors : lightFillColors
  );
  const strokeColors = derived([mode], ([$mode]) =>
    $mode === 'dark' ? darkStrokeColors : lightStrokeColors
  );

  function switchToIconPanel() {
    open = false;
    window.dispatchEvent(
      new CustomEvent('open-icon-panel', {
        detail: { nodeId: selectionId }
      })
    );
  }

  function applyColorToCode() {
    if (!selectionId && selectionNodeIds.length === 0) return;
    isApplying = true;

    const state = get(inputStateStore);
    let code = state.code || '';

    if (selectionType === 'node') {
      // Apply to all selected nodes
      const ids = selectionNodeIds.length > 0 ? selectionNodeIds : [selectionId];
      for (const id of ids) {
        const nodeName = svgIdToNodeName(id);
        code = injectNodeStyle(code, nodeName, {
          fill: selectedBgColor,
          stroke: selectedBorderColor,
          strokeWidth: '2px',
          color: selectedColor
        });
      }
    } else if (selectionType === 'edge' && selectionEdgeIndex >= 0) {
      code = injectEdgeStyle(code, selectionEdgeIndex, {
        stroke: selectedColor,
        strokeWidth: '2px'
      });
    }

    updateCodeStore({ code, updateDiagram: true });

    setTimeout(() => {
      isApplying = false;
    }, 600);
  }

  // Auto-apply helpers — each sets the color then immediately applies
  function pickFill(color: string) {
    selectedBgColor = color;
    applyColorToCode();
  }
  function pickBorder(color: string) {
    selectedBorderColor = color;
    applyColorToCode();
  }
  function pickText(color: string) {
    selectedColor = color;
    applyColorToCode();
  }
  function pickStroke(color: string) {
    selectedColor = color;
    applyColorToCode();
  }

  function handleColorPanelEvent(e: CustomEvent) {
    selectionType = e.detail.type;
    selectionId = e.detail.id || '';
    selectionNodeIds = e.detail.nodeIds || [];
    selectionEdgeIndex = e.detail.edgeIndex ?? -1;
    open = true;
  }

  function handleSelectionCleared() {
    open = false;
    selectionType = null;
    selectionId = '';
    selectionEdgeIndex = -1;
    isApplying = false;
  }

  onMount(() => {
    window.addEventListener('open-color-panel', handleColorPanelEvent as EventListener);
    window.addEventListener('selection-cleared', handleSelectionCleared as EventListener);
  });

  onDestroy(() => {
    window.removeEventListener('open-color-panel', handleColorPanelEvent as EventListener);
    window.removeEventListener('selection-cleared', handleSelectionCleared as EventListener);
  });
</script>

{#if open}
  <div
    class="absolute top-16 right-4 z-50 w-56 animate-in rounded-xl border border-border bg-card/95 shadow-xl backdrop-blur-sm duration-200 slide-in-from-right-2">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-border/50 px-3 py-2">
      <div class="flex items-center gap-2">
        {#if isApplying}
          <Loader2 class="size-3.5 animate-spin text-primary" />
        {:else}
          <Pipette class="size-3.5 text-primary" />
        {/if}
        <span class="text-[13px] font-semibold">
          {selectionType === 'node' ? 'Node' : 'Edge'} Colors
        </span>
      </div>
      <div class="flex items-center gap-1">
        {#if selectionType === 'node'}
          <Button
            variant="ghost"
            size="icon"
            class="size-6"
            title="Switch to Icons"
            onclick={switchToIconPanel}>
            <Image class="size-3" />
          </Button>
        {/if}
        <Button variant="ghost" size="icon" class="size-6" onclick={() => (open = false)}>
          <X class="size-3" />
        </Button>
      </div>
    </div>

    <div class="space-y-3 p-3">
      {#if selectionType === 'node'}
        <!-- Fill Color -->
        <div class="space-y-1">
          <span class="text-[13px] font-medium tracking-wider text-muted-foreground uppercase"
            >Fill</span>
          <div class="flex flex-wrap gap-1">
            {#each $fillColors as color (color)}
              <button
                type="button"
                class="size-[18px] rounded border transition-all hover:scale-125 {selectedBgColor ===
                color
                  ? 'ring-2 ring-indigo-500 ring-offset-1'
                  : 'border-border/40'}"
                style="background-color: {color}"
                aria-label="Fill color {color}"
                onclick={() => pickFill(color)}></button>
            {/each}
          </div>
          <input
            type="color"
            bind:value={selectedBgColor}
            onchange={() => applyColorToCode()}
            class="mt-1 h-5 w-7 cursor-pointer rounded border-0" />
        </div>

        <!-- Border Color -->
        <div class="space-y-1">
          <span class="text-[13px] font-medium tracking-wider text-muted-foreground uppercase"
            >Border</span>
          <div class="flex flex-wrap gap-1">
            {#each $strokeColors as color (color)}
              <button
                type="button"
                class="size-[18px] rounded border transition-all hover:scale-125 {selectedBorderColor ===
                color
                  ? 'ring-2 ring-indigo-500 ring-offset-1'
                  : 'border-border/40'}"
                style="background-color: {color}"
                aria-label="Border color {color}"
                onclick={() => pickBorder(color)}></button>
            {/each}
          </div>
          <input
            type="color"
            bind:value={selectedBorderColor}
            onchange={() => applyColorToCode()}
            class="mt-1 h-5 w-7 cursor-pointer rounded border-0" />
        </div>

        <!-- Text Color -->
        <div class="space-y-1">
          <span class="text-[13px] font-medium tracking-wider text-muted-foreground uppercase"
            >Text</span>
          <div class="flex flex-wrap gap-1">
            {#each $strokeColors as color (color)}
              <button
                type="button"
                class="size-[18px] rounded border transition-all hover:scale-125 {selectedColor ===
                color
                  ? 'ring-2 ring-indigo-500 ring-offset-1'
                  : 'border-border/40'}"
                style="background-color: {color}"
                aria-label="Text color {color}"
                onclick={() => pickText(color)}></button>
            {/each}
          </div>
          <input
            type="color"
            bind:value={selectedColor}
            onchange={() => applyColorToCode()}
            class="mt-1 h-5 w-7 cursor-pointer rounded border-0" />
        </div>
      {:else}
        <!-- Edge/Stroke Color -->
        <div class="space-y-1">
          <span class="text-[13px] font-medium tracking-wider text-muted-foreground uppercase"
            >Stroke</span>
          <div class="flex flex-wrap gap-1">
            {#each $strokeColors as color (color)}
              <button
                type="button"
                class="size-[18px] rounded border transition-all hover:scale-125 {selectedColor ===
                color
                  ? 'ring-2 ring-indigo-500 ring-offset-1'
                  : 'border-border/40'}"
                style="background-color: {color}"
                aria-label="Stroke color {color}"
                onclick={() => pickStroke(color)}></button>
            {/each}
          </div>
          <input
            type="color"
            bind:value={selectedColor}
            onchange={() => applyColorToCode()}
            class="mt-1 h-5 w-7 cursor-pointer rounded border-0" />
        </div>
      {/if}
    </div>
  </div>
{/if}
