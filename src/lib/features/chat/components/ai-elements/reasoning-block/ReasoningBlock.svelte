<script lang="ts">
  import { ChevronDown, ChevronRight, Sparkles } from 'lucide-svelte';

  interface Props {
    content: string;
    isStreaming?: boolean;
    durationMs?: number;
  }

  let { content, isStreaming = false, durationMs }: Props = $props();

  let isCollapsed = $state(false);
  let collapseInitialized = false;
  let wasStreaming = false;
  let contentEl: HTMLDivElement | undefined = $state();

  // Clean content: strip markdown artifacts for display
  let displayContent = $derived(
    content
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/^#+\s+/gm, '')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .trim()
  );

  let tokenCount = $derived(Math.max(0, Math.ceil(displayContent.length / 4)));

  let formattedDuration = $derived.by(() => {
    if (!durationMs) return '';
    if (durationMs < 1000) return `${durationMs}ms`;
    const s = (durationMs / 1000).toFixed(1);
    return `${s}s`;
  });

  // Keep streaming thoughts open, then collapse once the final content arrives.
  $effect(() => {
    if (!collapseInitialized) {
      isCollapsed = !isStreaming;
      wasStreaming = isStreaming;
      collapseInitialized = true;
    } else if (isStreaming && !wasStreaming) {
      isCollapsed = false;
    } else if (wasStreaming && !isStreaming && content.length > 0) {
      isCollapsed = true;
    }
    wasStreaming = isStreaming;
  });

  // Auto-scroll during streaming
  $effect(() => {
    if (isStreaming && contentEl) {
      contentEl.scrollTop = contentEl.scrollHeight;
    }
  });
</script>

<div
  class="overflow-hidden rounded-lg border transition-colors duration-150
    {isStreaming
    ? 'border-border bg-muted/30'
    : 'border-border/50 bg-muted/20 hover:border-border'}">
  <!-- Header -->
  <button
    type="button"
    onclick={() => (isCollapsed = !isCollapsed)}
    class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30">
    <!-- Icon -->
    <div
      class="flex size-5 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-500">
      <Sparkles class="size-3 {isStreaming ? 'animate-pulse' : ''}" />
    </div>

    <!-- Title -->
    <span class="flex-1 text-xs font-medium text-muted-foreground">
      {#if isStreaming}
        <span class="reasoning-shimmer">Thinking...</span>
      {:else}
        Thought {formattedDuration ? `for ${formattedDuration}` : ''} · ~{tokenCount} tokens
      {/if}
    </span>

    <!-- Chevron -->
    <div class="text-muted-foreground/40 transition-transform">
      {#if isCollapsed}
        <ChevronRight class="size-3.5" />
      {:else}
        <ChevronDown class="size-3.5" />
      {/if}
    </div>
  </button>

  <!-- Content -->
  {#if !isCollapsed}
    <div
      bind:this={contentEl}
      class="border-t border-border/30 px-3 py-2.5"
      style="max-height: {isStreaming ? '300px' : '250px'}; overflow-y: auto;">
      <p class="text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground/70">
        {displayContent}{#if isStreaming}<span class="reasoning-cursor"></span>{/if}
      </p>
    </div>
  {/if}
</div>

<style>
  .reasoning-cursor {
    display: inline-block;
    width: 5px;
    height: 13px;
    background: var(--muted-foreground);
    border-radius: 1px;
    animation: reasoning-blink 0.8s ease-in-out infinite;
    vertical-align: text-bottom;
    margin-left: 1px;
  }

  @keyframes reasoning-blink {
    0%,
    100% {
      opacity: 0.6;
    }
    50% {
      opacity: 0.1;
    }
  }

  .reasoning-shimmer {
    background: linear-gradient(90deg, currentColor 0%, var(--foreground) 40%, currentColor 80%);
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: reasoning-shimmer-slide 1.8s ease-in-out infinite;
  }

  @keyframes reasoning-shimmer-slide {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
</style>
