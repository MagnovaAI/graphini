<script lang="ts">
  import {
    Check,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    Eye,
    FileCode,
    Sparkles
  } from 'lucide-svelte';
  import { tick } from 'svelte';

  interface Props {
    code: string;
    previousCode?: string;
    language?: string;
    title?: string;
    isStreaming?: boolean;
    operation?: 'create' | 'update' | 'patch' | 'delete' | 'read';
    defaultCollapsed?: boolean;
    hasErrors?: boolean;
    errors?: string[];
    onApply?: (code: string) => void;
    onOpenEditor?: () => void;
    readFrom?: number;
    readTo?: number;
    totalLines?: number;
  }

  let {
    code,
    previousCode = '',
    language = 'mermaid',
    title = 'Diagram Code',
    isStreaming = false,
    operation = 'create',
    defaultCollapsed,
    hasErrors = false,
    errors = [],
    onApply,
    onOpenEditor,
    readFrom,
    readTo,
    totalLines
  }: Props = $props();

  let isCollapsed = $state(false);
  let codeContainer: HTMLDivElement | undefined = $state();
  let applied = $state(false);
  let wasStreaming = $state(false);
  let collapseInitialized = false;

  // Initialize once from props, then preserve user toggles except for streaming completion.
  $effect(() => {
    if (!collapseInitialized) {
      isCollapsed = defaultCollapsed ?? operation === 'read';
      collapseInitialized = true;
    } else if (wasStreaming && !isStreaming) {
      isCollapsed = true;
    }
    wasStreaming = isStreaming;
  });

  let lines = $derived(code.split('\n'));
  let lineCount = $derived(lines.length);
  let isRead = $derived(operation === 'read');
  let isError = $derived(isRead && hasErrors);

  // Diff: compute added/removed lines vs previousCode
  let prevLines = $derived(previousCode ? previousCode.split('\n') : []);
  let prevTrimmed = $derived(prevLines.map((l) => l.trim()));
  let curTrimmed = $derived(lines.map((l) => l.trim()));
  let addedCount = $derived(
    previousCode ? lines.filter((l) => !prevTrimmed.includes(l.trim())).length : 0
  );
  let removedCount = $derived(
    previousCode ? prevLines.filter((l) => !curTrimmed.includes(l.trim())).length : 0
  );
  let hasDiff = $derived(previousCode.length > 0 && (addedCount > 0 || removedCount > 0));

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
  let showDiffView = $derived(hasDiff && !isStreaming && diffLines.length > 0);

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

  // Operation labels
  const operationLabel: Record<string, string> = {
    create: 'Writing',
    delete: 'Clearing',
    patch: 'Patching',
    read: 'Checking',
    update: 'Updating'
  };

  // Syntax highlighting for mermaid — uses placeholder tokens to avoid regex cascading
  function highlightLine(text: string): string {
    const tokens: { match: string; cls: string }[] = [];
    let uid = 0;
    const ph = (m: string, cls: string) => {
      const id = `\x00${uid++}\x00`;
      tokens.push({ match: m, cls });
      return id;
    };

    // 1. Collect tokens (order matters: longer/more-specific first)
    let s = text;
    s = s.replace(/%%(.*)$/gm, (m) => ph(m, 'artifact-comment'));
    s = s.replace(
      /\b(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|mindmap|timeline|gitGraph|C4Context|C4Container|C4Deployment|C4Dynamic|block-beta|sankey-beta|xychart-beta|packet-beta|kanban|architecture-beta|zenuml)\b/g,
      (m) => ph(m, 'artifact-kw')
    );
    s = s.replace(
      /\b(subgraph|end|participant|actor|Note|loop|alt|else|opt|par|critical|break|rect|activate|deactivate|class|style|classDef|click|linkStyle|section|title|dateFormat|axisFormat)\b/g,
      (m) => ph(m, 'artifact-builtin')
    );
    s = s.replace(/\b(TB|BT|LR|RL|TD)\b/g, (m) => ph(m, 'artifact-dir'));
    s = s.replace(/(--|-->|---|-\.->|==>|--x|--o|<-->|~~>|\.\.->>)/g, (m) =>
      ph(m, 'artifact-arrow')
    );
    s = s.replace(/(\[{1,2}|\({1,2}|\{{1,2})/g, (m) => ph(m, 'artifact-bracket'));
    s = s.replace(/(\]{1,2}|\){1,2}|\}{1,2})/g, (m) => ph(m, 'artifact-bracket'));

    // 2. HTML-escape the remaining plain text
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 3. Replace placeholders with styled spans (token content is also escaped)
    for (let i = 0; i < tokens.length; i++) {
      const escaped = tokens[i].match
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      s = s.replace(`\x00${i}\x00`, `<span class="${tokens[i].cls}">${escaped}</span>`);
    }
    return s;
  }
