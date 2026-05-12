import type * as Monaco from 'monaco-editor';
import { shikiToMonaco, textmateThemeToMonacoTheme } from '@shikijs/monaco';
// JavaScript regex engine — works in every environment without wasm. The
// default oniguruma engine pulls in shiki/wasm at runtime and can fail when
// Vite's wasm handling isn't perfectly set up. shiki v4 re-exports this
// engine creator, so we don't need a direct dep on @shikijs/engine-javascript.
import { createHighlighter, createJavaScriptRegexEngine, type Highlighter } from 'shiki';

let highlighter: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;
let highlighterFailed = false;
let installed = false;

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message ?? err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Shared shiki highlighter — used by Monaco (editor) and the chat code block
 * so syntax colors are guaranteed identical across both surfaces.
 *
 * Failure handling: if init throws once, we set highlighterFailed and refuse
 * to retry. Callers get a rejected promise immediately and fall back to plain
 * text instead of spamming the console with hundreds of identical errors.
 */
export function getSharedHighlighter(): Promise<Highlighter> {
  if (highlighter) return Promise.resolve(highlighter);
  if (highlighterFailed) return Promise.reject(new Error('shiki highlighter previously failed'));
  if (highlighterPromise) return highlighterPromise;
  highlighterPromise = (async () => {
    const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        // Re-throw with the label so the final catch reports WHICH step
        // failed — shiki's empty-error problem made the previous version
        // useless for debugging.
        const wrapped = new Error(`[shiki:${label}] ${formatErr(err)}`);
        if (err instanceof Error && err.stack) wrapped.stack = err.stack;
        throw wrapped;
      }
    };
    try {
      const mermaidGrammar = await buildStandaloneMermaidGrammar().catch((err) => {
        console.warn('[shiki] mermaid grammar load failed; continuing without it:', formatErr(err));
        return null;
      });
      const jsonLang = await step('load-json', () => import('shiki/dist/langs/json.mjs'));
      const yamlLang = await step('load-yaml', () => import('shiki/dist/langs/yaml.mjs'));
      const mdLang = await step('load-markdown', () => import('shiki/dist/langs/markdown.mjs'));
      const langs: unknown[] = [jsonLang.default, yamlLang.default, mdLang.default];
      if (mermaidGrammar) langs.unshift(mermaidGrammar);
      const hl = await step('createHighlighter', () =>
        createHighlighter({
          // dark-plus / light-plus are the Monaco-shiki bridge's hardcoded
          // themes; the GitHub themes are used by the markdown DocumentPanel
          // so prose code blocks match the broader GitHub look.
          themes: ['dark-plus', 'light-plus', 'github-dark', 'github-light'],
          langs: langs as never,
          // Use the JS-only regex engine so we don't depend on shiki/wasm
          // being resolved correctly at runtime (the wasm path was a
          // source of silent init failures in v4).
          engine: createJavaScriptRegexEngine()
        })
      );
      highlighter = hl;
      return hl;
    } catch (err) {
      // Latch on failure so we don't spam the console retrying every render.
      // Page reload (or the user fixing whatever caused the failure and HMR)
      // will reset the module state.
      highlighterFailed = true;
      highlighterPromise = null;
      console.error('[shiki] highlighter init failed (will not retry):', formatErr(err));
      throw err;
    }
  })();
  return highlighterPromise;
}

/**
 * Lazy-load a shiki language into the shared highlighter so callers can
 * highlight code blocks without forcing every grammar to be bundled at init
 * time. Returns true on success, false when the language isn't bundled or
 * the load failed (caller should fall back to plain text).
 */
