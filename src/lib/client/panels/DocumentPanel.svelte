<script lang="ts">
  /**
   * Document panel — preview-only renderer for the active .md workspace file.
   *
   * Rendering stack:
   *  - `@humanspeak/svelte-markdown` — Svelte component, renders markdown
   *    via per-token components. Streaming-aware. Allows raw HTML through
   *    its `Html` renderer (sanitized).
   *  - `markedFootnote` extension for footnote support.
   *  - Post-render shiki pass for fenced code blocks (GitHub themes,
   *    languages lazy-loaded). Same shiki instance used everywhere.
   *  - Tailwind Typography `prose` for layout/spacing, with CSS-variable
   *    overrides bound to the design tokens.
   */
  import { filesStore } from '$lib/client/stores/files.svelte';
  import { inputStateStore } from '$lib/client/util/state/state';
  import { ensureShikiLanguage, getSharedHighlighter } from '$lib/client/util/editor/shikiSetup';
  import { FileText } from 'lucide-svelte';
  import { mode } from 'mode-watcher';
  import SvelteMarkdown from '@humanspeak/svelte-markdown';
  import { markedFootnote } from '@humanspeak/svelte-markdown/extensions';

  const activeFile = $derived(filesStore.activeFile);
  const activeFileName = $derived.by(() => {
    if (!activeFile) return 'Untitled';
    return activeFile.path.split('/').pop() ?? activeFile.path;
  });

  const markdownContent = $derived($inputStateStore.code ?? '');

  // SvelteMarkdown emits per-token components, so the rendered DOM lives
  // inside the wrapper article. We attach a $effect that walks fenced code
  // blocks and replaces them with shiki-highlighted markup.
  let articleEl = $state<HTMLElement | null>(null);

  async function highlightCodeBlocks(root: HTMLElement, theme: 'github-dark' | 'github-light') {
    const codes = root.querySelectorAll<HTMLElement>('pre:not([data-shiki-done]) > code');
    if (codes.length === 0) return;
    const hl = await getSharedHighlighter().catch(() => null);
    if (!hl) return;
    for (const codeEl of codes) {
      const pre = codeEl.parentElement as HTMLPreElement | null;
      if (!pre || pre.dataset.shikiDone) continue;
      const langClass = [...codeEl.classList].find((c) => c.startsWith('language-'));
      const lang = langClass ? langClass.slice('language-'.length).trim() : '';
      const code = codeEl.textContent ?? '';
      pre.dataset.shikiDone = '1';
      if (!code || !lang) continue;
      const ok = await ensureShikiLanguage(lang);
      if (!ok) continue;
      try {
        const html = hl.codeToHtml(code, { lang, theme });
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        const newPre = wrap.firstElementChild as HTMLElement | null;
        if (!newPre) continue;
        newPre.dataset.shikiDone = '1';
        pre.replaceWith(newPre);
      } catch {
        /* keep original <pre> on failure */
      }
    }
  }

  // Re-run highlighting when content changes or theme flips.
  $effect(() => {
    void markdownContent;
    void $mode;
    if (!articleEl) return;
    const theme = $mode === 'dark' ? 'github-dark' : 'github-light';
    // Defer one frame so SvelteMarkdown has finished mounting tokens.
    queueMicrotask(() => {
      if (articleEl) void highlightCodeBlocks(articleEl, theme);
    });
  });
</script>

