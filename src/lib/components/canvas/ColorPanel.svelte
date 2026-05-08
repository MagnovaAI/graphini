<script lang="ts">
  import { inputStateStore, updateCodeStore } from '$/util/state/state';
  import { Button } from '$lib/components/ui/button';
  import {
    injectEdgeStyle,
    injectNodeStyle,
    svgIdToNodeName
  } from '$lib/util/diagram/diagramMapper';
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

  // Colors that work well in both light and dark mode
  const strokeColors = [
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#84cc16',
    '#22c55e',
    '#10b981',
    '#06b6d4',
    '#0ea5e9',
    '#3b82f6',
    '#6366f1',
    '#8b5cf6',
    '#a855f7',
    '#d946ef',
    '#f43f5e',
    '#78716c',
    '#475569',
    '#1e293b',
    '#0f172a',
    '#ffffff'
  ];

  // Light mode fills — soft pastels
  const lightFillColors = [
    '#fecaca',
    '#fed7aa',
    '#fde68a',
    '#d9f99d',
    '#bbf7d0',
    '#a7f3d0',
    '#a5f3fc',
    '#bae6fd',
    '#bfdbfe',
    '#c7d2fe',
    '#ddd6fe',
    '#e9d5ff',
    '#f5d0fe',
    '#e0e7ff',
    '#fecdd3',
    '#f1f5f9',
    '#e2e8f0',
    '#ffffff',
    '#f8fafc',
    '#f0f9ff'
  ];

  // Dark mode fills — deep rich tones
  const darkFillColors = [
    '#7f1d1d',
    '#7c2d12',
    '#713f12',
    '#365314',
    '#14532d',
    '#064e3b',
    '#164e63',
    '#0c4a6e',
    '#1e3a5f',
    '#312e81',
    '#4c1d95',
    '#581c87',
    '#701a75',
    '#831843',
    '#881337',
    '#1e293b',
    '#0f172a',
    '#334155',
    '#1a1a2e',
    '#0d1117'
  ];

  // Reactive fill colors based on current mode
  const fillColors = derived([mode], ([$mode]) =>
    $mode === 'dark' ? darkFillColors : lightFillColors
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
            {#each strokeColors as color (color)}
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
            {#each strokeColors as color (color)}
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
            {#each strokeColors as color (color)}
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
