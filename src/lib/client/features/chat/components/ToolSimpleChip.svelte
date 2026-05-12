<script lang="ts">
  import { ChevronRight } from 'lucide-svelte';
  import { toolIcon } from '$lib/client/features/chat/content-parts/tool-icons';
  import { getToolDisplayName } from '$lib/client/features/chat/content-parts/tool-display';

  interface SearchResult {
    title: string;
    snippet?: string;
    url?: string;
    source?: string;
  }

  interface Props {
    toolName: string;
    titlePending: string;
    titleDone: string;
    subtitle?: string;
    status: 'running' | 'done';
    details?: string[];
    searchResults?: SearchResult[];
    toolInput?: { path?: unknown; from?: unknown; operation?: unknown };
  }

  let {
    toolName,
    titlePending,
    titleDone,
    subtitle,
    status,
    details,
    searchResults,
    toolInput
  }: Props = $props();

  let isExpanded = $state(false);

  const hasSearchResults = $derived((searchResults?.length ?? 0) > 0);
  const hasDetails = $derived(hasSearchResults || (details?.length ?? 0) > 0);
  const isPending = $derived(status === 'running');
  const Icon = $derived(toolIcon(toolName, toolInput));
  const displayName = $derived(getToolDisplayName(toolName));
  const secondaryText = $derived(
    subtitle || (titlePending === 'Running' || titleDone === 'Done' ? displayName : '')
  );

  $effect(() => {
    if (toolName === 'webSearch' && hasSearchResults && status === 'done') {
      isExpanded = true;
    }
  });

  function toggle() {
    if (!hasDetails) return;
    isExpanded = !isExpanded;
  }
</script>

{#snippet chipContent()}
  <span class="ct-icon {isPending ? 'tool-active-icon-shimmer' : ''}">
    <Icon class="size-3.5 flex-shrink-0" />
  </span>
  <span class="ct-title">
    {#if isPending}
      <span class="thinking-shimmer">{titlePending}</span>
    {:else}
      {titleDone}
    {/if}
  </span>
  {#if secondaryText}
    <span class="ct-subtitle">{secondaryText}</span>
  {/if}
  {#if hasDetails}
    <ChevronRight
      class="ct-chevron {isExpanded ? 'rotate-90' : 'opacity-0 group-hover:opacity-100'}" />
  {/if}
{/snippet}

{#if hasDetails}
  <button
    type="button"
    class="ct-row ct-row-button group {isPending ? 'tool-active-shimmer' : ''}"
    aria-expanded={isExpanded}
    onclick={toggle}>
    {@render chipContent()}
  </button>
{:else}
  <div class="ct-row group {isPending ? 'tool-active-shimmer' : ''}">
    {@render chipContent()}
  </div>
{/if}

{#if hasDetails && isExpanded}
  <div class="ct-panel">
    {#if hasSearchResults}
      <div class="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>Search results</span>
        <span>{searchResults?.length ?? 0}</span>
      </div>
      <ul class="space-y-2">
        {#each searchResults ?? [] as result, rIdx (`${result.url ?? result.title}:${rIdx}`)}
          <li class="flex flex-col gap-0.5">
            {#if result.url}
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-[12px] font-medium text-foreground/90 hover:text-foreground hover:underline">
                {result.title}
              </a>
            {:else}
              <span class="text-[12px] font-medium text-foreground/90">{result.title}</span>
            {/if}
            {#if result.source || result.url}
              <span class="text-[11px] text-muted-foreground/60">
                {result.source ?? new URL(result.url ?? 'http://x').hostname.replace(/^www\./, '')}
              </span>
            {/if}
            {#if result.snippet}
              <span class="text-[11px] leading-relaxed text-muted-foreground/75">
                {result.snippet}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="ct-panel-text space-y-1">
        {#each details ?? [] as detail, dIdx (`${detail}:${dIdx}`)}
          <div class="min-w-0">{detail}</div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
