<script lang="ts">
  import { cn } from '$lib/client/util';
  import * as Select from '$lib/client/ui/select/index.js';

  interface Props {
    class?: string;
    children?: import('svelte').Snippet;
  }

  let { class: className, children, ...props }: Props = $props();
</script>

<Select.Content class={cn(className)} {...props}>
  {#if children}
    {@render children()}
  {/if}
</Select.Content>
