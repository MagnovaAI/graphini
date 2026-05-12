<script lang="ts">
  import { cn } from '$lib/client/utils';
  import { getChainOfToolsContext } from './chain-of-tools-context.svelte.js';
  import { CollapsibleTrigger } from '$lib/client/ui/collapsible/index.js';
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
  import type { Component, Snippet } from 'svelte';

  type IconComponent = Component<{ class?: string }>;

  interface ChainOfToolsHeaderProps {
    children?: Snippet;
    class?: string;
    icon?: IconComponent;
  }

  let { children, class: className, icon: Icon }: ChainOfToolsHeaderProps = $props();

  const context = getChainOfToolsContext();
</script>

<CollapsibleTrigger class={cn('ct-row ct-row-button', className)}>
  {#if Icon}
    <span class="ct-icon">
      <Icon class="size-3.5" />
    </span>
  {/if}
  <span class="ct-title flex-1">
    {#if children}
      {@render children()}
    {:else}
      Chain of Tools
    {/if}
  </span>
  <ChevronDownIcon class={cn('ct-chevron', context.isOpen ? 'rotate-180' : 'rotate-0')} />
</CollapsibleTrigger>
