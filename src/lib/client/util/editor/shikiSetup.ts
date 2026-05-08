import type * as Monaco from 'monaco-editor';
import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco';
import { createHighlighter, type Highlighter } from 'shiki';

let highlighter: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;
let installed = false;

/**
 * Shared shiki highlighter — used by Monaco (editor) and the chat code block
 * so syntax colors are guaranteed identical across both surfaces.
 *
 * Failure recovery: if init throws, the cached promise is cleared so the next
 * caller can retry. Errors are logged loudly so silent fallback to plain text
 * isn't mysterious.
 */
export function getSharedHighlighter(): Promise<Highlighter> {
  if (highlighter) return Promise.resolve(highlighter);
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = (async () => {
    try {
      const mermaidGrammar = await buildStandaloneMermaidGrammar().catch((err) => {
        console.warn(
          '[shiki] mermaid grammar load failed; continuing without it:',
          err
        );
        return null;
      });
      const langs: unknown[] = ['json', 'yaml', 'markdown'];
      if (mermaidGrammar) langs.unshift(mermaidGrammar);
      const hl = await createHighlighter({
        themes: ['dark-plus', 'light-plus'],
        langs: langs as never
      });
      highlighter = hl;
      return hl;
    } catch (err) {
      // Clear the cached rejected promise so next call can retry.
      highlighterPromise = null;
      console.error('[shiki] highlighter init failed:', err);
      throw err;
    }
  })();
  return highlighterPromise;
}

// Shiki bundles a `mermaid` grammar that's designed to inject inside markdown
// fenced blocks (its top-level `patterns` only fire after a ```mermaid marker).
// When we use it standalone in Monaco, nothing matches and everything renders
// as plain text. Build a standalone variant by promoting the inner repository
// entries to the top-level patterns.
async function buildStandaloneMermaidGrammar(): Promise<unknown> {
  const { bundledLanguages } = await import('shiki/langs');
  const loader = (bundledLanguages as Record<string, () => Promise<{ default: unknown[] }>>)
    .mermaid;
  if (!loader) throw new Error('mermaid grammar not bundled in shiki');
  const mod = await loader();
  const arr = mod.default;
  // Deep clone so we don't mutate the cached module.
  const grammar = JSON.parse(JSON.stringify(arr[0])) as {
    patterns: Array<{ include: string }>;
    repository: Record<string, { patterns?: unknown[] }>;
    injectionSelector?: string;
    scopeName?: string;
    name?: string;
  };
  // Drop the markdown-injection so the grammar applies as the root tokenizer.
  delete grammar.injectionSelector;
  // Replace top-level patterns with the real diagram patterns from the repository.
  // The bundled grammar nests the actual rules under `repository.mermaid.patterns`.
  const inner = grammar.repository?.mermaid?.patterns;
  if (Array.isArray(inner) && inner.length > 0) {
    grammar.patterns = inner as Array<{ include: string }>;
  }
  // Force a sane root scope. The bundled grammar uses
  // 'markdown.mermaid.codeblock' (designed for markdown injection), which
  // doesn't match any rules in dark-plus / light-plus. Use 'source.mermaid'
  // (the conventional VS Code scope) so theme rules apply correctly.
  grammar.scopeName = 'source.mermaid';
  if (!grammar.name) {
    grammar.name = 'mermaid';
  }
  return grammar;
}

export async function setupShiki(monaco: typeof Monaco): Promise<void> {
  if (installed) return;
  installed = true;

  // Register first so shikiToMonaco picks them up.
  monaco.languages.register({ id: 'mermaid' });
  monaco.languages.register({ id: 'json' });
  monaco.languages.register({ id: 'yaml' });
  monaco.languages.register({ id: 'markdown' });

  const hl = await getSharedHighlighter();

  // Wire shiki tokenization into Monaco. This replaces tokens providers for the
  // languages above and patches monaco.editor.setTheme to map shiki themes.
  shikiToMonaco(hl, monaco);

  // Override the editor canvas colors so the editor surface blends with the app.
  // Shiki re-defines themes on every setTheme call, but it pulls colors from its
  // internal theme cache; redefining the Monaco theme here wins for the canvas.
  const overrides = {
    light: {
      'editor.background': '#ffffff',
      'editor.foreground': '#0a0a0a',
      'editor.lineHighlightBackground': '#f5f5f5',
      'editorLineNumber.foreground': '#d4d4d4',
      'editorLineNumber.activeForeground': '#0a0a0a',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#e5e5e5',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#e5e5e5',
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#e5e5e5',
      // Match the global app scrollbar (transparent until hover, then ~25%/50% muted-foreground).
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': '#64748b40',
      'scrollbarSlider.hoverBackground': '#64748b80',
      'scrollbarSlider.activeBackground': '#64748bcc'
    },
    dark: {
      'editor.background': '#141414',
      'editor.foreground': '#ededed',
      'editor.lineHighlightBackground': '#1c1c1c',
      'editorLineNumber.foreground': '#3a3a3a',
      'editorLineNumber.activeForeground': '#ededed',
      'editorWidget.background': '#141414',
      'editorWidget.border': '#262626',
      'editorSuggestWidget.background': '#141414',
      'editorSuggestWidget.border': '#262626',
      'editorHoverWidget.background': '#141414',
      'editorHoverWidget.border': '#262626',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.background': '#a0a0a040',
      'scrollbarSlider.hoverBackground': '#a0a0a080',
      'scrollbarSlider.activeBackground': '#a0a0a0cc'
    }
  };
  patchTheme(monaco, 'light-plus', overrides.light);
  patchTheme(monaco, 'dark-plus', overrides.dark);

  console.log('[shiki] ready. languages:', highlighter.getLoadedLanguages());
}

function patchTheme(
  monaco: typeof Monaco,
  themeId: 'light-plus' | 'dark-plus',
  colors: Record<string, string>
): void {
  if (!highlighter) return;
  const tm = highlighter.getTheme(themeId);
  // Use shiki's own translator so token rules match the shikiToMonaco pipeline,
  // then merge in our color overrides for the canvas (background, line numbers, etc).
  const monacoTheme = textmateThemeToMonacoTheme(tm);
  monaco.editor.defineTheme(themeId, {
    ...monacoTheme,
    colors: { ...monacoTheme.colors, ...colors }
  });
}

export function shikiThemeName(mode: 'light' | 'dark'): string {
  return mode === 'dark' ? 'dark-plus' : 'light-plus';
}
