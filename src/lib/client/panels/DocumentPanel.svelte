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

  // Post-render shiki pass.
  //
  // SvelteMarkdown emits plain `<pre><code class="language-xxx">…</code></pre>`
  // tokens. We walk them, swap each <pre> for shiki's highlighted output, and
  // re-apply our design-system surface via the `.doc-prose pre` CSS overrides
  // (radius, padding, --code-bg) — shiki's inline `style="background:…"` is
  // beaten by `!important` in our stylesheet.
  //
  // Important behaviors:
  //  • `data-shiki-done` is set AFTER a successful swap, not before — earlier
  //    versions marked the pre done before awaiting the language load, which
  //    blocked the retry when the user typed during the load.
  //  • `data-shiki-key` stamps the (lang, char-length, theme) signature so an
  //    edit to the same fenced block re-highlights even if shiki already ran
  //    on a prior version of the element. Without this, fast typing inside
  //    a code fence would keep the stale highlight.
  //  • The pre is rendered with `data-pending` while we wait for shiki so the
  //    stylesheet can hide the unstyled text and avoid the plain→highlighted
  //    flash. Once shiki succeeds we replace the element and the new pre has
  //    no `data-pending` attribute.
  async function highlightCodeBlocks(root: HTMLElement, theme: 'github-dark' | 'github-light') {
    const candidates = root.querySelectorAll<HTMLElement>('pre > code');
    if (candidates.length === 0) return;
    const hl = await getSharedHighlighter().catch(() => null);
    if (!hl) return;

    // Parallelize per-block work: each block's `ensureShikiLanguage` is an
    // independent async load, so awaiting them sequentially in a `for` loop
    // serializes file-switch latency. Promise.all lets a markdown file with
    // N fenced blocks highlight in O(slowest-lang) instead of O(sum).
    await Promise.all(
      [...candidates].map(async (codeEl) => {
        const pre = codeEl.parentElement as HTMLPreElement | null;
        if (!pre) return;
        const langClass = [...codeEl.classList].find((c) => c.startsWith('language-'));
        const lang = langClass ? langClass.slice('language-'.length).trim() : '';
        const code = codeEl.textContent ?? '';
        if (!code) return;
        if (!lang) {
          pre.removeAttribute('data-pending');
          return;
        }
        const key = `${lang}:${theme}:${code.length}:${code.slice(-32)}`;
        if (pre.dataset.shikiKey === key) return;
        pre.setAttribute('data-pending', '1');
        const ok = await ensureShikiLanguage(lang);
        if (!ok) {
          pre.removeAttribute('data-pending');
          return;
        }
        try {
          const html = hl.codeToHtml(code, { lang, theme });
          const wrap = document.createElement('div');
          wrap.innerHTML = html;
          const newPre = wrap.firstElementChild as HTMLElement | null;
          if (!newPre) {
            pre.removeAttribute('data-pending');
            return;
          }
          newPre.dataset.shikiKey = key;
          if (pre.isConnected) pre.replaceWith(newPre);
        } catch {
          pre.removeAttribute('data-pending');
        }
      })
    );
  }

  // Re-run highlighting when content changes or theme flips.
  $effect(() => {
    void markdownContent;
    void $mode;
    if (!articleEl) return;
    const theme = $mode === 'dark' ? 'github-dark' : 'github-light';
    // Synchronously mark every language-tagged pre as pending so the
    // stylesheet hides its unstyled text until shiki swaps the markup.
    // Pre's without a language tag stay visible (plain mono surface).
    const pres = articleEl.querySelectorAll<HTMLElement>('pre:not(.shiki) > code');
    for (const codeEl of pres) {
      const pre = codeEl.parentElement as HTMLPreElement | null;
      if (!pre) continue;
      const hasLang = [...codeEl.classList].some((c) => c.startsWith('language-'));
      if (hasLang) pre.setAttribute('data-pending', '1');
    }
    // Defer one frame so SvelteMarkdown has finished mounting tokens, then
    // do the async highlighter pass.
    queueMicrotask(() => {
      if (articleEl) void highlightCodeBlocks(articleEl, theme);
    });
  });
</script>

