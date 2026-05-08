<script lang="ts">
  import { cn } from '$lib/client/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface ChainOfToolsImageProps extends HTMLAttributes<HTMLDivElement> {
    caption?: string;
    children: Snippet;
    class?: string;
  }

  let { caption, children, class: className, ...restProps }: ChainOfToolsImageProps = $props();
</script>

<div class={cn('mt-2 space-y-2', className)} {...restProps}>
  <div
    class="relative flex max-h-[22rem] items-center justify-center overflow-hidden rounded-lg bg-muted p-3">
    {@render children()}
  </div>
  {#if caption}
    <p class="text-xs text-muted-foreground">{caption}</p>
  {/if}
</div>
