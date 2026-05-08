<script lang="ts">
  import * as Tooltip from './index.js';
  import type { Snippet } from 'svelte';

  interface Props {
    text: string;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
    delayDuration?: number;
    children: Snippet;
  }

  let {
    text,
    side = 'top',
    align = 'center',
    sideOffset = 6,
    delayDuration = 200,
    children
  }: Props = $props();
</script>

<Tooltip.Root {delayDuration}>
  <Tooltip.Trigger>
    {@render children()}
  </Tooltip.Trigger>
  <Tooltip.Content {side} {align} {sideOffset}>
    {text}
  </Tooltip.Content>
</Tooltip.Root>