<div class="flex h-full flex-col bg-card">
  <!-- Header: same chrome as Canvas/Code so users see which file is rendering. -->
  <div class="flex h-10 items-center justify-between border-b border-border/30 px-3">
    <div
      class="flex min-w-0 flex-1 items-center gap-2"
      title={activeFile ? activeFileName : 'Document'}>
      {#if activeFile}
        <img src="/icons/file-md.svg" alt="" class="size-4 shrink-0" />
        <span class="truncate text-[13px] font-semibold text-foreground">{activeFileName}</span>
      {:else}
        <FileText class="size-4 shrink-0 text-muted-foreground" />
        <span class="text-[13px] font-semibold text-foreground">Document</span>
      {/if}
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-hidden">
    <div class="scrollbar-thin h-full overflow-y-auto px-8 py-6">
      {#if markdownContent.trim()}
        <article
          bind:this={articleEl}
          class="doc-prose prose prose-sm dark:prose-invert max-w-none">
          <SvelteMarkdown
            source={markdownContent}
            extensions={[markedFootnote()]}
            options={{ headerIds: true, gfm: true, breaks: true }} />
        </article>
      {:else}
        <p class="text-[13px] text-muted-foreground italic">
          No content yet. Type in the Code panel.
        </p>
      {/if}
    </div>
  </div>
</div>

<style>
  /* Tailwind Typography (`prose`) handles type scale + spacing. We override
   * its CSS variables so colors track the app's design tokens. The token
   * format in this project is mixed (hsl(...) wrapped values in light mode,
   * hex in dark mode), so we use the variables directly with `color-mix`
   * for any opacity tinting — this works regardless of the source format. */
  :global(.doc-prose) {
    --tw-prose-body: color-mix(in oklab, var(--foreground), transparent 14%);
    --tw-prose-headings: var(--foreground);
    --tw-prose-lead: color-mix(in oklab, var(--foreground), transparent 25%);
    --tw-prose-links: var(--primary);
    --tw-prose-bold: var(--foreground);
    --tw-prose-counters: var(--muted-foreground);
    --tw-prose-bullets: color-mix(in oklab, var(--border), transparent 0%);
    --tw-prose-hr: color-mix(in oklab, var(--border), transparent 60%);
    --tw-prose-quotes: color-mix(in oklab, var(--foreground), transparent 30%);
    --tw-prose-quote-borders: color-mix(in oklab, var(--primary), transparent 50%);
    --tw-prose-captions: var(--muted-foreground);
    --tw-prose-code: var(--foreground);
    --tw-prose-pre-code: var(--foreground);
    --tw-prose-pre-bg: color-mix(in oklab, var(--muted), transparent 50%);
    --tw-prose-th-borders: color-mix(in oklab, var(--border), transparent 50%);
    --tw-prose-td-borders: color-mix(in oklab, var(--border), transparent 70%);
    --tw-prose-invert-body: color-mix(in oklab, var(--foreground), transparent 14%);
    --tw-prose-invert-headings: var(--foreground);
    --tw-prose-invert-lead: color-mix(in oklab, var(--foreground), transparent 25%);
    --tw-prose-invert-links: var(--primary);
    --tw-prose-invert-bold: var(--foreground);
    --tw-prose-invert-counters: var(--muted-foreground);
    --tw-prose-invert-bullets: var(--border);
    --tw-prose-invert-hr: color-mix(in oklab, var(--border), transparent 60%);
    --tw-prose-invert-quotes: color-mix(in oklab, var(--foreground), transparent 30%);
    --tw-prose-invert-quote-borders: color-mix(in oklab, var(--primary), transparent 50%);
    --tw-prose-invert-captions: var(--muted-foreground);
    --tw-prose-invert-code: var(--foreground);
    --tw-prose-invert-pre-code: var(--foreground);
    --tw-prose-invert-pre-bg: color-mix(in oklab, var(--muted), transparent 50%);
    --tw-prose-invert-th-borders: color-mix(in oklab, var(--border), transparent 50%);
    --tw-prose-invert-td-borders: color-mix(in oklab, var(--border), transparent 70%);
  }

  /* Inline code: pill that uses tokens, not prose's default fixed greys. */
  :global(.doc-prose :not(pre) > code) {
    background: color-mix(in oklab, var(--muted), transparent 35%);
    border: 1px solid color-mix(in oklab, var(--border), transparent 70%);
    border-radius: 0.375rem;
    padding: 0.05rem 0.35rem;
    font-weight: 500;
  }
  :global(.doc-prose :not(pre) > code::before),
  :global(.doc-prose :not(pre) > code::after) {
    content: '';
  }

  /* shiki <pre> blocks (replace the default <pre> after post-render highlight). */
  :global(.doc-prose pre.shiki) {
    background: var(--shiki-bg, color-mix(in oklab, var(--muted), transparent 60%)) !important;
    border: 1px solid color-mix(in oklab, var(--border), transparent 70%);
    border-radius: 0.5rem;
    padding: 0.875rem 1rem;
    overflow-x: auto;
    font-size: 0.78rem;
    line-height: 1.55;
  }
  :global(.doc-prose pre.shiki code) {
    background: transparent;
    padding: 0;
    border: 0;
    font-weight: 400;
  }

  /* Tables — give the header a subtle surface so borders read in both themes. */
  :global(.doc-prose th) {
    background: color-mix(in oklab, var(--muted), transparent 60%);
  }

  /* Task list checkboxes inherit the design system */
  :global(.doc-prose input[type='checkbox']) {
    accent-color: var(--primary);
    margin-right: 0.4em;
  }

  /* Footnotes look better with a top divider */
  :global(.doc-prose .footnotes) {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid color-mix(in oklab, var(--border), transparent 60%);
    font-size: 0.85em;
  }
</style>
