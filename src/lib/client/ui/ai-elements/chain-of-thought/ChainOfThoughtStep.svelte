<script lang="ts">
  import { cn } from '$lib/client/utils';
  import DotIcon from '@lucide/svelte/icons/dot';
  import { getChainOfThoughtContext } from './chain-of-thought-context.svelte.js';
  import type { Component, Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  // Accept any Svelte component for the icon. Both lucide-svelte and
  // @lucide/svelte ship icons as components; we want either to work.
  type IconComponent = Component<{ class?: string }>;

  interface ChainOfThoughtStepProps extends HTMLAttributes<HTMLDivElement> {
    icon?: IconComponent;
    label: string;
    description?: string;
    status?: 'complete' | 'active' | 'pending';
    children?: Snippet;
    class?: string;
    delay?: number;
  }

  let {
    icon: Icon = DotIcon,
    label,
    description,
    status = 'complete',
    children,
    class: className,
    delay,
    ...restProps
  }: ChainOfThoughtStepProps = $props();

  const context = getChainOfThoughtContext();
  let isVisible = $state(false);
  let element: HTMLDivElement;

  const statusStyles = {
    complete: 'text-muted-foreground',
    active: 'text-foreground',
    pending: 'text-muted-foreground/50'
  };

  // Calculate step index based on DOM position
  function getStepIndex(): number {
    if (!element?.parentElement) return 0;
    const steps = Array.from(element.parentElement.querySelectorAll('[data-chain-step]'));
    return steps.indexOf(element);
  }

  // Handle animation when content opens/closes
  $effect(() => {
    if (context.isOpen) {
      const stepIndex = getStepIndex();
      const calculatedDelay = delay ?? stepIndex * 150; // 150ms between each step
      const timer = setTimeout(() => {
        isVisible = true;
      }, calculatedDelay);

      return () => clearTimeout(timer);
    } else {
      isVisible = false;
    }
  });
</script>

<div
  bind:this={element}
  data-chain-step
  class={cn(
    'flex gap-2 text-sm transition-all duration-500 ease-out',
    statusStyles[status],
    isVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
    className
  )}
  {...restProps}>
  <div class="relative mt-0.5">
    <Icon class="size-3.5" />
    <!-- Vertical connector to the next step. Hidden on the last step via the
		:last-of-type rule below so the line doesn't dangle past the chain. -->
    <div class="connector absolute top-5 -bottom-2 left-1/2 -mx-px w-px bg-muted-foreground/50">
    </div>
  </div>
  <div class="flex-1 space-y-2">
    <div class={cn('font-medium text-foreground/75', status === 'active' && 'thinking-shimmer')}>
      {label}
    </div>
    {#if description}
      <div class="text-[12px] text-muted-foreground/60">{description}</div>
    {/if}
    {#if children}
      {@render children()}
    {/if}
  </div>
</div>

<style>
  /* Hide the connector under the last step so the line doesn't dangle. */
  :global([data-chain-step]:last-of-type .connector) {
    display: none;
  }
</style>