const inFlightLangLoads = new Map<string, Promise<boolean>>();
const shikiLanguageLoaders: Record<string, () => Promise<unknown[]>> = {
  bash: async () => (await import('shiki/dist/langs/bash.mjs')).default,
  css: async () => (await import('shiki/dist/langs/css.mjs')).default,
  diff: async () => (await import('shiki/dist/langs/diff.mjs')).default,
  html: async () => (await import('shiki/dist/langs/html.mjs')).default,
  javascript: async () => (await import('shiki/dist/langs/javascript.mjs')).default,
  json: async () => (await import('shiki/dist/langs/json.mjs')).default,
  jsx: async () => (await import('shiki/dist/langs/jsx.mjs')).default,
  markdown: async () => (await import('shiki/dist/langs/markdown.mjs')).default,
  python: async () => (await import('shiki/dist/langs/python.mjs')).default,
  shellscript: async () => (await import('shiki/dist/langs/bash.mjs')).default,
  tsx: async () => (await import('shiki/dist/langs/tsx.mjs')).default,
  typescript: async () => (await import('shiki/dist/langs/typescript.mjs')).default,
  yaml: async () => (await import('shiki/dist/langs/yaml.mjs')).default
};
const shikiLanguageAliases: Record<string, string> = {
  bash: 'shellscript',
  js: 'javascript',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  sh: 'shellscript',
  ts: 'typescript',
  yml: 'yaml'
};

export async function ensureShikiLanguage(lang: string): Promise<boolean> {
  if (!lang) return false;
  const normalizedLang = shikiLanguageAliases[lang] ?? lang;
  const hl = await getSharedHighlighter();
  if (hl.getLoadedLanguages().includes(normalizedLang)) return true;
  const cached = inFlightLangLoads.get(normalizedLang);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const loader = shikiLanguageLoaders[normalizedLang];
      if (!loader) return false;
      const langDefinition = await loader();
      await hl.loadLanguage(langDefinition as never);
      return true;
    } catch (err) {
      console.warn(`[shiki] failed to load language "${normalizedLang}":`, err);
      return false;
    }
  })();
  inFlightLangLoads.set(normalizedLang, promise);
  return promise;
}

// Shiki bundles a `mermaid` grammar that's designed to inject inside markdown
// fenced blocks (its top-level `patterns` only fire after a ```mermaid marker).
// When we use it standalone in Monaco, nothing matches and everything renders
// as plain text. Build a standalone variant by promoting the inner repository
// entries to the top-level patterns.
async function buildStandaloneMermaidGrammar(): Promise<unknown> {
  const arr = (await import('shiki/dist/langs/mermaid.mjs')).default;
  // Deep clone so we don't mutate the cached module.
  const grammar = JSON.parse(JSON.stringify(arr[0])) as {
    patterns: { include: string }[];
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
    grammar.patterns = inner as { include: string }[];
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
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#e5e5e5',
      'editorLineNumber.activeForeground': '#0a0a0a',
      'editorLineNumber.foreground': '#d4d4d4',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#e5e5e5',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#e5e5e5',
      // Match the global app scrollbar (transparent until hover, then ~25%/50% muted-foreground).
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.activeBackground': '#64748bcc',
      'scrollbarSlider.background': '#64748b40',
      'scrollbarSlider.hoverBackground': '#64748b80'
    },
    dark: {
      'editor.background': '#141414',
      'editor.foreground': '#ededed',
      'editor.lineHighlightBackground': '#1c1c1c',
      'editorHoverWidget.background': '#141414',
      'editorHoverWidget.border': '#262626',
      'editorLineNumber.activeForeground': '#ededed',
      'editorLineNumber.foreground': '#3a3a3a',
      'editorSuggestWidget.background': '#141414',
      'editorSuggestWidget.border': '#262626',
      'editorWidget.background': '#141414',
      'editorWidget.border': '#262626',
      'scrollbar.shadow': '#00000000',
      'scrollbarSlider.activeBackground': '#a0a0a0cc',
      'scrollbarSlider.background': '#a0a0a040',
      'scrollbarSlider.hoverBackground': '#a0a0a080'
    }
  };
  patchTheme(monaco, 'light-plus', overrides.light);
  patchTheme(monaco, 'dark-plus', overrides.dark);

  console.log('[shiki] ready. languages:', hl.getLoadedLanguages());
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
  const monacoTheme = textmateThemeToMonacoTheme(tm) as Monaco.editor.IStandaloneThemeData;
  monaco.editor.defineTheme(themeId, {
    ...monacoTheme,
    colors: { ...(monacoTheme.colors ?? {}), ...colors }
  });
}

export function shikiThemeName(mode: 'light' | 'dark'): string {
  return mode === 'dark' ? 'dark-plus' : 'light-plus';
}
