<script lang="ts">
  import { cn } from '$lib/client/utils';
  import { getChainOfThoughtContext } from './chain-of-thought-context.svelte.js';
  import { CollapsibleContent } from '$lib/client/ui/collapsible/index.js';
  import type { Snippet } from 'svelte';

  interface ChainOfThoughtContentProps {
    children: Snippet;
    class?: string;
  }

  let { children, class: className }: ChainOfThoughtContentProps = $props();

  // Assert we're inside a <ChainOfThought>; the call throws if not.
  getChainOfThoughtContext();
</script>

<CollapsibleContent
  class={cn(
    'mt-2 space-y-2',
    'text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2',
    className
  )}>
  {@render children()}
</CollapsibleContent>
