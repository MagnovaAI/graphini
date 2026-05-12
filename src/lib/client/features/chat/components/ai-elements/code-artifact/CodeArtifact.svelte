<script module lang="ts">
  // Module-scoped latch: once shiki tokenization fails anywhere, log a
  // single warning and let all subsequent artifacts render plain. Without
  // this, every artifact + every prop change re-tries and the console fills
  // with hundreds of identical errors.
  let shikiWarnedThisRender = false;
</script>

<script lang="ts">
  import { ChevronRight, Eye, FilePen, FilePlus, Trash2 } from 'lucide-svelte';
  import { tick } from 'svelte';
  import { mode } from 'mode-watcher';
  import type { ThemedToken } from 'shiki';
  import { ensureShikiLanguage, getSharedHighlighter } from '$lib/client/util/editor/shikiSetup';

  interface Props {
    code: string;
    previousCode?: string;
    language?: string;
    title?: string;
    /** Full workspace path. Header shows the basename + a tooltip with this
        full string; clicking the filename opens the file. */
    path?: string;
    /** Called when the user clicks the header filename. If unset, the
        filename is rendered as plain text. */
    onOpenFile?: (path: string) => void;
    isStreaming?: boolean;
    operation?: 'create' | 'edit' | 'delete' | 'read';
    defaultCollapsed?: boolean;
    hasErrors?: boolean;
    errors?: string[];
    readFrom?: number;
    readTo?: number;
    totalLines?: number;
  }

  let {
    code,
    previousCode = '',
    language = 'mermaid',
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    title = 'Diagram Code',
    path,
    onOpenFile,
    isStreaming = false,
    operation = 'create',
    defaultCollapsed,
    hasErrors = false,
    errors = [],
    readFrom,
    readTo,
    totalLines
  }: Props = $props();

  const filename = $derived(path ? path.split('/').pop() || path : '');

  let isCollapsed = $state(false);
  let codeContainer: HTMLDivElement | undefined = $state();
  let wasStreaming = $state(false);
  let collapseInitialized = false;

  // Initialize once from props, then preserve user toggles except for streaming completion.
  // Create/Edit stay expanded so the code is visible; Read auto-collapses.
  $effect(() => {
    const keepExpanded = operation === 'edit' || operation === 'create';
    if (!collapseInitialized) {
      isCollapsed = defaultCollapsed ?? (keepExpanded ? false : operation === 'read');
      collapseInitialized = true;
    } else if (wasStreaming && !isStreaming) {
      isCollapsed = !keepExpanded;
    }
    wasStreaming = isStreaming;
  });

  let lines = $derived(code.split('\n'));
  let lineCount = $derived(lines.length);
  let isRead = $derived(operation === 'read');
  let isError = $derived(isRead && hasErrors);

  // Diff: compute added/removed lines vs previousCode. For `create` (and
  // edits where prior content wasn't captured), there's no baseline — every
  // current line counts as added so the diff view still renders meaningfully.
  let prevLines = $derived(previousCode ? previousCode.split('\n') : []);
  let prevTrimmed = $derived(prevLines.map((l) => l.trim()));
  let curTrimmed = $derived(lines.map((l) => l.trim()));
  let hasPrev = $derived(previousCode.length > 0);
  let addedCount = $derived(
    hasPrev ? lines.filter((l) => !prevTrimmed.includes(l.trim())).length : lineCount
  );
  let removedCount = $derived(
    hasPrev ? prevLines.filter((l) => !curTrimmed.includes(l.trim())).length : 0
  );
  // Always render the unified-diff view for any non-empty write — when
  // previousCode is missing we degrade gracefully to "all added", which is
  // still more useful than the plain full-code view.
  let hasDiff = $derived((operation === 'edit' || operation === 'create') && lineCount > 0);

  // Unified diff lines: only show changed regions with 1 line of context
  interface DiffLine {
    text: string;
    type: 'added' | 'removed' | 'context' | 'separator';
    lineNum?: number;
  }
  let diffLines = $derived.by((): DiffLine[] => {
    if (!hasDiff || isStreaming) return [];

    // Simple LCS-based unified diff
    const a = prevLines;
    const b = lines;
    const n = a.length,
      m = b.length;

    // Build LCS table
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        dp[i][j] =
          a[i - 1].trim() === b[j - 1].trim()
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    // Backtrack to get diff ops
    const ops: { type: 'context' | 'removed' | 'added'; text: string; lineNum?: number }[] = [];
    let i = n,
      j = m;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && a[i - 1].trim() === b[j - 1].trim()) {
        ops.push({ type: 'context', text: b[j - 1], lineNum: j });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        ops.push({ type: 'added', text: b[j - 1], lineNum: j });
        j--;
      } else {
        ops.push({ type: 'removed', text: a[i - 1], lineNum: i });
        i--;
      }
    }
    ops.reverse();

    // Filter to show only changed regions with 1 line of context
    const CONTEXT = 1;
    const changedIndices: number[] = [];
    ops.forEach((op, idx) => {
      if (op.type !== 'context') changedIndices.push(idx);
    });
    const visibleIndices: number[] = [];
    for (const idx of changedIndices) {
      for (let c = Math.max(0, idx - CONTEXT); c <= Math.min(ops.length - 1, idx + CONTEXT); c++) {
        if (!visibleIndices.includes(c)) visibleIndices.push(c);
      }
    }

    const result: DiffLine[] = [];
    let lastVisible = -2;
    for (let idx = 0; idx < ops.length; idx++) {
      if (!visibleIndices.includes(idx)) continue;
      if (idx > lastVisible + 1 && lastVisible >= 0) {
        result.push({ text: '', type: 'separator' });
      }
      result.push({ text: ops[idx].text, type: ops[idx].type, lineNum: ops[idx].lineNum });
      lastVisible = idx;
    }
    return result;
  });
  // Show the git-style diff view for any non-streaming write. Edits with
  // prior content get a real diff; edits/creates without prior content fall
  // back to "all added" via hasDiff/addedCount above, so the green-rail
  // treatment still applies.
  let showDiffView = $derived(
    !isStreaming && (operation === 'edit' || operation === 'create') && lineCount > 0
  );

  // Auto-scroll to bottom during streaming
  $effect(() => {
    if (isStreaming && codeContainer) {
      tick().then(() => {
        if (codeContainer) {
          codeContainer.scrollTop = codeContainer.scrollHeight;
        }
      });
    }
  });

  // 1code-style verbs
  const verbsByOp: Record<string, { pending: string; done: string }> = {
    create: { pending: 'Creating', done: 'Created' },
    delete: { pending: 'Clearing', done: 'Cleared' },
    edit: { pending: 'Editing', done: 'Edited' },
    read: { pending: 'Reading', done: 'Read' }
  };
  let titlePending = $derived(verbsByOp[operation]?.pending || 'Running');
  let titleDone = $derived(verbsByOp[operation]?.done || 'Done');
  let artifactSubtitle = $derived.by(() => {
    if (isError) return `${errors.length} error${errors.length !== 1 ? 's' : ''}`;
    if (isRead && readFrom && readTo) {
      return totalLines
        ? `lines ${readFrom}-${readTo} of ${totalLines}`
        : `lines ${readFrom}-${readTo}`;
    }
    // Edit & create both render their own colored +/− stats in the header,
    // so the plain "N lines" subtitle would duplicate the info.
    if ((operation === 'edit' || operation === 'create') && lineCount > 0) {
      return '';
    }
    return `${lineCount} line${lineCount !== 1 ? 's' : ''}`;
  });

  // Resolve dark/light via DOM class to avoid mode-watcher race conditions.
  let isDark = $state(
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : false
  );
  $effect(() => {
    void mode.current;
    if (typeof document !== 'undefined') {
      isDark = document.documentElement.classList.contains('dark');
    }
  });
  $effect(() => {
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() => {
      isDark = document.documentElement.classList.contains('dark');
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  });
  let activeThemeName = $derived(isDark ? 'dark-plus' : 'light-plus');

  // Tokenize current+previous code with shiki so spans can pull per-line tokens.
  let codeTokenLines = $state<ThemedToken[][] | null>(null);
  let prevCodeTokenLines = $state<ThemedToken[][] | null>(null);

  $effect(() => {
    const lang = (language || 'mermaid').toLowerCase();
    const themeName = activeThemeName;
    const text = code;
    const prev = previousCode;
    let cancelled = false;
    void (async () => {
      try {
        const hl = await getSharedHighlighter();
        if (!hl.getLoadedLanguages().includes(lang)) {
          const loaded = await ensureShikiLanguage(lang);
          if (!loaded) {
            // unknown lang — fall back to plain rendering
            if (!cancelled) {
              codeTokenLines = null;
              prevCodeTokenLines = null;
            }
            return;
          }
        }
        const main = hl.codeToTokens(text, {
          lang: lang as never,
          theme: themeName as never
        });
        const previous = prev
          ? hl.codeToTokens(prev, { lang: lang as never, theme: themeName as never })
          : null;
        if (!cancelled) {
          codeTokenLines = main.tokens;
          prevCodeTokenLines = previous?.tokens ?? null;
        }
      } catch (err) {
        // Log once per render path. The shared highlighter's latch in
        // shikiSetup prevents the underlying init from re-running, but a
        // failed init still rejects here and would spam without this guard.
        if (!shikiWarnedThisRender) {
          shikiWarnedThisRender = true;
          console.warn(
            '[CodeArtifact] shiki tokenize failed (rendering as plain text):',
            err instanceof Error ? err.message : String(err)
          );
        }
        if (!cancelled) {
          codeTokenLines = null;
          prevCodeTokenLines = null;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  function tokensForLine(
    text: string,
    lineNum: number | undefined,
    side: 'main' | 'prev'
  ): ThemedToken[] | null {
    const src = side === 'main' ? codeTokenLines : prevCodeTokenLines;
    if (!src || !lineNum) return null;
    return src[lineNum - 1] ?? null;
  }
</script>

<div class="artifact-container group overflow-hidden">
  <!-- Compact header (1code style) -->
  <div
    role="button"
    tabindex="0"
    aria-expanded={!isCollapsed}
    onclick={() => (isCollapsed = !isCollapsed)}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        isCollapsed = !isCollapsed;
      }
    }}
    class="group/hdr flex cursor-pointer items-center gap-2 px-2 py-1">
    <!-- Icon (no chip) -->
    {#if isError || isRead}
      <Eye
        class="size-4 flex-shrink-0 {isStreaming
          ? 'tool-active-icon-shimmer'
          : 'text-muted-foreground/70'}" />
    {:else if operation === 'edit'}
      <FilePen
        class="size-4 flex-shrink-0 {isStreaming
          ? 'tool-active-icon-shimmer'
          : 'text-muted-foreground/70'}" />
    {:else if operation === 'delete'}
      <Trash2
        class="size-4 flex-shrink-0 {isStreaming
          ? 'tool-active-icon-shimmer'
          : 'text-muted-foreground/70'}" />
    {:else}
      <FilePlus
        class="size-4 flex-shrink-0 {isStreaming
          ? 'tool-active-icon-shimmer'
          : 'text-muted-foreground/70'}" />
    {/if}

    <div class="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground">
      <!-- Verb -->
      <span class="flex-shrink-0 font-medium whitespace-nowrap">
        {#if isStreaming}
          <span class="thinking-shimmer inline-flex h-4 items-center text-[13px] leading-none"
            >{titlePending}</span>
        {:else}
          {titleDone}
        {/if}
      </span>

      <!-- Filename: clickable when onOpenFile is provided, tooltip shows the
           full path. Stops propagation so clicking the filename opens the
           file without also toggling the header expand. -->
      {#if filename}
        {#if onOpenFile && path}
          <button
            type="button"
            title={path}
            class="min-w-0 cursor-pointer truncate rounded font-mono text-[12px] text-foreground/80 hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:outline-none"
            onclick={(e) => {
              e.stopPropagation();
              onOpenFile(path);
            }}>
            {filename}
          </button>
        {:else}
          <span class="min-w-0 truncate font-mono text-[12px] text-foreground/80" title={path}>
            {filename}
          </span>
        {/if}
      {/if}

      <!-- Diff stats for edits -->
      {#if !isStreaming && (operation === 'edit' || operation === 'create') && (addedCount > 0 || removedCount > 0)}
        <span class="flex-shrink-0 font-mono text-[12px]">
          {#if addedCount > 0}<span class="text-emerald-600 dark:text-emerald-400"
              >+{addedCount}</span
            >{/if}
          {#if addedCount > 0 && removedCount > 0}&nbsp;{/if}
          {#if removedCount > 0}<span class="text-red-600 dark:text-red-400">-{removedCount}</span
            >{/if}
        </span>
      {:else if artifactSubtitle}
        <span class="min-w-0 truncate font-normal text-muted-foreground/60">
          {artifactSubtitle}
        </span>
      {/if}

      <ChevronRight
        class="size-3.5 flex-shrink-0 text-muted-foreground/60 transition-transform duration-200 ease-out {!isCollapsed
          ? 'rotate-90'
          : 'opacity-0 group-hover/hdr:opacity-100'}" />
    </div>
  </div>

  <!--
    Error banner. Mermaid parse errors are multi-line with caret indicators
    pointing at the offending column — rendering them in a <p> collapses the
    whitespace and the carets stop lining up. <pre> preserves the structure
    so the user sees the same diagnostic the parser printed.
  -->
  {#if isError && !isCollapsed && errors.length > 0}
    <div class="mt-2 space-y-1.5 px-2">
      {#each errors as err, i (i)}
        <div
          class="flex gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-700 dark:bg-red-500/15 dark:text-red-300">
          <span
            class="mt-[2px] inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-[11px] leading-none font-bold">
            !
          </span>
          <pre
            class="m-0 flex-1 overflow-x-auto font-mono text-[12px] leading-[1.55] break-words whitespace-pre-wrap">{err.trim()}</pre>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Code body -->
  {#if !isCollapsed}
    <div
      bind:this={codeContainer}
      class="artifact-code-body relative mt-1 overflow-auto rounded-md border border-border/40 transition-[max-height] duration-150"
      style="max-height: {isStreaming ? '300px' : '250px'}; background-color: var(--code-bg);">
      {#if showDiffView}
        <!-- Diff-only view: show only changed regions -->
        <table class="w-full border-collapse font-mono text-[12px] leading-[1.65]">
          <tbody>
            {#each diffLines as dl, i (`${dl.type}:${dl.lineNum ?? 'gap'}:${dl.text}:${i}`)}
              {@const lineTokens = tokensForLine(
                dl.text,
                dl.lineNum,
                dl.type === 'removed' ? 'prev' : 'main'
              )}
              {#if dl.type === 'separator'}
                <tr>
                  <td
                    colspan="3"
                    class="border-y border-border/20 bg-muted/20 px-3 py-1 text-center text-[13px] text-muted-foreground/40"
                    >···</td>
                </tr>
              {:else}
                <!-- Diff row — git-style left rail + soft bg tint. The
                     rail (2px solid colored border) carries the visual
                     weight of "this changed"; the bg tint is light enough
                     to keep code legible. Context rows get a transparent
                     rail so indentation columns stay aligned. -->
                <tr
                  class="artifact-line transition-colors duration-75
                    {dl.type === 'added' ? 'bg-emerald-500/[0.08] dark:bg-emerald-500/[0.14]' : ''}
                    {dl.type === 'removed' ? 'bg-red-500/[0.08] dark:bg-red-500/[0.14]' : ''}
                    {dl.type === 'context' ? 'hover:bg-muted/30' : ''}">
                  <td
                    class="px-1 text-center align-top font-mono text-[12px] leading-[1.65] font-semibold select-none
                      {dl.type === 'added'
                      ? 'border-l-2 border-emerald-500/60 text-emerald-700 dark:text-emerald-400'
                      : ''}
                      {dl.type === 'removed'
                      ? 'border-l-2 border-red-500/60 text-red-700 dark:text-red-400'
                      : ''}
                      {dl.type === 'context' ? 'border-l-2 border-transparent' : ''}"
                    style="width: 1.25rem; min-width: 1.25rem;">
                    {#if dl.type === 'added'}+{/if}
                    {#if dl.type === 'removed'}−{/if}
                  </td>
                  <td
                    class="artifact-ln border-r border-border/30 px-3 text-right align-top text-muted-foreground/40 select-none"
                    style="width: 2.75rem; min-width: 2.75rem;">
                    {dl.lineNum || ''}
                  </td>
                  <!-- Text color falls back to the type color only when
                       shiki tokens aren't available (e.g. during streaming).
                       Tokenized lines render with shiki's per-token colors. -->
                  <td
                    class="px-4 align-top whitespace-pre
                    {!lineTokens && dl.type === 'added'
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : ''}
                    {!lineTokens && dl.type === 'removed' ? 'text-red-700 dark:text-red-300' : ''}
                    {dl.type === 'context' || lineTokens ? 'text-foreground/90' : ''}">
                    {#if lineTokens}
                      {#each lineTokens as t, ti (ti)}<span style:color={t.color}>{t.content}</span
                        >{/each}
                    {:else}
                      {dl.text}
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {:else}
        <!-- Full code view -->
        <table class="w-full border-collapse font-mono text-[12px] leading-[1.65]">
          <tbody>
            {#each lines as line, i (`${i}:${line}`)}
              {@const lineTokens = codeTokenLines ? codeTokenLines[i] : null}
              <tr
                class={[
                  'artifact-line group transition-colors duration-75 hover:bg-muted/30',
                  isStreaming && i >= lineCount - 3 && 'artifact-line-new'
                ]}>
                <td
                  class="artifact-ln border-r border-border/30 px-3 text-right align-top text-muted-foreground/40 select-none"
                  style="width: {lineCount > 99 ? '3.5rem' : '2.75rem'}; min-width: {lineCount > 99
                    ? '3.5rem'
                    : '2.75rem'};">
                  {i + 1}
                </td>
                <td class="artifact-code px-4 align-top whitespace-pre text-foreground/90">
                  {#if lineTokens}
                    {#each lineTokens as t, ti (ti)}<span style:color={t.color}>{t.content}</span
                      >{/each}
                  {:else}
                    {line}
                  {/if}
                  {#if isStreaming && i === lineCount - 1}<span class="artifact-cursor"></span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* 1code-style shimmering verb */
  .thinking-shimmer {
    --base-color: #a1a1aa;
    --base-gradient-color: #000;
    --spread: 16px;
    --bg: linear-gradient(
      90deg,
      transparent calc(50% - var(--spread)),
      var(--base-gradient-color),
      transparent calc(50% + var(--spread))
    );
    position: relative;
    display: inline-block;
    background-image: var(--bg), linear-gradient(var(--base-color), var(--base-color));
    background-size:
      250% 100%,
      auto;
    background-repeat: no-repeat, padding-box;
    background-position: 100% center;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    animation: artifact-shimmer-slide 1.2s linear infinite;
  }
  :global(.dark) .thinking-shimmer {
    --base-color: #71717a;
    --base-gradient-color: #ffffff;
  }
  @keyframes artifact-shimmer-slide {
    0% {
      background-position: 100% center;
    }
    100% {
      background-position: 0% center;
    }
  }

  /* Cursor blink animation */
  .artifact-cursor {
    display: inline-block;
    width: 2px;
    height: 1.1em;
    background: var(--ring);
    margin-left: 1px;
    vertical-align: text-bottom;
    animation: artifact-blink 0.8s step-end infinite;
  }

  @keyframes artifact-blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }

  @keyframes artifact-bounce {
    0%,
    80%,
    100% {
      transform: translateY(0);
    }
    40% {
      transform: translateY(-3px);
    }
  }

  /* New line highlight during streaming */
  .artifact-line-new {
    background: var(--accent);
  }

  /* Diff highlights are now handled inline via Tailwind classes */

  /* Syntax highlighting - light mode first, dark overrides */
  :global(.artifact-kw) {
    color: hsl(262 70% 50%);
    font-weight: 600;
  }
  :global(.dark .artifact-kw) {
    color: hsl(263 70% 75%);
  }

  :global(.artifact-dir) {
    color: hsl(217 80% 50%);
    font-weight: 500;
  }
  :global(.dark .artifact-dir) {
    color: hsl(217 91% 75%);
  }

  :global(.artifact-arrow) {
    color: hsl(25 90% 42%);
    font-weight: 600;
  }
  :global(.dark .artifact-arrow) {
    color: hsl(43 96% 65%);
  }

  :global(.artifact-bracket) {
    color: hsl(215 20% 42%);
  }
  :global(.dark .artifact-bracket) {
    color: hsl(215 20% 65%);
  }

  :global(.artifact-comment) {
    color: hsl(215 16% 50%);
    font-style: italic;
    opacity: 0.7;
  }
  :global(.dark .artifact-comment) {
    color: hsl(215 16% 55%);
  }

  :global(.artifact-builtin) {
    color: hsl(172 60% 32%);
    font-weight: 500;
  }
  :global(.dark .artifact-builtin) {
    color: hsl(172 66% 60%);
  }

  /* Scrollbar styling */
  .artifact-code-body {
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--muted-foreground) / 0.15) transparent;
  }
  .artifact-code-body::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  .artifact-code-body::-webkit-scrollbar-thumb {
    background: hsl(var(--muted-foreground) / 0.15);
    border-radius: 3px;
  }
  .artifact-code-body::-webkit-scrollbar-track {
    background: transparent;
  }
</style>
