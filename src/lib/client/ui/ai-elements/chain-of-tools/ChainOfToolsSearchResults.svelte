<script lang="ts">
  import { cn } from '$lib/client/utils';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface ChainOfToolsSearchResultsProps extends HTMLAttributes<HTMLDivElement> {
    children: Snippet;
    class?: string;
  }

  let { children, class: className, ...restProps }: ChainOfToolsSearchResultsProps = $props();
</script>

<div class={cn('flex items-center gap-2', className)} {...restProps}>
  {@render children()}
</div>
