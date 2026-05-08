<script lang="ts">
  import { Dialog as SheetPrimitive } from 'bits-ui';
  import { cn } from '$lib/client/utils.js';

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: SheetPrimitive.DescriptionProps = $props();
</script>

<SheetPrimitive.Description
  bind:ref
  data-slot="sheet-description"
  class={cn('text-[13px] text-muted-foreground', className)}
  {...restProps} />