<div class="flex h-full flex-col bg-background">
  <!-- Header: matches the Code panel chrome (h-9, full-opacity border) so the
       Document/Code/Canvas headers all read as one consistent row. -->
  <div
    class="box-content flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
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
        <article bind:this={articleEl} class="doc-prose prose dark:prose-invert mx-auto max-w-3xl">
          <SvelteMarkdown
            source={markdownContent}
            extensions={[markedFootnote()]}
            options={{ headerIds: true, gfm: true, breaks: false }} />
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
  /* Document markdown — every block is pinned to the design system:
   *   • Body locked at 13px (--fs-body, lh 1.5)
   *   • Heading ladder: 22 / 20 / 18 / 13 (card-title → subhead → body-lg → body)
   *   • Spacing on 4px grid via --ds-space-*
   *   • Radii from --ds-radius-*
   *   • Code surface = --code-bg, mono locked at 12px
   *   • Hairlines = --border (#262626 dark / matched light)
   *
   * We bind Tailwind Typography's CSS vars to the design tokens, then
   * override the per-element rules where prose's defaults disagree with
   * the system (heading sizes, code blocks, lists, blockquote, hr, tables). */
  :global(.doc-prose) {
    /* Color tokens — wire prose's palette to the design system. */
    --tw-prose-body: var(--foreground);
    --tw-prose-headings: var(--foreground);
    --tw-prose-lead: color-mix(in oklab, var(--foreground), transparent 25%);
    --tw-prose-links: var(--primary);
    --tw-prose-bold: var(--foreground);
    --tw-prose-counters: var(--muted-foreground);
    --tw-prose-bullets: var(--border);
    --tw-prose-hr: var(--border);
    --tw-prose-quotes: color-mix(in oklab, var(--foreground), transparent 25%);
    --tw-prose-quote-borders: var(--primary);
    --tw-prose-captions: var(--muted-foreground);
    --tw-prose-code: var(--foreground);
    --tw-prose-pre-code: var(--foreground);
    --tw-prose-pre-bg: var(--code-bg);
    --tw-prose-th-borders: var(--border);
    --tw-prose-td-borders: var(--border);
    --tw-prose-invert-body: var(--foreground);
    --tw-prose-invert-headings: var(--foreground);
    --tw-prose-invert-lead: color-mix(in oklab, var(--foreground), transparent 25%);
    --tw-prose-invert-links: var(--primary);
    --tw-prose-invert-bold: var(--foreground);
    --tw-prose-invert-counters: var(--muted-foreground);
    --tw-prose-invert-bullets: var(--border);
    --tw-prose-invert-hr: var(--border);
    --tw-prose-invert-quotes: color-mix(in oklab, var(--foreground), transparent 25%);
    --tw-prose-invert-quote-borders: var(--primary);
    --tw-prose-invert-captions: var(--muted-foreground);
    --tw-prose-invert-code: var(--foreground);
    --tw-prose-invert-pre-code: var(--foreground);
    --tw-prose-invert-pre-bg: var(--code-bg);
    --tw-prose-invert-th-borders: var(--border);
    --tw-prose-invert-td-borders: var(--border);

    /* Body: hard-locked 13px / lh 1.5 / Inter. Letter-spacing 0. */
    font-family: var(--ds-font-text);
    font-size: var(--fs-body);
    line-height: var(--lh-body);
    letter-spacing: var(--tr-body);
  }

  /* Paragraph rhythm — 12px between consecutive paragraphs (on grid). */
  :global(.doc-prose p) {
    margin-top: 0;
    margin-bottom: var(--ds-space-sm);
  }
  :global(.doc-prose > :first-child) {
    margin-top: 0;
  }
  :global(.doc-prose > :last-child) {
    margin-bottom: 0;
  }

  /* Heading ladder per DESIGN.md type tokens. */
  :global(.doc-prose h1) {
    font-size: var(--fs-card-title);
    line-height: var(--lh-card-title);
    letter-spacing: var(--tr-card-title);
    font-weight: 500;
    margin-top: var(--ds-space-lg);
    margin-bottom: var(--ds-space-sm);
  }
  :global(.doc-prose h2) {
    font-size: var(--fs-subhead);
    line-height: var(--lh-subhead);
    letter-spacing: var(--tr-subhead);
    font-weight: 500;
    margin-top: var(--ds-space-lg);
    margin-bottom: var(--ds-space-sm);
  }
  :global(.doc-prose h3) {
    font-size: var(--fs-body-lg);
    line-height: var(--lh-body-lg);
    letter-spacing: var(--tr-body-lg);
    font-weight: 500;
    margin-top: var(--ds-space-md);
    margin-bottom: var(--ds-space-xs);
  }
  :global(.doc-prose h4),
  :global(.doc-prose h5),
  :global(.doc-prose h6) {
    font-size: var(--fs-body);
    line-height: var(--lh-button);
    font-weight: 500;
    margin-top: var(--ds-space-md);
    margin-bottom: var(--ds-space-xs);
  }

  /* Lists — pin to the 4px grid. Prose's default is fractional rem. */
  :global(.doc-prose ul),
  :global(.doc-prose ol) {
    margin-top: 0;
    margin-bottom: var(--ds-space-sm);
    padding-left: var(--ds-space-lg);
  }
  :global(.doc-prose li) {
    margin-top: var(--ds-space-xxs);
    margin-bottom: var(--ds-space-xxs);
  }
  :global(.doc-prose li > p) {
    margin: 0;
  }

  /* Inline code: tool-box-style pill, mono 12px, on-grid padding. */
  :global(.doc-prose :not(pre) > code) {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: var(--ds-radius-sm);
    padding: 0 var(--ds-space-xxs);
    font-family: var(--ds-font-mono);
    font-size: var(--fs-mono);
    font-weight: 400;
    color: var(--foreground);
  }
  :global(.doc-prose :not(pre) > code::before),
  :global(.doc-prose :not(pre) > code::after) {
    content: '';
  }

  /* Code-block surface per DESIGN.md `code-block` token:
   *   bg = --code-bg, radius = --ds-radius-lg (12px), padding 12/16. */
  :global(.doc-prose pre) {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: var(--ds-radius-lg);
    padding: var(--ds-space-sm) var(--ds-space-md);
    margin: var(--ds-space-md) 0;
    overflow-x: auto;
    font-family: var(--ds-font-mono);
    font-size: var(--fs-mono);
    line-height: var(--lh-mono);
  }
  :global(.doc-prose pre code) {
    background: transparent;
    border: 0;
    padding: 0;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    font-weight: 400;
    color: var(--foreground);
  }
  /* Shiki output — same surface tokens as the plain pre above. Shiki
     injects an inline `style="background:..."` from its theme; the
     `!important` here beats that so all code blocks read on --code-bg. */
  :global(.doc-prose pre.shiki) {
    background: var(--code-bg) !important;
    border: 1px solid var(--border) !important;
    border-radius: var(--ds-radius-lg);
    padding: var(--ds-space-sm) var(--ds-space-md);
    margin: var(--ds-space-md) 0;
    overflow-x: auto;
    font-family: var(--ds-font-mono);
    font-size: var(--fs-mono);
    line-height: var(--lh-mono);
  }
  :global(.doc-prose pre.shiki code) {
    background: transparent !important;
    padding: 0;
    border: 0;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    font-weight: 400;
  }
  /* Per-line spans shiki emits — strip any inline bg shiki added so the
     surface stays flat on --code-bg (some themes add subtle alt-line bg). */
  :global(.doc-prose pre.shiki .line) {
    background: transparent !important;
  }
  /* Hide the unstyled token-text while we wait for shiki to swap in the
     highlighted markup. Avoids the plain→highlighted flash on the first
     paint after a content change. Only applies to language-tagged pre's
     (no-language fences clear data-pending immediately). */
  :global(.doc-prose pre[data-pending]) {
    color: transparent;
  }
  :global(.doc-prose pre[data-pending] code) {
    color: transparent;
  }

  /* Blockquote: cyan accent edge (--primary), no fill. */
  :global(.doc-prose blockquote) {
    margin: var(--ds-space-md) 0;
    padding: 0 var(--ds-space-md);
    border-left: 2px solid var(--primary);
    font-style: normal;
    color: color-mix(in oklab, var(--foreground), transparent 25%);
  }
  :global(.doc-prose blockquote p::before),
  :global(.doc-prose blockquote p::after) {
    content: '';
  }

  /* Horizontal rule — single 1px hairline at --border. */
  :global(.doc-prose hr) {
    border: 0;
    border-top: 1px solid var(--border);
    margin: var(--ds-space-lg) 0;
  }

  /* Tables — hairline borders only, header gets a 1-step surface lift. */
  :global(.doc-prose table) {
    width: 100%;
    margin: var(--ds-space-md) 0;
    font-size: var(--fs-body);
    border-collapse: collapse;
  }
  :global(.doc-prose th),
  :global(.doc-prose td) {
    border: 1px solid var(--border);
    padding: var(--ds-space-xs) var(--ds-space-sm);
    text-align: left;
  }
  :global(.doc-prose th) {
    background: var(--tool-box-bg, color-mix(in oklab, var(--muted), transparent 60%));
    font-weight: 500;
  }

  /* Links — cyan, underline only on hover (chrome stays quiet). */
  :global(.doc-prose a) {
    color: var(--primary);
    text-decoration: none;
  }
  :global(.doc-prose a:hover) {
    text-decoration: underline;
  }

  /* Task list checkboxes inherit the design system. */
  :global(.doc-prose input[type='checkbox']) {
    accent-color: var(--primary);
    margin-right: var(--ds-space-xxs);
  }

  /* Images take the same hairline-border treatment as cards. */
  :global(.doc-prose img) {
    border-radius: var(--ds-radius-md);
    border: 1px solid var(--border);
    margin: var(--ds-space-md) 0;
  }

  /* Footnotes: divider on top, body size unchanged (no fractional shrink). */
  :global(.doc-prose .footnotes) {
    margin-top: var(--ds-space-xl);
    padding-top: var(--ds-space-md);
    border-top: 1px solid var(--border);
    font-size: var(--fs-body);
  }
</style>
