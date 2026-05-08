<script lang="ts">
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { cn } from '$lib/client/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: DialogPrimitive.TitleProps = $props();
</script>

<DialogPrimitive.Title
  bind:ref
  class={cn('text-[18px] leading-none font-semibold tracking-tight', className)}
  {...restProps} />
