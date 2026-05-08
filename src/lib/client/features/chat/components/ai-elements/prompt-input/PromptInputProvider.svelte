<script lang="ts">
  import { PromptInputController, setPromptInputProvider } from './attachments-context.svelte.js';

  interface Props {
    initialInput?: string;
    accept?: string;
    multiple?: boolean;
    children?: import('svelte').Snippet;
  }

  let { initialInput = '', accept, multiple = true, children }: Props = $props();

  // Use $derived to create reactive controller
  $effect(() => {
    const controller = new PromptInputController(initialInput, accept, multiple);
    setPromptInputProvider(controller);
  });
</script>

{#if children}
  {@render children()}
{/if}
