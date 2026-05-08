<script lang="ts">
  import { Check, Copy } from 'lucide-svelte';
  import { mode } from 'mode-watcher';
  import type { Tokens } from 'marked';
  import { type Highlighter, type ThemedToken } from 'shiki';
  import { getSharedHighlighter } from '$lib/util/editor/shikiSetup';

  const { token }: { token: Tokens.Code; id?: string } = $props();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  function doCopy() {
    try {
      navigator.clipboard.writeText(token.text);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2000);
    } catch {
      // ignore
    }
  }

  function getHighlighter(): Promise<Highlighter> {
    return getSharedHighlighter();
  }

  // mode-watcher's `mode.current` can be undefined / 'system' on first render.
  // Resolve via the .dark class on <html> for reliability.
  let isDark = $state(
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : false
  );
  $effect(() => {
    void mode.current; // re-check when mode-watcher changes
    if (typeof document !== 'undefined') {
      isDark = document.documentElement.classList.contains('dark');
    }
  });
  // Watch <html> class mutations (e.g. system theme flip) too.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() => {
      isDark = document.documentElement.classList.contains('dark');
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  });
  let activeThemeName = $derived(isDark ? 'dark-plus' : 'light-plus');
  let tokenLines = $state<ThemedToken[][] | null>(null);

  $effect(() => {
    const text = token.text;
    const rawLang = (token.lang || '').trim().toLowerCase() || 'text';
    const themeName = activeThemeName;
    let cancelled = false;
    void (async () => {
      try {
        const hl = await getHighlighter();
        // Try to load the language; fall back to 'text' if shiki doesn't know it.
        let lang = rawLang;
        if (!hl.getLoadedLanguages().includes(lang)) {
          try {
            await hl.loadLanguage(lang as never);
          } catch {
            lang = 'text';
          }
        }
        const result = hl.codeToTokens(text, {
          lang: lang as never,
          theme: themeName as never,
          includeExplanation: 'scopeName' as never
        });
        if (!cancelled) {
          tokenLines = result.tokens;
          if (lang === 'mermaid') {
            console.log(
              '[ChatCodeBlock] sample tokens for mermaid:',
              result.tokens[0]?.slice(0, 6).map((t) => ({
                content: t.content,
                color: t.color,
                scopes: (t as unknown as { explanation?: { scopes: { scopeName: string }[] }[] })
                  .explanation?.[0]?.scopes?.map((s) => s.scopeName)
              }))
            );
          }
        }
      } catch (err) {
        console.warn('[ChatCodeBlock] shiki failed', err);
        if (!cancelled) tokenLines = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<div
  class="relative my-3 overflow-hidden rounded-[10px]"
  style="background-color: var(--code-bg);">
  <button
    type="button"
    tabindex={-1}
    onclick={doCopy}
    class="absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/40 hover:text-foreground"
    title={copied ? 'Copied!' : 'Copy code'}
    aria-label={copied ? 'Copied' : 'Copy code'}>
    {#if copied}
      <Check class="size-3" />
    {:else}
      <Copy class="size-3" />
    {/if}
  </button>
  <pre
    class="m-0 overflow-x-auto bg-transparent px-4 py-3 font-mono text-[12px] leading-[1.5] whitespace-pre text-foreground [&_*]:bg-transparent [&_*]:whitespace-pre"
    style="tab-size: 2;"><code
      >{#if tokenLines}{#each tokenLines as line}<span class="block">{#each line as t}<span style:color={t.color} style:background-color={t.bgColor}>{t.content}</span>{/each}</span>{/each}{:else}{token.text}{/if}</code
    ></pre>
</div>
