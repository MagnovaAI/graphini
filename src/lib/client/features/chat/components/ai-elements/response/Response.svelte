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
    'prose streamdown-fade size-full',
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

<style>
  /* Per-block fade-in for streamed prose. Each block child (p, ul, ol, li,
     h1-h6, blockquote, pre, table) gets a one-shot 180ms reveal when it
     first mounts. Streamdown's incremental DOM keeps existing nodes
     stable, so only freshly-arrived blocks animate. */
  :global(.streamdown-fade > *),
  :global(.streamdown-fade li) {
    animation: streamdown-fade-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes streamdown-fade-in {
    from {
      opacity: 0;
      transform: translateY(2px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.streamdown-fade > *),
    :global(.streamdown-fade li) {
      animation: none;
    }
  }
</style>
