<script lang="ts">
  import { cn } from '$lib/client/utils';
  import { Badge } from '$lib/client/ui/badge/index.js';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface ChainOfToolsSearchResultProps extends HTMLAttributes<HTMLElement> {
    children: Snippet;
    class?: string;
  }

  let { children, class: className, ...restProps }: ChainOfToolsSearchResultProps = $props();
</script>

<Badge
  class={cn('gap-1 px-2 py-0.5 text-xs font-normal', className)}
  variant="secondary"
  {...restProps}>
  {@render children()}
</Badge>
