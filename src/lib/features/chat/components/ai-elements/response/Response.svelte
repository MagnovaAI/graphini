<script lang="ts">
  import { Streamdown, type StreamdownProps } from 'svelte-streamdown';
  import ChatCodeBlock from './ChatCodeBlock.svelte';
  import { cn } from '$lib/utils';
  import { mode } from 'mode-watcher';
  // VS Code Dark+ / Light+ themes (matches 1code chat code blocks)
  import darkPlus from '@shikijs/themes/dark-plus';
  import lightPlus from '@shikijs/themes/light-plus';

  type Props = StreamdownProps & {
    class?: string;
  };

  let { class: className, ...restProps }: Props = $props();
  let currentTheme = $derived(mode.current === 'dark' ? 'dark-plus' : 'light-plus');
</script>

<Streamdown
  class={cn('prose size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
  shikiTheme={currentTheme}
  baseTheme="shadcn"
  components={{ code: ChatCodeBlock, mermaid: ChatCodeBlock }}
  shikiThemes={{
    'light-plus': lightPlus,
    'dark-plus': darkPlus
  }}
  {...restProps} />
