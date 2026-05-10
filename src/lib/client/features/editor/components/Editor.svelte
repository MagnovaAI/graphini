<script lang="ts">
  import { TID } from '$lib/client/constants';
  import { Button } from '$lib/client/ui/button';
  import { stateStore, updateCode, updateConfig } from '$lib/client/util/state/state';
  import { debounce } from 'lodash-es';
  import { ChevronDown, Wrench } from 'lucide-svelte';
  import { onDestroy } from 'svelte';
  import ExclamationCircleIcon from '~icons/material-symbols/error-outline-rounded';
  import DesktopEditor from './DesktopEditor.svelte';
  import MobileEditor from './MobileEditor.svelte';

  interface Props {
    isMobile?: boolean;
    language?: 'mermaid' | 'json' | 'yaml' | 'markdown';
    onUpdate?: (code: string) => void;
    sendChatMessage?: (message: string, options?: { isRepair?: boolean }) => Promise<boolean>;
    showMermaidError?: boolean;
  }

  const noopUpdate = (code: string) => {
    void code;
  };

  let {
    onUpdate = noopUpdate,
    isMobile = false,
    language = 'mermaid',
    showMermaidError = true,
    sendChatMessage = async () => false
  }: Props = $props();

  const handleUpdate = (text: string) => {
    if ($stateStore.editorMode === 'code') {
      updateCode(text);
    } else {
      updateConfig(text);
    }
    onUpdate(text);
  };

  let showError = $state(false);

  const showErrorDebounced = debounce(() => {
    showError = true;
  }, 5000);

  // Track previous validation error to avoid duplicate panels
  let previousValidationError: string | undefined;

  $effect(() => {
    if ($stateStore.error) {
      showErrorDebounced();
    } else {
      showErrorDebounced.cancel();
      showError = false;
    }
  });

  // Update validation error state for panel display
  $effect(() => {
    if ($stateStore.validationError && $stateStore.validationError !== previousValidationError) {
      previousValidationError = $stateStore.validationError;
    } else if (!$stateStore.validationError) {
      previousValidationError = undefined;
    }
  });

  onDestroy(() => {
    showErrorDebounced.cancel();
  });

  async function handleFixValidationError() {
    const hasValidationError = !!$stateStore.validationError;
    const hasSyntaxError = $stateStore.error instanceof Error;

    if (!hasValidationError && !hasSyntaxError) return;

    let errorMessage = '';

    if (hasValidationError) {
      errorMessage = $stateStore.validationErrorLine
        ? `Line ${$stateStore.validationErrorLine}: ${$stateStore.validationError}`
        : $stateStore.validationError || '';
    } else if (hasSyntaxError) {
      errorMessage = $stateStore.error?.toString() || 'Syntax error';
    }

    const fixMessage = `Please fix this Mermaid error: "${errorMessage}"`;

    try {
      // sendChatMessage handles switching to chat tab — isRepair skips gem cost
      await sendChatMessage(fixMessage, { isRepair: true });
    } catch {
      // Silently fail - user can manually type
    }
  }
</script>

<div class="flex h-full flex-col">
  {#if isMobile}
    <MobileEditor onUpdate={handleUpdate} />
  {:else}
    <DesktopEditor onUpdate={handleUpdate} {language} />
  {/if}

  {#if showMermaidError && ((showError && $stateStore.error instanceof Error) || $stateStore.validationError)}
    {@const errorMsg = $stateStore.validationError
      ? $stateStore.validationErrorLine
        ? `Line ${$stateStore.validationErrorLine}: ${$stateStore.validationError}`
        : $stateStore.validationError
      : $stateStore.error?.toString() || 'Syntax error'}
    <div
      class="error-display flex-shrink-0 border-t border-border"
      data-testid={TID.errorContainer}>
      <div class="flex min-h-10 items-center gap-2 px-3 py-2">
        <div class="flex size-5 shrink-0 items-center justify-center">
          <ExclamationCircleIcon class="size-4 text-destructive" aria-hidden="true" />
        </div>
        <span
          class="min-w-0 flex-1 truncate text-[13px] leading-5 font-medium text-destructive"
          title={errorMsg}>
          {errorMsg.length > 96 ? errorMsg.slice(0, 96) + '…' : errorMsg}
        </span>

        {#if $stateStore.editorMode === 'code'}
          <Button
            variant="outline"
            size="sm"
            data-testid={TID.aiRepairButton}
            onclick={handleFixValidationError}
            class="h-7 shrink-0 gap-1.5 rounded-[5px] border-border bg-transparent px-2.5 text-[13px] font-medium text-foreground transition-colors hover:border-destructive/35 hover:bg-destructive/10 hover:text-destructive">
            <Wrench class="size-3" />
            Repair
          </Button>
        {/if}
      </div>

      <details class="error-details border-t border-border/40">
        <summary
          class="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ChevronDown class="error-details-icon size-3.5" aria-hidden="true" />
          Details
        </summary>
        <div class="max-h-32 overflow-y-auto px-3 pb-2.5">
          <pre
            class="font-mono text-[12px] leading-5 whitespace-pre-wrap text-muted-foreground">{$stateStore.error?.toString() ||
              $stateStore.validationError}</pre>
          {#if $stateStore.validationSuggestions && $stateStore.validationSuggestions.length > 0}
            <div class="mt-2 space-y-1">
              {#each $stateStore.validationSuggestions as suggestion (suggestion)}
                <p class="text-[12px] leading-5 text-muted-foreground">- {suggestion}</p>
              {/each}
            </div>
          {/if}
        </div>
      </details>
    </div>
  {/if}
</div>

<style>
  .error-display {
    background: color-mix(in srgb, var(--background) 82%, var(--destructive) 18%);
  }

  .error-details summary::-webkit-details-marker {
    display: none;
  }

  .error-details :global(.error-details-icon) {
    transition: transform 150ms ease;
  }

  .error-details[open] :global(.error-details-icon) {
    transform: rotate(180deg);
  }
</style>
