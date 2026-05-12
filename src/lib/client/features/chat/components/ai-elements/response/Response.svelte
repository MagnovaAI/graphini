<script lang="ts">
  import { Streamdown, type StreamdownProps } from 'svelte-streamdown';
  import ChatCodeBlock from './ChatCodeBlock.svelte';
  import { cn } from '$lib/client/utils';
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
  class={cn(
    'prose size-full',
    // Kill the prose plugin's heavy paragraph spacing inside chat messages.
    // The chat's outer space-y-1.5 is the single source of vertical rhythm;
    // prose's own 1.25em <p> margins were doubling that gap and producing
    // the uneven spacing between tool chips and prose paragraphs.
    'prose-p:my-1 prose-p:leading-6',
    'prose-ul:my-1 prose-ol:my-1 prose-li:my-0',
    'prose-headings:my-2',
    '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
    className
  )}
  shikiTheme={currentTheme}
  baseTheme="shadcn"
  components={{ code: ChatCodeBlock, mermaid: ChatCodeBlock }}
  shikiThemes={{
    'light-plus': lightPlus,
    'dark-plus': darkPlus
  }}
  {...restProps} />
