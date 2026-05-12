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

  // Map file extension to the same brand-style icon assets the sidebar
  // FileTree uses, so an artifact filename in the chat reads the same as
  // its row in the sidebar tree.
  function fileIconSrc(name: string): string {
    const ext = name.toLowerCase().split('.').pop() ?? '';
    if (ext === 'json') return '/icons/file-json.svg';
    if (ext === 'yaml' || ext === 'yml') return '/icons/file-yaml.svg';
    if (ext === 'mermaid' || ext === 'mmd') return '/icons/file-mermaid.svg';
    return '/icons/file-md.svg';
  }

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

  // Throttle the displayed code during streaming to ~10 fps. Tokens arrive
  // 30-60/sec from the model; re-deriving `lines`, the LCS, and the row
  // template per token is wasted work and the visible cause of streaming
  // flicker after the key-stability fix. `displayCode` lags the live `code`
  // prop by at most 100ms during streaming, then snaps to the final value
  // the moment streaming ends so the user never sees stale content.
  let displayCode = $state(code);
  let lastDisplayUpdate = 0;
  let displayTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const live = code;
    const streaming = isStreaming;
    if (!streaming) {
      // Final flush — clear any pending throttle and settle immediately so
      // the post-stream highlight + diff run against the complete file.
      if (displayTimer) {
        clearTimeout(displayTimer);
        displayTimer = null;
      }
      displayCode = live;
      return;
    }
    const now = Date.now();
    const since = now - lastDisplayUpdate;
    if (since >= 100) {
      lastDisplayUpdate = now;
      displayCode = live;
    } else if (!displayTimer) {
      displayTimer = setTimeout(() => {
        lastDisplayUpdate = Date.now();
        displayTimer = null;
        displayCode = code;
      }, 100 - since);
    }
    return () => {
      if (displayTimer) {
        clearTimeout(displayTimer);
        displayTimer = null;
      }
    };
  });

  let lines = $derived(displayCode.split('\n'));
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
    // During streaming with no prior content (create, or edit where we
    // couldn't capture previousCode) every line is "added" — short-circuit
    // since the LCS would return the same thing.
    if (isStreaming && !hasPrev) {
      return lines.map((l, idx) => ({ text: l, type: 'added' as const, lineNum: idx + 1 }));
    }
    if (!hasDiff) return [];

    // Simple LCS-based unified diff. During streaming with a very large
    // prior file we degrade to "all added" so the LCS doesn't stall the
    // main thread on every token batch — the real diff appears once the
    // stream completes.
    const a = prevLines;
    const b = lines;
    const n = a.length,
      m = b.length;
    if (isStreaming && n * m > 200_000) {
      return b.map((l, idx) => ({ text: l, type: 'added' as const, lineNum: idx + 1 }));
    }

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
  // Show the git-style diff view for any write — including while streaming.
  // Streaming pre-fills diffLines with "all added" so the body renders the
  // same green-rail + green-bg treatment from the first token, matching
  // 1code's behavior where streaming text never has a separate look.
  let showDiffView = $derived((operation === 'edit' || operation === 'create') && lineCount > 0);

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
    // Use the throttled displayCode for tokenization so we don't re-tokenize
    // on every streamed token; even with throttling we skip shiki entirely
    // while isStreaming and only re-highlight once when the stream ends.
    const text = displayCode;
    const prev = previousCode;
    const streaming = isStreaming;
    let cancelled = false;
    // Streaming: render plain text. Shiki re-tokenizes the entire file every
    // call, which dominates CPU during a stream and visibly stutters lines
    // as new tokens land. The diff rail/bg tint already conveys "live".
    if (streaming) {
      codeTokenLines = null;
      prevCodeTokenLines = null;
      return;
    }
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
        class="size-3.5 flex-shrink-0 {isStreaming
          ? 'tool-active-icon-shimmer'
          : 'text-muted-foreground/70'}" />
    {:else if operation === 'edit'}
      <FilePen
        class="size-3.5 flex-shrink-0 {isStreaming
          ? 'tool-active-icon-shimmer'
          : 'text-muted-foreground/70'}" />
    {:else if operation === 'delete'}
      <Trash2
        class="size-3.5 flex-shrink-0 {isStreaming
          ? 'tool-active-icon-shimmer'
          : 'text-muted-foreground/70'}" />
    {:else}
      <FilePlus
        class="size-3.5 flex-shrink-0 {isStreaming
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
        {@const showDiff =
          !isStreaming &&
          (operation === 'edit' || operation === 'create') &&
          (addedCount > 0 || removedCount > 0)}
        <span class="inline-flex min-w-0 items-center gap-1.5">
          {#if onOpenFile && path}
            <button
              type="button"
              title={path}
              class="inline-flex min-w-0 cursor-pointer items-center gap-1 truncate rounded font-mono text-[12px] text-foreground/80 hover:text-foreground hover:underline focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:outline-none"
              onclick={(e) => {
                e.stopPropagation();
                onOpenFile(path);
              }}>
              <img
                src={fileIconSrc(filename)}
                alt=""
                aria-hidden="true"
                class="size-3.5 flex-shrink-0" />
              <span class="truncate">{filename}</span>
            </button>
          {:else}
            <span
              class="inline-flex min-w-0 items-center gap-1 truncate font-mono text-[12px] text-foreground/80"
              title={path}>
              <img
                src={fileIconSrc(filename)}
                alt=""
                aria-hidden="true"
                class="size-3.5 flex-shrink-0" />
              <span class="truncate">{filename}</span>
            </span>
          {/if}
          {#if showDiff}
            <span class="inline-flex flex-shrink-0 items-center gap-1 font-mono text-[12px]">
              {#if addedCount > 0}
                <span class="text-emerald-600 dark:text-emerald-400">+{addedCount}</span>
              {/if}
              {#if removedCount > 0}
                <span class="text-red-600 dark:text-red-400">-{removedCount}</span>
              {/if}
            </span>
          {/if}
        </span>
      {/if}

      {#if (isStreaming || !(operation === 'edit' || operation === 'create') || (addedCount === 0 && removedCount === 0)) && artifactSubtitle}
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

  <!-- Code body. Streaming and final rendering use the same diff layout
       (green rails + bg on every line). No special streaming variant
       needed; the per-line treatment is the streaming cue. -->
  {#if !isCollapsed}
    <div
      bind:this={codeContainer}
      class="artifact-code-body relative mt-1 overflow-auto border border-border transition-[max-height] duration-150"
      style="max-height: {isStreaming
        ? '320px'
        : '240px'}; background-color: var(--code-bg); border-radius: var(--ds-radius-lg);">
      {#if showDiffView}
        <!-- Diff-only view: show only changed regions -->
        <table class="artifact-code-table w-full border-collapse">
          <tbody>
            <!-- Key intentionally excludes `dl.text`. The streaming last
                 line mutates character-by-character; if text was in the
                 key, every token would change the key, destroy + recreate
                 the <tr>, and re-run the row entrance animation — that
                 produced the flicker. Position (type + lineNum + i) is
                 stable across token updates, so Svelte updates the row's
                 text in place. -->
            {#each diffLines as dl, i (`${dl.type}:${dl.lineNum ?? 'gap'}:${i}`)}
              {@const lineTokens = tokensForLine(
                dl.text,
                dl.lineNum,
                dl.type === 'removed' ? 'prev' : 'main'
              )}
              {#if dl.type === 'separator'}
                <tr>
                  <td
                    colspan="3"
                    class="border-y border-border px-3 py-1 text-center text-[13px] text-muted-foreground"
                    style="background-color: color-mix(in oklab, var(--foreground), transparent 95%);"
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
                    {dl.type === 'added' ? 'artifact-row-added' : ''}
                    {dl.type === 'removed' ? 'artifact-row-removed' : ''}
                    {dl.type === 'context' ? 'artifact-row-context' : ''}">
                  <td
                    class="px-1 text-center align-top font-semibold select-none
                      {dl.type === 'added' ? 'artifact-rail-added' : ''}
                      {dl.type === 'removed' ? 'artifact-rail-removed' : ''}
                      {dl.type === 'context' ? 'border-l-2 border-transparent' : ''}"
                    style="width: 1.25rem; min-width: 1.25rem;">
                    {#if dl.type === 'added'}+{/if}
                    {#if dl.type === 'removed'}−{/if}
                  </td>
                  <td
                    class="artifact-ln border-r border-border px-3 text-right align-top text-muted-foreground select-none"
                    style="width: 2.75rem; min-width: 2.75rem;">
                    {dl.lineNum || ''}
                  </td>
                  <!-- Text color falls back to the type color only when
                       shiki tokens aren't available (e.g. during streaming).
                       Tokenized lines render with shiki's per-token colors. -->
                  <td
                    class="px-4 align-top whitespace-pre
                    {!lineTokens && dl.type === 'added' ? 'artifact-text-added' : ''}
                    {!lineTokens && dl.type === 'removed' ? 'artifact-text-removed' : ''}
                    {dl.type === 'context' || lineTokens ? 'text-foreground' : ''}">
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
        <table class="artifact-code-table w-full border-collapse">
          <tbody>
            <!-- Key by index only. Including `line` made the streaming
                 last line re-mount on every token, retriggering the row
                 entrance animation and flickering. -->
            {#each lines as line, i (i)}
              {@const lineTokens = codeTokenLines ? codeTokenLines[i] : null}
              <!-- No per-line streaming bg — that "trailing 3 lines" glow
                   flickered as new lines arrived and pulsed green even on
                   lines that would settle as unchanged. Streaming tint
                   comes from the text-color override on .artifact-code
                   instead, applied to the whole body while streaming. -->
              <tr class="artifact-line artifact-row-context group transition-colors duration-75">
                <td
                  class="artifact-ln border-r border-border px-3 text-right align-top text-muted-foreground select-none"
                  style="width: {lineCount > 99 ? '3.5rem' : '2.75rem'}; min-width: {lineCount > 99
                    ? '3.5rem'
                    : '2.75rem'};">
                  {i + 1}
                </td>
                <td class="artifact-code px-4 align-top whitespace-pre text-foreground">
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

  /* Streaming caret. Color matches the streaming-line tint family
     (emerald) instead of the brand purple — keeps the whole streaming
     viewport reading as "incoming additions". */
  .artifact-cursor {
    display: inline-block;
    width: 2px;
    height: 1.1em;
    background: var(--success);
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

  /* Every diff/streaming row fades in on mount. With the stable Svelte
     key (type:lineNum:text:i), rows whose identity hasn't changed don't
     re-animate — only freshly-arrived rows do. That gives the "lines
     materializing into the diff" feel during streaming, and a calm
     reveal of changed regions when the final diff lands. */
  .artifact-line {
    animation: artifact-row-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes artifact-row-in {
    from {
      opacity: 0;
      transform: translateY(2px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .artifact-line {
      animation: none;
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

  /* Code surface — mono lock at 12px / lh 1.5 per DESIGN.md typography.mono.
     Tables inside `.artifact-code-body` pick this up so cells stay consistent
     regardless of which view (diff or full) is rendering. */
  .artifact-code-table {
    font-family: var(--ds-font-mono);
    font-size: var(--fs-mono);
    line-height: var(--lh-mono);
  }

  /* Diff row tints — wired to the semantic design tokens (--success,
     --destructive) via color-mix so they track theme changes. The bg sits
     at ~10% opacity over --code-bg; the rail edge at ~50% gives the
     "this changed" cue without overpowering the syntax colors. */
  .artifact-row-added {
    background-color: color-mix(in oklab, var(--success), transparent 90%);
  }
  .artifact-row-removed {
    background-color: color-mix(in oklab, var(--destructive), transparent 90%);
  }
  .artifact-row-context:hover {
    background-color: color-mix(in oklab, var(--foreground), transparent 95%);
  }
  .artifact-rail-added {
    border-left: 2px solid color-mix(in oklab, var(--success), transparent 50%);
    color: var(--success);
  }
  .artifact-rail-removed {
    border-left: 2px solid color-mix(in oklab, var(--destructive), transparent 50%);
    color: var(--destructive);
  }
  /* Fallback text colors when shiki tokens aren't ready yet (streaming first
     paint). Same tokens as the rails so the row reads as one unit. */
  .artifact-text-added {
    color: color-mix(in oklab, var(--success), var(--foreground) 30%);
  }
  .artifact-text-removed {
    color: color-mix(in oklab, var(--destructive), var(--foreground) 30%);
  }

  /* Scrollbar — `--muted-foreground` is already a full color value in this
     project (not an `hsl(...)` triple), so we use `color-mix` against it
     directly instead of wrapping it in hsl(). 8px wide so it reads from
     scroll-distance, but small enough not to compete with the gutter. */
  .artifact-code-body {
    scrollbar-width: thin;
    scrollbar-color: color-mix(in oklab, var(--muted-foreground), transparent 70%) transparent;
  }
  .artifact-code-body::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .artifact-code-body::-webkit-scrollbar-thumb {
    background: color-mix(in oklab, var(--muted-foreground), transparent 70%);
    border-radius: var(--ds-radius-pill);
  }
  .artifact-code-body::-webkit-scrollbar-thumb:hover {
    background: color-mix(in oklab, var(--muted-foreground), transparent 40%);
  }
  .artifact-code-body::-webkit-scrollbar-track {
    background: transparent;
  }
  .artifact-code-body::-webkit-scrollbar-corner {
    background: transparent;
  }
</style>
