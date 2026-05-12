<script lang="ts">
  import { cn } from '$lib/client/utils';
  import type { Snippet } from 'svelte';

  let {
    variant = 'block',
    class: className,
    children
  }: {
    variant?: 'compact' | 'block';
    class?: string;
    children: Snippet;
  } = $props();
</script>

<div class={cn('message-part', className)} data-variant={variant}>
  {@render children()}
</div>

<style>
  /* :global so the runtime class string from cn() actually matches —
     Svelte's default scoping would suffix `.svelte-xxx` and miss. */
  :global(.message-part) {
    min-width: 0;
    animation: message-part-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes message-part-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.message-part) {
      animation: none;
    }
  }
  :global(.message-part[data-variant='compact']) {
    display: flex;
    min-height: 24px;
    align-items: center;
  }
  :global(.message-part + .message-part) {
    margin-top: 10px;
  }
  :global(.message-part[data-variant='compact'] + .message-part[data-variant='compact']) {
    margin-top: 8px;
  }
</style>
