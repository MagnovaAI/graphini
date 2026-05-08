<script lang="ts">
  import { cn } from '$lib/client/utils';
  import { getChainOfThoughtContext } from './chain-of-thought-context.svelte.js';
  import { CollapsibleTrigger } from '$lib/client/ui/collapsible/index.js';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import type { Component, Snippet } from 'svelte';

  type IconComponent = Component<{ class?: string }>;

  interface ChainOfThoughtHeaderProps {
    children?: Snippet;
    class?: string;
    icon?: IconComponent;
  }

  let { children, class: className, icon: Icon }: ChainOfThoughtHeaderProps = $props();

  const context = getChainOfThoughtContext();
</script>

<CollapsibleTrigger
  class={cn(
    'flex w-full items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground',
    className
  )}>
  {#if Icon}
    <Icon class="size-4" />
  {/if}
  <span class="flex-1 text-left">
    {#if children}
      {@render children()}
    {:else}
      Chain of Thought
    {/if}
  </span>
  <ChevronDownIcon
    class={cn(
      'size-4 text-muted-foreground/60 transition-transform',
      context.isOpen ? 'rotate-180' : 'rotate-0'
    )} />
</CollapsibleTrigger>
