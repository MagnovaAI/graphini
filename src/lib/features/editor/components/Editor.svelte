<script lang="ts">
  import { TID } from '$/constants';
  import { Button } from '$lib/components/ui/button';
  import { stateStore, updateCode, updateConfig } from '$lib/util/state/state';
  import { debounce } from 'lodash-es';
  import { Wrench } from 'lucide-svelte';
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
      class="flex-shrink-0 border-t border-border bg-background"
      data-testid={TID.errorContainer}>
      <div class="flex items-center gap-2 px-3 py-2">
        <div class="flex size-5 items-center justify-center rounded bg-red-500/10">
          <ExclamationCircleIcon class="size-3.5 text-red-500" aria-hidden="true" />
        </div>
        <span class="flex-1 truncate text-xs font-medium text-red-600 dark:text-red-400"
          >{errorMsg.length > 80 ? errorMsg.slice(0, 80) + '…' : errorMsg}</span>

        {#if $stateStore.editorMode === 'code'}
          <Button
            variant="outline"
            size="sm"
            data-testid={TID.aiRepairButton}
            onclick={handleFixValidationError}
            class="h-7 shrink-0 gap-1.5 border-red-200/50 bg-red-50/80 px-3 text-[11px] font-medium text-red-600 transition-all hover:bg-red-100/80 dark:border-red-700/50 dark:bg-red-900/50 dark:text-red-400 dark:hover:bg-red-800/50">
            <Wrench class="size-3" />
            Repair
          </Button>
        {/if}
      </div>

      <!-- Collapsible error details -->
      <details class="border-t border-border/30">
        <summary
          class="cursor-pointer px-3 py-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >Show details</summary>
        <div class="max-h-32 overflow-y-auto px-3 pb-2">
          <pre
            class="font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-red-600/80 dark:text-red-400/80">{$stateStore.error?.toString() ||
              $stateStore.validationError}</pre>
          {#if $stateStore.validationSuggestions && $stateStore.validationSuggestions.length > 0}
            <div class="mt-1.5 space-y-0.5">
              {#each $stateStore.validationSuggestions as suggestion (suggestion)}
                <p class="text-[10px] text-muted-foreground">• {suggestion}</p>
              {/each}
            </div>
          {/if}
        </div>
      </details>
    </div>
  {/if}
</div>
