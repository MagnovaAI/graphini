<script lang="ts">
  import { cn, type WithElementRef } from '$lib/client/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
  bind:this={ref}
  class={cn('flex flex-col space-y-2 text-center sm:text-left', className)}
  {...restProps}>
  {@render children?.()}
</div>
