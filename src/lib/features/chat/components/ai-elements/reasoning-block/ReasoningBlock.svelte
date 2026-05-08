<script lang="ts">
  import { ChevronRight } from 'lucide-svelte';

  interface Props {
    content: string;
    isStreaming?: boolean;
    durationMs?: number;
    startedAt?: number;
  }

  let { content, isStreaming = false, durationMs, startedAt }: Props = $props();

  const PREVIEW_LENGTH = 60;

  let isExpanded = $state(isStreaming);
  let collapseInitialized = false;
  let wasStreaming = false;
  let scrollEl: HTMLDivElement | undefined = $state();
  let isOverflowing = $state(false);

  // Auto-collapse when streaming ends
  $effect(() => {
    if (!collapseInitialized) {
      isExpanded = isStreaming;
      wasStreaming = isStreaming;
      collapseInitialized = true;
    } else if (wasStreaming && !isStreaming) {
      isExpanded = false;
    }
    wasStreaming = isStreaming;
  });

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

  let previewText = $derived(displayContent.slice(0, PREVIEW_LENGTH).replace(/\n/g, ' '));

  // Live elapsed time while streaming
  let startedAtMs = startedAt ?? Date.now();
  let nowMs = $state(Date.now());
  $effect(() => {
    if (!isStreaming) return;
    nowMs = Date.now();
    const interval = setInterval(() => {
      nowMs = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  });

  function formatElapsed(ms: number): string {
    if (ms < 1000) return '';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rem = seconds % 60;
    if (rem === 0) return `${minutes}m`;
    return `${minutes}m ${rem}s`;
  }

  let elapsedDisplay = $derived(
    isStreaming
      ? formatElapsed(nowMs - startedAtMs)
      : durationMs
        ? formatElapsed(durationMs)
        : ''
  );

  // Auto-scroll + check overflow during streaming
  $effect(() => {
    void displayContent;
    if (isStreaming && isExpanded && scrollEl) {
      isOverflowing = scrollEl.scrollHeight > scrollEl.clientHeight;
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });
</script>

<div>
  <!-- Header -->
  <div
    role="button"
    tabindex="0"
    onclick={() => (isExpanded = !isExpanded)}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        isExpanded = !isExpanded;
      }
    }}
    class="group flex cursor-pointer items-center gap-1.5 px-2 py-0.5 text-[13px]">
    <span class="flex-shrink-0 font-medium whitespace-nowrap">
      {#if isStreaming}
        <span class="reasoning-shimmer inline-flex h-4 items-center text-[13px] leading-none"
          >Thinking{elapsedDisplay ? ` for ${elapsedDisplay}` : ''}</span>
      {:else}
        <span class="text-muted-foreground"
          >Thought{elapsedDisplay ? ` for ${elapsedDisplay}` : ''}</span>
      {/if}
    </span>
    <ChevronRight
      class="size-3.5 flex-shrink-0 text-muted-foreground/60 transition-transform duration-200 ease-out
        {isExpanded ? 'rotate-90' : 'opacity-0 group-hover:opacity-100'}" />
  </div>

  <!-- Full content when expanded -->
  {#if isExpanded && displayContent}
    <div
      class="relative mt-1 overflow-hidden rounded-md border border-border/40"
      style="background-color: var(--tool-box-bg);">
      <div
        class="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background to-transparent transition-opacity duration-200
          {isStreaming && isOverflowing ? 'opacity-100' : 'opacity-0'}">
      </div>
      <div
        bind:this={scrollEl}
        class="px-3 py-2 {isStreaming ? 'scrollbar-hide max-h-36 overflow-y-auto' : ''}">
        <p class="text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground/70">
          {displayContent}{#if isStreaming}<span class="reasoning-cursor"></span>{/if}
        </p>
      </div>
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
    --base-color: #a1a1aa;
    --base-gradient-color: #000;
    --spread: 16px;
    --bg: linear-gradient(
      90deg,
      transparent calc(50% - var(--spread)),
      var(--base-gradient-color),
      transparent calc(50% + var(--spread))
    );
    position: relative;
    display: inline-block;
    background-image: var(--bg), linear-gradient(var(--base-color), var(--base-color));
    background-size: 250% 100%, auto;
    background-repeat: no-repeat, padding-box;
    background-position: 100% center;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    animation: reasoning-shimmer-slide 1.2s linear infinite;
  }

  :global(.dark) .reasoning-shimmer {
    --base-color: #71717a;
    --base-gradient-color: #ffffff;
  }

  @keyframes reasoning-shimmer-slide {
    0% {
      background-position: 100% center;
    }
    100% {
      background-position: 0% center;
    }
  }

  :global(.scrollbar-hide) {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  :global(.scrollbar-hide::-webkit-scrollbar) {
    display: none;
  }
</style>
