<script lang="ts">
  import { cn, type WithElementRef } from '$lib/client/utils.js';
  import type { HTMLAttributes } from 'svelte/elements';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLUListElement>> = $props();
</script>

<ul
  bind:this={ref}
  data-slot="sidebar-menu-sub"
  data-sidebar="menu-sub"
  class={cn(
    'mx-4 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-3 py-1 group-data-[collapsible=icon]:hidden',
    className
  )}
  {...restProps}>
  {@render children?.()}
</ul>