</script>

<div
  class={[
    'artifact-container my-1.5 overflow-hidden rounded-lg border shadow-sm transition-all duration-200',
    isError
      ? 'border-red-500/30 bg-red-500/[0.03] dark:border-red-400/20 dark:bg-red-500/[0.04]'
      : isRead
        ? 'border-amber-500/25 bg-card dark:bg-card'
        : isStreaming
          ? 'border-primary/30 bg-card'
          : 'border-border/40 bg-card',
    isStreaming && !isRead && 'artifact-streaming',
    !isStreaming && code.length > 0 && !isRead && 'artifact-complete'
  ]}>
  <!-- Header -->
  <button
    type="button"
    onclick={() => (isCollapsed = !isCollapsed)}
    class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30">
    <!-- Icon -->
    <div
      class="flex size-5 shrink-0 items-center justify-center rounded-md
        {isError
        ? 'bg-red-500/15 text-red-600 dark:text-red-400'
        : isRead
          ? 'bg-amber-500/10 text-amber-500'
          : isStreaming
            ? 'bg-blue-500/10 text-blue-500'
            : 'bg-emerald-500/10 text-emerald-500'}">
      {#if isError}
        <Eye class="size-3 text-red-500" />
      {:else if isRead}
        <Eye class="size-3" />
      {:else if isStreaming}
        <Sparkles class="size-3 animate-pulse" />
      {:else}
        <FileCode class="size-3" />
      {/if}
    </div>

    <!-- Title -->
    <span
      class="flex-1 text-xs font-medium
        {isError
        ? 'text-red-700 dark:text-red-300'
        : isStreaming
          ? 'text-blue-700 dark:text-blue-300'
          : 'text-muted-foreground'}">
      {#if isStreaming}
        {operationLabel[operation] || 'Generating'}
      {:else if isError}
        {errors.length} error{errors.length !== 1 ? 's' : ''} found
      {:else}
        {title} · {language.toUpperCase()} · {lineCount}L
      {/if}
      {#if isRead && readFrom && readTo}
        <span
          class="ml-1 rounded bg-muted/60 px-1 py-0.5 text-[9px] font-normal text-muted-foreground/60">
          L{readFrom}{readTo !== readFrom ? `–${readTo}` : ''}{totalLines
            ? ` of ${totalLines}`
            : ''}
        </span>
      {/if}
    </span>

    <!-- Streaming dots -->
    {#if isStreaming}
      <div class="flex items-center gap-0.5">
        <span
          class="inline-block size-1 animate-pulse rounded-full bg-blue-500 [animation-delay:0ms]"
        ></span>
        <span
          class="inline-block size-1 animate-pulse rounded-full bg-blue-500 [animation-delay:150ms]"
        ></span>
        <span
          class="inline-block size-1 animate-pulse rounded-full bg-blue-500 [animation-delay:300ms]"
        ></span>
      </div>
    {/if}

    <!-- Chevron -->
    <div class="text-muted-foreground/40 transition-transform">
      {#if isCollapsed}
        <ChevronDown class="size-3.5" />
      {:else}
        <ChevronUp class="size-3.5" />
      {/if}
    </div>
  </button>

  <!-- Error banner -->
  {#if isError && !isCollapsed && errors.length > 0}
    <div class="border-t border-red-500/20 bg-red-500/[0.05] px-3 py-1.5 dark:bg-red-500/[0.08]">
      {#each errors as err (err)}
        <p class="text-[11px] leading-relaxed text-red-600 dark:text-red-400">{err}</p>
      {/each}
    </div>
  {/if}

  <!-- Code body -->
  {#if !isCollapsed}
    <div
      bind:this={codeContainer}
      class="artifact-code-body relative overflow-auto transition-all duration-200"
      style="max-height: {isStreaming ? '300px' : '250px'};">
      {#if showDiffView}
        <!-- Diff-only view: show only changed regions -->
        <table class="w-full border-collapse font-mono text-[11.5px] leading-[1.65]">
          <tbody>
            {#each diffLines as dl, i (`${dl.type}:${dl.lineNum ?? 'gap'}:${dl.text}:${i}`)}
              {#if dl.type === 'separator'}
                <tr>
                  <td
                    colspan="3"
                    class="border-y border-border/20 bg-muted/20 px-3 py-0.5 text-center text-[9px] text-muted-foreground/40"
                    >···</td>
                </tr>
              {:else}
                <tr
                  class="artifact-line transition-colors duration-75
                    {dl.type === 'added' ? 'bg-emerald-500/[0.08] dark:bg-emerald-500/[0.12]' : ''}
                    {dl.type === 'removed' ? 'bg-red-500/[0.08] dark:bg-red-500/[0.12]' : ''}
                    {dl.type === 'context' ? 'hover:bg-muted/30' : ''}">
                  <td
                    class="px-0.5 text-center align-top font-mono text-[10px] leading-[1.65] select-none"
                    style="width: 1.25rem; min-width: 1.25rem;">
                    {#if dl.type === 'added'}<span class="text-emerald-600 dark:text-emerald-400"
                        >+</span
                      >{/if}
                    {#if dl.type === 'removed'}<span class="text-red-600 dark:text-red-400">−</span
                      >{/if}
                  </td>
                  <td
                    class="artifact-ln border-r border-border/30 px-3 text-right align-top text-muted-foreground/40 select-none"
                    style="width: 2.75rem; min-width: 2.75rem;">
                    {dl.lineNum || ''}
                  </td>
                  <td
                    class="px-4 align-top whitespace-pre
                    {dl.type === 'removed'
                      ? 'text-red-700/80 line-through dark:text-red-400/80'
                      : 'text-foreground/90'}">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html highlightLine(dl.text)}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {:else}
        <!-- Full code view -->
        <table class="w-full border-collapse font-mono text-[11.5px] leading-[1.65]">
          <tbody>
            {#each lines as line, i (`${i}:${line}`)}
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
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  {@html highlightLine(line)}{#if isStreaming && i === lineCount - 1}<span
                      class="artifact-cursor"></span
                    >{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <!-- Footer -->
    {#if !isStreaming && (onApply || onOpenEditor)}
      <div class="flex items-center justify-end gap-1.5 border-t border-border/30 px-3 py-1">
        {#if onOpenEditor}
          <button
            type="button"
            class="flex items-center gap-1 rounded-md bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onclick={() => onOpenEditor?.()}>
            <ExternalLink class="size-2.5" />
            Show Editor
          </button>
        {/if}
        {#if onApply}
          <button
            type="button"
            disabled={applied}
            class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors {applied
              ? 'cursor-default bg-emerald-500/15 text-emerald-500 opacity-70'
              : 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400'}"
            onclick={() => {
              onApply?.(code);
              applied = true;
            }}>
            {#if applied}
              <Check class="size-2.5" />
              Applied
            {:else}
              Apply
            {/if}
          </button>
        {/if}
      </div>
    {/if}
  {:else if !isError}
    <!-- Collapsed preview -->
    <div
      class="border-t border-border/30 px-3 py-1.5 font-mono text-[10px] text-muted-foreground/70">
      {code.split('\n').slice(0, 1).join(' ').substring(0, 60)}{code.split('\n').length > 1
        ? '...'
        : ''}
    </div>
  {/if}
</div>

<style>
  /* Cursor blink animation */
  .artifact-cursor {
    display: inline-block;
    width: 2px;
    height: 1.1em;
    background: hsl(var(--primary));
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

  /* Streaming glow border */
  .artifact-streaming {
    border-color: hsl(var(--primary) / 0.3);
    box-shadow:
      0 0 0 1px hsl(var(--primary) / 0.05),
      0 2px 8px hsl(var(--primary) / 0.08);
  }

  .artifact-complete {
    border-color: hsl(142 76% 36% / 0.2);
  }

  /* New line highlight during streaming */
  .artifact-line-new {
    background: hsl(var(--primary) / 0.04);
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
