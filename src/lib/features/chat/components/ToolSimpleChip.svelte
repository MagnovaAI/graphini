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

  interface Props {
    toolName: string;
    titlePending: string;
    titleDone: string;
    subtitle?: string;
    status: 'running' | 'done';
    details?: string[];
  }

  let { toolName, titlePending, titleDone, subtitle, status, details }: Props = $props();

  let isExpanded = $state(false);

  const hasDetails = $derived((details?.length ?? 0) > 0);
  const isPending = $derived(status === 'running');

  function toggle() {
    if (!hasDetails) return;
    isExpanded = !isExpanded;
  }

  function handleKey(e: KeyboardEvent) {
    if (!hasDetails) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  }
</script>

<div
  class="group flex items-center gap-2 px-2 py-1 {hasDetails ? 'cursor-pointer' : ''}"
  role={hasDetails ? 'button' : undefined}
  tabindex={hasDetails ? 0 : undefined}
  onclick={toggle}
  onkeydown={handleKey}>
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
</div>
{#if hasDetails && isExpanded}
  <div
    class="mt-1 overflow-y-auto rounded-md border border-border/40 px-3 py-2"
    style="max-height: 250px; background-color: var(--tool-box-bg);">
    <div class="space-y-1">
      {#each details ?? [] as detail, dIdx (`${detail}:${dIdx}`)}
        <div class="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground/75">
          <span class="mt-1 shrink-0 text-muted-foreground/40">·</span>
          <span class="min-w-0">{detail}</span>
        </div>
      {/each}
    </div>
  </div>
{/if}
