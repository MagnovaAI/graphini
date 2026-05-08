<script lang="ts">
  import { cn } from '$lib/util';
  import { FileText, X } from 'lucide-svelte';
  import { getAttachmentsContext, type FileWithId } from './attachments-context.svelte.js';

  interface Props {
    data: FileWithId;
    class?: string;
  }

  let { data, class: className, ...props }: Props = $props();

  let attachments = getAttachmentsContext();

  let isImage = $derived(data.mediaType?.startsWith('image/') && data.url);
  let fileExt = $derived.by(() => {
    const name = data.filename || '';
    const parts = name.split('.');
    return parts.length > 1 ? (parts[parts.length - 1] ?? '?').toUpperCase() : '?';
  });

  // File type color mapping for extension badges
  let extColor = $derived.by(() => {
    const ext = fileExt.toLowerCase();
    if (ext === 'pdf')
      return {
        bg: 'bg-red-500/20',
        text: 'text-red-600 dark:text-red-400',
        border: 'border-red-500/20',
        icon: 'text-red-500 dark:text-red-400'
      };
    if (['doc', 'docx', 'rtf'].includes(ext))
      return {
        bg: 'bg-blue-500/20',
        text: 'text-blue-600 dark:text-blue-400',
        border: 'border-blue-500/20',
        icon: 'text-blue-500 dark:text-blue-400'
      };
    if (['xls', 'xlsx', 'csv'].includes(ext))
      return {
        bg: 'bg-emerald-500/20',
        text: 'text-emerald-600 dark:text-emerald-400',
        border: 'border-emerald-500/20',
        icon: 'text-emerald-500 dark:text-emerald-400'
      };
    if (['json', 'xml', 'yaml', 'yml', 'toml'].includes(ext))
      return {
        bg: 'bg-amber-500/20',
        text: 'text-amber-600 dark:text-amber-400',
        border: 'border-amber-500/20',
        icon: 'text-amber-500 dark:text-amber-400'
      };
    if (['js', 'ts', 'py', 'rb', 'go', 'rs', 'java', 'cpp', 'c', 'h'].includes(ext))
      return {
        bg: 'bg-violet-500/20',
        text: 'text-violet-600 dark:text-violet-400',
        border: 'border-violet-500/20',
        icon: 'text-violet-500 dark:text-violet-400'
      };
    if (['md', 'txt', 'log'].includes(ext))
      return {
        bg: 'bg-sky-500/20',
        text: 'text-sky-600 dark:text-sky-400',
        border: 'border-sky-500/20',
        icon: 'text-sky-500 dark:text-sky-400'
      };
    if (['svg', 'html', 'css'].includes(ext))
      return {
        bg: 'bg-orange-500/20',
        text: 'text-orange-600 dark:text-orange-400',
        border: 'border-orange-500/20',
        icon: 'text-orange-500 dark:text-orange-400'
      };
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext))
      return {
        bg: 'bg-violet-500/20',
        text: 'text-violet-600 dark:text-violet-400',
        border: 'border-violet-500/20',
        icon: 'text-violet-500 dark:text-violet-400'
      };
    return {
      bg: 'bg-muted',
      text: 'text-muted-foreground',
      border: 'border-border',
      icon: 'text-muted-foreground'
    };
  });
</script>

{#if isImage}
  <div
    class={cn(
      'group relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border border-border/70 transition-colors duration-150 hover:border-border',
      className
    )}
    title={data.filename || 'Image'}
    {...props}>
    <img alt={data.filename || 'Attachment'} class="h-full w-full object-cover" src={data.url} />
    <button
      aria-label="Remove attachment"
      class="hover:text-destructive-foreground absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-muted-foreground opacity-0 transition-colors duration-150 group-hover:opacity-100 hover:bg-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none"
      onclick={() => attachments.remove(data.id)}
      type="button">
      <X class="size-3" />
    </button>
  </div>
{:else}
  <div
    class={cn(
      'group relative flex h-8 max-w-[240px] min-w-0 flex-shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-muted px-2 text-[11px] transition-colors duration-150 hover:border-border',
      className
    )}
    title={data.filename || 'File'}
    {...props}>
    <span class="flex size-5 shrink-0 items-center justify-center rounded {extColor.bg}">
      <FileText class="size-3 {extColor.icon}" />
    </span>
    <span class="min-w-0 flex-1 truncate text-foreground/85">{data.filename || 'File'}</span>
    <span class="shrink-0 rounded bg-foreground/10 px-1 py-px text-[9px] font-medium {extColor.text}">
      {fileExt}
    </span>
    <button
      aria-label="Remove attachment"
      class="flex h-5 w-0 shrink-0 items-center justify-center overflow-hidden rounded text-muted-foreground opacity-0 transition-[width,opacity,background-color,color] duration-150 group-hover:ml-0.5 group-hover:w-5 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:ml-0.5 focus-visible:w-5 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/20 focus-visible:outline-none"
      onclick={() => attachments.remove(data.id)}
      type="button">
      <X class="size-3" />
    </button>
  </div>
{/if}
