<script lang="ts">
  import { cn } from '$lib/client/utils';
  import { Collapsible } from '$lib/client/ui/collapsible/index.js';
  import {
    ChainOfThoughtContext,
    setChainOfThoughtContext
  } from './chain-of-thought-context.svelte.js';
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  interface ChainOfThoughtProps extends HTMLAttributes<HTMLDivElement> {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: Snippet;
    class?: string;
  }

  let {
    open = $bindable(undefined),
    defaultOpen = false,
    onOpenChange,
    children,
    class: className,
    ...restProps
  }: ChainOfThoughtProps = $props();

  const context = new ChainOfThoughtContext();
  let didInitializeOpen = false;

  $effect(() => {
    context.setOnOpenChange(onOpenChange);
  });

  $effect(() => {
    if (!didInitializeOpen) {
      context.syncOpen(open !== undefined ? open : defaultOpen);
      didInitializeOpen = true;
    } else if (open !== undefined) {
      context.syncOpen(open);
    }
  });

  // Set the context for child components
  setChainOfThoughtContext(context);
</script>

<Collapsible open={context.isOpen} onOpenChange={context.setIsOpen}>
  <div class={cn('not-prose max-w-prose space-y-2', className)} {...restProps}>
    {@render children()}
  </div>
</Collapsible>
