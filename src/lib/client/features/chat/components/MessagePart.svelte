<script lang="ts">
  import { cn } from '$lib/client/utils';
  import type { Snippet } from 'svelte';

  let {
    variant = 'block',
    class: className,
    children
  }: {
    variant?: 'compact' | 'block';
    class?: string;
    children: Snippet;
  } = $props();
</script>

<div class={cn('message-part', className)} data-variant={variant}>
  {@render children()}
</div>

<style>
  .message-part {
    min-width: 0;
  }
  .message-part[data-variant='compact'] {
    display: flex;
    min-height: 24px;
    align-items: center;
  }
  .message-part + .message-part {
    margin-top: 10px;
  }
  /* Compact-to-compact: needs breathing room so consecutive tool chips
     don't read as one stacked block. 4px was too tight against the 13px
     title text — 8px lands them as related-but-distinct. */
  .message-part[data-variant='compact'] + .message-part[data-variant='compact'] {
    margin-top: 8px;
  }
</style>
