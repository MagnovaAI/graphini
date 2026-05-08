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
  data-slot="sidebar-group-content"
  data-sidebar="group-content"
  class={cn('w-full text-[13px]', className)}
  {...restProps}>
  {@render children?.()}
</div>
