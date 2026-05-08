<script lang="ts">
  import {
    ChartBar,
    ChevronRight,
    Eye,
    FileText,
    Globe,
    Lightbulb,
    MessageCircleQuestion,
    Paintbrush,
    Palette,
    ShieldCheck,
    Trash2,
    Wrench
  } from 'lucide-svelte';

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
  }

  let {
    toolName,
    titlePending,
    titleDone,
    subtitle,
    status,
    details,
    searchResults
  }: Props = $props();

  let isExpanded = $state(false);

  const hasSearchResults = $derived((searchResults?.length ?? 0) > 0);
  const hasDetails = $derived(hasSearchResults || (details?.length ?? 0) > 0);
  const isPending = $derived(status === 'running');

  function toggle() {
    if (!hasDetails) return;
    isExpanded = !isExpanded;
  }
</script>

<svelte:element
  this={hasDetails ? 'button' : 'div'}
  type={hasDetails ? 'button' : undefined}
  class="group flex items-center gap-2 px-2 py-1 {hasDetails ? 'w-full cursor-pointer text-left' : ''}"
  aria-expanded={hasDetails ? isExpanded : undefined}
  onclick={toggle}>
  {#if toolName === 'autoStyler' || toolName === 'styleSearch'}
    <Paintbrush
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {:else if toolName === 'iconifier' || toolName === 'iconSearch'}
    <Palette
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {:else if toolName === 'webSearch'}
    <Globe
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {:else if toolName === 'fileManager'}
    <FileText
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {:else if toolName === 'errorChecker'}
    <ShieldCheck
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {:else if toolName === 'dataAnalyzer'}
    <ChartBar
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {:else if toolName === 'thinking'}
    <Lightbulb
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {:else if toolName === 'askQuestions'}
    <MessageCircleQuestion
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {:else if toolName === 'diagramRead'}
    <Eye
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {:else if toolName === 'diagramDelete'}
    <Trash2
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {:else}
    <Wrench
      class="size-3.5 flex-shrink-0 text-muted-foreground/70 {isPending ? 'animate-pulse' : ''}" />
  {/if}
  <div class="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground">
    <span class="flex-shrink-0 font-medium whitespace-nowrap">
      {#if isPending}
        <span class="thinking-shimmer inline-flex h-4 items-center text-[13px] leading-none">
          {titlePending}
        </span>
      {:else}
        {titleDone}
      {/if}
    </span>
    {#if subtitle}
      <span class="min-w-0 truncate font-normal text-muted-foreground/60">{subtitle}</span>
    {/if}
    {#if hasDetails}
      <ChevronRight
        class="size-3.5 flex-shrink-0 text-muted-foreground/60 transition-transform duration-200 ease-out {isExpanded
          ? 'rotate-90'
          : 'opacity-0 group-hover:opacity-100'}" />
    {/if}
  </div>
</svelte:element>
{#if hasDetails && isExpanded}
  <div
    class="mt-1 overflow-y-auto rounded-md border border-border/40 px-3 py-2"
    style="max-height: 280px; background-color: var(--tool-box-bg);">
    {#if hasSearchResults}
      <ul class="space-y-2">
        {#each searchResults ?? [] as result, rIdx (`${result.url ?? result.title}:${rIdx}`)}
          <li class="flex flex-col gap-0.5">
            {#if result.url}
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                class="text-[13px] font-medium text-foreground/90 hover:text-foreground hover:underline">
                {result.title}
              </a>
            {:else}
              <span class="text-[13px] font-medium text-foreground/90">{result.title}</span>
            {/if}
            {#if result.source || result.url}
              <span class="text-[11px] text-muted-foreground/60">
                {result.source ?? new URL(result.url ?? 'http://x').hostname.replace(/^www\./, '')}
              </span>
            {/if}
            {#if result.snippet}
              <span class="text-[12px] leading-relaxed text-muted-foreground/75">
                {result.snippet}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="space-y-1">
        {#each details ?? [] as detail, dIdx (`${detail}:${dIdx}`)}
          <div
            class="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground/75">
            <span class="mt-1 shrink-0 text-muted-foreground/40">·</span>
            <span class="min-w-0">{detail}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
