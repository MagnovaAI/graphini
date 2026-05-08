<script lang="ts">
  /**
   * Chain of Tools step.
   *
   * Visual is intentionally a copy of `ChainOfThoughtStep` — same icon,
   * connector geometry, animation, label/description layout. We do NOT
   * delegate to `ChainOfThoughtStep` because it pulls Thought context via
   * `getChainOfThoughtContext()`, which only exists inside a Thought root;
   * mounting it inside `<ChainOfTools>` throws "must be used within
   * ChainOfThought". So this is a Tools-context twin.
   *
   * Tools-only additions on top of the Thought visual:
   *   1. when `toggleable && children`, the whole row toggles `open`
   *      on click, and the children render only when open;
   *   2. clicks on links/buttons inside the expanded children pass through
   *      without toggling.
   */
  import { cn } from '$lib/client/utils';
  import DotIcon from '@lucide/svelte/icons/dot';
  import { getChainOfToolsContext } from './chain-of-tools-context.svelte.js';
  import type { Component, Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type IconComponent = Component<{ class?: string }>;

  interface ChainOfToolsStepProps extends HTMLAttributes<HTMLDivElement> {
    icon?: IconComponent;
    label: string;
    description?: string;
    status?: 'complete' | 'active' | 'pending';
    children?: Snippet;
    class?: string;
    delay?: number;
    /** When true the step row toggles `open` on click. */
    toggleable?: boolean;
    /** Bindable open state — controls visibility of the output children. */
    open?: boolean;
  }

  let {
    icon: Icon = DotIcon,
    label,
    description,
    status = 'complete',
    children,
    class: className,
    delay,
    toggleable = false,
    open = $bindable(false),
    ...restProps
  }: ChainOfToolsStepProps = $props();

  const context = getChainOfToolsContext();
  let isVisible = $state(false);
  let element: HTMLDivElement;

  const interactive = $derived(toggleable && Boolean(children));

  const statusStyles = {
    complete: 'text-muted-foreground',
    active: 'text-foreground',
    pending: 'text-muted-foreground/50'
  };

  function getStepIndex(): number {
    if (!element?.parentElement) return 0;
    const steps = Array.from(element.parentElement.querySelectorAll('[data-chain-step]'));
    return steps.indexOf(element);
  }

  $effect(() => {
    if (context.isOpen) {
      const stepIndex = getStepIndex();
      const calculatedDelay = delay ?? stepIndex * 150;
      const timer = setTimeout(() => {
        isVisible = true;
      }, calculatedDelay);
      return () => clearTimeout(timer);
    } else {
      isVisible = false;
    }
  });

  function onRowClick(e: MouseEvent) {
    if (!interactive) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("a, button, input, textarea, select, [role='button']")) return;
    open = !open;
  }

  function onRowKey(e: KeyboardEvent) {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open = !open;
    }
  }
</script>

<div
  bind:this={element}
  data-chain-step
  role={interactive ? 'button' : undefined}
  tabindex={interactive ? 0 : undefined}
  aria-expanded={interactive ? open : undefined}
  onclick={interactive ? onRowClick : undefined}
  onkeydown={interactive ? onRowKey : undefined}
  class={cn(
    'flex gap-2 text-sm transition-all duration-500 ease-out',
    statusStyles[status],
    isVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
    interactive && '-mx-1 cursor-pointer rounded px-1 transition-colors hover:bg-muted/30',
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
    <div class="flex w-full items-baseline gap-2">
      <span class={cn('font-medium text-foreground/75', status === 'active' && 'thinking-shimmer')}>
        {label}
      </span>
      {#if description}
        <span class="min-w-0 flex-1 truncate text-[12px] text-muted-foreground/60"
          >{description}</span>
      {/if}
    </div>
    {#if children && (!toggleable || open)}
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
