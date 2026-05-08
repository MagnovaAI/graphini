<script lang="ts">
  import { cn } from '$lib/client/utils';
  import { getChainOfToolsContext } from './chain-of-tools-context.svelte.js';
  import { CollapsibleContent } from '$lib/client/ui/collapsible/index.js';
  import type { Snippet } from 'svelte';

  interface ChainOfToolsContentProps {
    children: Snippet;
    class?: string;
  }

  let { children, class: className }: ChainOfToolsContentProps = $props();

  // Assert we're inside a <ChainOfTools>; the call throws if not.
  getChainOfToolsContext();
</script>

<CollapsibleContent
  class={cn(
    'mt-2 space-y-2',
    'text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2',
    className
  )}>
  {@render children()}
</CollapsibleContent>
