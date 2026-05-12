<script lang="ts">
  /**
   * Hierarchical JSON tree viewer — replaces the card-graph for JSON files.
   * Lazy: only children of expanded nodes mount, so deeply nested or wide
   * JSONs (thousands of rows) stay responsive. Each level caps initial render
   * at PAGE_SIZE entries with a "show N more" link.
   *
   * Search highlights matching keys/values and auto-expands their ancestors.
   */
  import { Check, ChevronRight, Copy } from 'lucide-svelte';
  import { SvelteSet } from 'svelte/reactivity';

  let { source, search = $bindable('') }: { source: string; search?: string } = $props();

  let copiedPath = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      copiedPath = path;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedPath = null), 1200);
    } catch {
      // Clipboard unavailable (insecure context / permission denied) — silent.
    }
  }

  const PAGE_SIZE = 200;

  // Parse JSON. Errors render as an inline message; we don't throw — the
  // editor already surfaces syntax errors, this view just degrades quietly.
  const parsed = $derived.by<{ ok: true; value: unknown } | { ok: false; error: string }>(() => {
    const trimmed = source?.trim();
    if (!trimmed) return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Expanded node paths. Path is "$.foo.bar[0]" style.
  // SvelteSet is reactive on its own — no $state wrapper needed.
  const expanded = new SvelteSet<string>(['$']);
  let pageOverrides = $state<Record<string, number>>({});

  function isObject(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function isExpandable(v: unknown): boolean {
    return Array.isArray(v) || isObject(v);
  }

  function entries(v: unknown): [string, unknown][] {
    if (Array.isArray(v)) return v.map((item, i) => [String(i), item]);
    if (isObject(v)) return Object.entries(v);
    return [];
  }

  function toggle(path: string) {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
  }

  function valueSummary(v: unknown): string {
    if (Array.isArray(v)) return `[${v.length} ${v.length === 1 ? 'item' : 'items'}]`;
    if (isObject(v)) {
      const n = Object.keys(v).length;
      return `{${n} ${n === 1 ? 'key' : 'keys'}}`;
    }
    if (v === null) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    return String(v);
  }

  function valueKind(v: unknown): 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'object') return 'object';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    return 'string';
  }

  // Search: collect paths whose key/value contains the query, plus every
  // ancestor of those paths (so the tree auto-expands to reveal matches).
  // Plain Set is intentional here — these are local-to-the-derived snapshots,
  // not reactive state.
  /* eslint-disable svelte/prefer-svelte-reactivity */
  const searchResult = $derived.by<{ matches: Set<string>; ancestors: Set<string> }>(() => {
    const empty = { matches: new Set<string>(), ancestors: new Set<string>() };
    const q = search.trim().toLowerCase();
    if (!q || !parsed.ok) return empty;
    const matches = new Set<string>();
    const ancestors = new Set<string>();

    function walk(v: unknown, path: string, parentKey: string) {
      const keyMatches = parentKey.toLowerCase().includes(q);
      const valueMatches = !isExpandable(v) && String(v).toLowerCase().includes(q);
      if (keyMatches || valueMatches) {
        matches.add(path);
        // Mark every ancestor segment so they auto-expand.
        const segments = path.split(/(?=[.[])/);
        let cur = segments[0];
        ancestors.add(cur);
        for (let i = 1; i < segments.length; i++) {
          cur += segments[i];
          ancestors.add(cur);
        }
      }
      if (isExpandable(v)) {
        for (const [k, child] of entries(v)) {
          const childPath = Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`;
          walk(child, childPath, k);
        }
      }
    }

    walk(parsed.value, '$', '$');
    return { matches, ancestors };
  });

  const effectiveExpanded = $derived.by(() => {
    if (searchResult.ancestors.size === 0) return expanded;
    const combined = new Set(expanded);
    for (const a of searchResult.ancestors) combined.add(a);
    return combined;
  });
  /* eslint-enable svelte/prefer-svelte-reactivity */

  const matchSet = $derived(searchResult.matches);

  function pageSize(path: string): number {
    return pageOverrides[path] ?? PAGE_SIZE;
  }

  function showMore(path: string, total: number) {
    pageOverrides[path] = Math.min(total, pageSize(path) + PAGE_SIZE);
  }

  function showAll(path: string, total: number) {
    pageOverrides[path] = total;
  }

  function formatCount(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
    return String(n);
  }

  export function expandAll() {
    if (!parsed.ok) return;
    expanded.clear();
    expanded.add('$');
    function walk(v: unknown, path: string) {
      if (!isExpandable(v)) return;
      expanded.add(path);
      for (const [k, child] of entries(v)) {
        const childPath = Array.isArray(v) ? `${path}[${k}]` : `${path}.${k}`;
        walk(child, childPath);
      }
    }
    walk(parsed.value, '$');
  }

  export function collapseAll() {
    expanded.clear();
    expanded.add('$');
    pageOverrides = {};
  }
</script>

<div class="tree-canvas">
  <div class="tree-body">
    {#if !parsed.ok}
      <div class="tree-error">
        <strong>Invalid JSON</strong>
        <span>{parsed.error}</span>
      </div>
    {:else if parsed.value === null && !source?.trim()}
      <div class="tree-empty">No JSON content yet.</div>
    {:else}
      {@render node('$', 'JSON', parsed.value, 0, false)}
    {/if}
  </div>
</div>

{#snippet node(path: string, key: string, value: unknown, depth: number, isIndex: boolean)}
  {@const expandableNode = isExpandable(value)}
  {@const isOpen = effectiveExpanded.has(path)}
  {@const isMatch = matchSet.has(path)}
  {@const kind = valueKind(value)}
  {@const justCopied = copiedPath === path}

  <!-- Whole-row click toggles expansion for parents; scalars just select.
       Indent guides are drawn via inline divs (one per ancestor depth) so
       they line up exactly with chevron centers and survive horizontal
       scroll. The tabindex is only set when role='button' is also set,
       but Svelte's static a11y check can't see that gating. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="tree-row {isMatch ? 'tree-row-match' : ''} {expandableNode ? 'tree-row-expandable' : ''}"
    role={expandableNode ? 'button' : undefined}
    tabindex={expandableNode ? 0 : undefined}
    onclick={() => expandableNode && toggle(path)}
    onkeydown={(e) => {
      if (!expandableNode) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle(path);
      }
    }}>
    <div class="tree-indent" aria-hidden="true">
      <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
      {#each Array.from({ length: depth }) as _entry, i (i)}
        <span class="tree-guide"></span>
      {/each}
    </div>

    <!-- Prefix block: chevron + glyph form one 32px unit (16+16). Keeping
         them as a single flex group with zero gap prevents drift between
         them as depth grows, and lets row-level gap apply only between
         the prefix and the key. -->
    <span class="tree-prefix" aria-hidden="true">
      {#if expandableNode}
        <span class="tree-chevron">
          <ChevronRight class="size-3 transition-transform {isOpen ? 'rotate-90' : ''}" />
        </span>
      {:else}
        <span class="tree-chevron-spacer"></span>
      {/if}
      <span class="tree-glyph tree-glyph-{kind}">
        {#if kind === 'object'}{'{}'}{:else if kind === 'array'}[]{:else}&#9632;{/if}
      </span>
    </span>

    <span class={isIndex ? 'tree-index' : 'tree-key'}>{key}</span>
    {#if expandableNode}
      <span class="tree-summary">{valueSummary(value)}</span>
    {:else}
      <span class="tree-colon">:</span>
      <span class="tree-value tree-value-{kind}">{valueSummary(value)}</span>
    {/if}

    <button
      type="button"
      class="tree-copy"
      title="Copy path"
      aria-label="Copy path {path}"
      onclick={(e) => {
        e.stopPropagation();
        copyPath(path);
      }}>
      {#if justCopied}
        <Check class="size-3" />
      {:else}
        <Copy class="size-3" />
      {/if}
    </button>
  </div>

  {#if expandableNode && isOpen}
    {@const children = entries(value)}
    {@const visible = children.slice(0, pageSize(path))}
    {@const childIsIndex = Array.isArray(value)}
    {#each visible as [childKey, childValue] (childKey)}
      {@const childPath = childIsIndex ? `${path}[${childKey}]` : `${path}.${childKey}`}
      {@render node(childPath, childKey, childValue, depth + 1, childIsIndex)}
    {/each}
    {#if children.length > visible.length}
      {@const remaining = children.length - visible.length}
      {@const nextBatch = Math.min(PAGE_SIZE, remaining)}
      <div class="tree-more-row">
        <div class="tree-indent" aria-hidden="true">
          <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
          {#each Array.from({ length: depth + 1 }) as _entry, i (i)}
            <span class="tree-guide"></span>
          {/each}
        </div>
        <div class="tree-more">
          <button
            type="button"
            class="tree-more-btn"
            title="Show next {nextBatch} of {remaining}"
            onclick={() => showMore(path, children.length)}>
            <span class="tree-more-label">show {formatCount(nextBatch)} more</span>
            <span class="tree-more-count">· {formatCount(remaining)} hidden</span>
          </button>
          {#if remaining > PAGE_SIZE}
            <button
              type="button"
              class="tree-more-btn tree-more-btn-secondary"
              title="Render all {remaining} remaining (may be slow)"
              onclick={() => showAll(path, children.length)}>
              show all
            </button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
{/snippet}

<style>
  @reference "../../../app.css";

  .tree-canvas {
    @apply flex h-full w-full flex-col bg-background;
  }

  .tree-body {
    @apply flex-1 overflow-auto py-1 font-mono text-[12px] leading-5;
  }

  /* Row: no global gap — column widths are pinned (indent steps, prefix
     block) so adjacent children can sit flush without drift. Gaps after
     the prefix are inserted manually via margin-left on the key. */
  .tree-row {
    @apply flex h-6 items-center pr-2 pl-2 text-[12px] leading-none whitespace-nowrap text-zinc-800 outline-none hover:bg-zinc-100/70 focus-visible:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800/50 dark:focus-visible:bg-zinc-800;
  }

  .tree-row-expandable {
    @apply cursor-pointer;
  }

  .tree-row-match {
    @apply bg-amber-100/60 dark:bg-amber-500/15;
  }

  /* Indent guides: one vertical hairline per ancestor depth. Each guide is
     a 16px slot (matching one indent step) with a 1px line drawn through
     its center via ::before — aligns exactly with the chevron column of
     the corresponding ancestor row. */
  .tree-indent {
    @apply flex shrink-0;
  }

  /* Each indent step = the prefix block width (32px: chevron 16 + glyph
     16) so the guide line lands exactly under depth-N's chevron column.
     The line at left:8px = the chevron slot's geometric center within
     the 16px chevron portion of the 32px step. */
  .tree-guide {
    @apply relative inline-block h-6 shrink-0;
    width: 32px;
  }

  .tree-guide::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 8px;
    width: 1px;
    background: color-mix(in oklab, var(--foreground) 10%, transparent);
  }

  /* Prefix block: exactly 32px (16 chevron + 16 glyph). Width pinned
     explicitly so flex can't expand or shrink it — children's indent
     guides depend on this being constant. */
  .tree-prefix {
    @apply inline-flex shrink-0 items-center;
    width: 32px;
  }

  .tree-chevron {
    @apply flex shrink-0 items-center justify-center rounded text-zinc-500 dark:text-zinc-400;
    width: 16px;
    height: 16px;
  }

  .tree-row-expandable:hover .tree-chevron {
    @apply text-zinc-900 dark:text-zinc-100;
  }

  .tree-chevron-spacer {
    @apply inline-block shrink-0;
    width: 16px;
    height: 16px;
  }

  /* Type glyph: pinned 16px slot. font-size varies by kind (set below)
     but the slot stays constant so the prefix grid never drifts. */
  .tree-glyph {
    @apply inline-flex shrink-0 items-center justify-center font-mono text-[11px] leading-none font-semibold;
    width: 16px;
    height: 16px;
  }

  .tree-glyph-object {
    @apply text-violet-600 dark:text-violet-300;
  }

  .tree-glyph-array {
    @apply text-amber-600 dark:text-amber-300;
  }

  /* Scalar squares (U+25A0) are heavier than the {} / [] brackets, so
     each scalar variant gets a smaller font-size baked into its rule. */
  .tree-glyph-string {
    @apply text-[8px] text-emerald-600 dark:text-emerald-400;
  }

  .tree-glyph-number {
    @apply text-[8px] text-orange-600 dark:text-orange-400;
  }

  .tree-glyph-boolean {
    @apply text-[8px] text-purple-600 dark:text-purple-400;
  }

  .tree-glyph-null {
    @apply text-[8px] text-zinc-400 dark:text-zinc-500;
  }

  /* Spacing after prefix: ml on the first text element instead of row gap
     so the indent + prefix columns stay flush. */
  .tree-key {
    @apply ml-1.5 text-blue-700 dark:text-blue-300;
  }

  .tree-index {
    @apply ml-1.5 text-zinc-500 tabular-nums dark:text-zinc-400;
  }

  .tree-colon {
    @apply ml-1 text-zinc-400 dark:text-zinc-500;
  }

  .tree-summary {
    @apply ml-1.5 text-zinc-500 dark:text-zinc-400;
  }

  .tree-value {
    @apply ml-1 min-w-0 truncate;
  }

  /* Copy-path button: hidden until row hover or focus. Single icon swap on
     click (Copy → Check) for ~1.2s feedback. */
  .tree-copy {
    @apply ml-auto flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-200/70 hover:text-zinc-900 focus-visible:opacity-100 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-100;
  }

  .tree-row:hover .tree-copy,
  .tree-row:focus-within .tree-copy {
    @apply opacity-100;
  }

  .tree-value-string {
    @apply text-emerald-700 dark:text-emerald-300;
  }

  .tree-value-number {
    @apply text-orange-600 dark:text-orange-300;
  }

  .tree-value-boolean {
    @apply text-purple-600 dark:text-purple-300;
  }

  .tree-value-null {
    @apply text-zinc-400 italic dark:text-zinc-500;
  }

  /* "Show more" row — uses the same indent guides as actual tree rows so
     it visually belongs to its parent's children list. */
  .tree-more-row {
    @apply flex h-6 items-center pr-2 pl-2;
  }

  .tree-more {
    @apply flex items-center;
  }

  /* Primary action: text-only link with a subtle hover background — reads
     as quiet UI affordance, not as a data row. The count rides as a muted
     separator-prefixed suffix ("show 200 more · 5.2k hidden"). */
  .tree-more-btn {
    @apply inline-flex h-5 cursor-pointer items-center gap-1.5 rounded-md bg-transparent px-1.5 font-mono text-[11px] text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-500/10 dark:hover:text-blue-300;
  }

  .tree-more-label {
    @apply font-medium;
  }

  .tree-more-count {
    @apply text-[10px] text-zinc-400 dark:text-zinc-500;
  }

  /* Secondary "Show all" — plain text link, no background hover, just a
     color shift. Sits inline with the primary so the row stays one line. */
  .tree-more-btn-secondary {
    @apply text-zinc-500 hover:bg-transparent hover:text-zinc-800 dark:text-zinc-500 dark:hover:bg-transparent dark:hover:text-zinc-200;
  }

  .tree-error {
    @apply m-3 flex flex-col gap-1 rounded-md border border-red-300 bg-red-50 p-3 text-[12px] text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200;
  }

  .tree-empty {
    @apply m-3 text-[12px] text-zinc-500 dark:text-zinc-400;
  }
</style>
