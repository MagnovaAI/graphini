<script lang="ts">
  import type { EditorProps } from '$lib/client/types';
  import { stateStore } from '$lib/client/util/state/state';
  import { kv } from '$lib/client/stores/kvStore.svelte';
  import { initEditor } from '$lib/client/util/editor/monacoExtra';
  import { setupShiki, shikiThemeName } from '$lib/client/util/editor/shikiSetup';
  import { parse as mermaidParse } from '$lib/client/features/diagram/mermaid';
  import { mode } from 'mode-watcher';
  import * as monaco from 'monaco-editor';
  import monacoEditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
  import monacoJsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';

  let {
    onUpdate,
    language = 'mermaid'
  }: EditorProps & { language?: 'mermaid' | 'json' | 'yaml' | 'markdown' } = $props();

  let divElement: HTMLDivElement | undefined = $state();
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let validationTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastValidatedCode = '';
  let lastValidationResult: { valid: boolean; error?: string } | null = null;

  // Validation trigger function with caching - immediate for errors
  async function triggerValidation(code: string, immediate = false) {
    // Clear existing timeout
    if (validationTimeout) {
      clearTimeout(validationTimeout);
    }

    // Immediate validation for error detection
    if (immediate) {
      await performValidation(code);
      return;
    }

    // Debounce validation to avoid excessive calls
    validationTimeout = setTimeout(() => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => performValidation(code), { timeout: 500 });
      } else {
        performValidation(code);
      }
    }, 400);
  }

  async function performValidation(code: string) {
    if (language !== 'mermaid') {
      kv.set('editor', 'editorValidationError', null);
      return;
    }

    if (!code || code.trim().length < 5) {
      lastValidatedCode = code;
      lastValidationResult = null;
      kv.set('editor', 'editorValidationError', null);
      return;
    }

    // Check if we already validated this exact code
    if (lastValidatedCode === code && lastValidationResult) {
      if (!lastValidationResult.valid && lastValidationResult.error) {
        kv.set('editor', 'editorValidationError', lastValidationResult.error);
      } else {
        kv.set('editor', 'editorValidationError', null);
      }
      return;
    }

    // Fast validation - only check critical syntax errors
    try {
      // Quick syntax check without full parsing
      const lines = code.split('\n');
      let hasError = false;
      let errorMessage = '';

      // Check for basic syntax errors
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('%%')) continue;

        // Check for unclosed brackets
        const openBrackets = (line.match(/[[({}]/g) || []).length;
        const closeBrackets = (line.match(/[\])}]/g) || []).length;
        if (openBrackets !== closeBrackets) {
          hasError = true;
          errorMessage = `Unclosed bracket on line ${i + 1}`;
          break;
        }

        // Check for unclosed quotes
        const quotes = (line.match(/"/g) || []).length;
        if (quotes % 2 !== 0) {
          hasError = true;
          errorMessage = `Unclosed quote on line ${i + 1}`;
          break;
        }
      }

      if (!hasError) {
        // Only do full mermaid parse if basic checks pass.
        // mermaidParse() applies the same enhancedCode transform and registers
        // icon packs/layout loaders the renderer uses, so editor validation
        // matches what the canvas will accept.
        await mermaidParse(code);
        lastValidatedCode = code;
        lastValidationResult = { valid: true };
        kv.set('editor', 'editorValidationError', null);
      } else {
        lastValidatedCode = code;
        lastValidationResult = { valid: false, error: errorMessage };
        kv.set('editor', 'editorValidationError', errorMessage);
      }
    } catch (e: unknown) {
      lastValidatedCode = code;
      const errMsg = e instanceof Error ? e.message : 'Invalid diagram syntax';
      lastValidationResult = { valid: false, error: errMsg };
      kv.set('editor', 'editorValidationError', errMsg);
    }
  }
  // Threshold above which we skip the heavy semantic layer (IntelliSense,
  // word-based suggestions, JSON schema validation). VSCode uses a similar
  // cutoff at editor.largeFileOptimizations.
  const LARGE_FILE_BYTES = 2 * 1024 * 1024;

  // Phase 0: bare-minimum options used to open the editor instantly.
  // Just text rendering, scrolling, line numbers, syntax highlighting.
  // Everything else is layered in progressively via requestIdleCallback —
  // see scheduleProgressiveEnhancement() below.
  const initialEditorOptions = {
    acceptSuggestionOnEnter: 'on' as const,
    bracketPairColorization: { enabled: false },
    codeLens: false,
    cursorBlinking: 'solid' as const,
    cursorSmoothCaretAnimation: 'off' as const,
    folding: false,
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: 12,
    glyphMargin: false,
    guides: { indentation: false, bracketPairs: false },
    hover: { enabled: false, delay: 200 },
    lineDecorationsWidth: 0,
    lineHeight: 16,
    lineNumbers: 'on' as const,
    lineNumbersMinChars: 3,
    minimap: { enabled: false },
    occurrencesHighlight: 'off' as const,
    overviewRulerLanes: 0,
    padding: { top: 16, bottom: 16 },
    quickSuggestions: false,
    renderLineHighlight: 'none' as const,
    scrollBeyondLastLine: false,
    scrollbar: {
      horizontal: 'auto' as const,
      horizontalHasArrows: false,
      horizontalScrollbarSize: 4,
      horizontalSliderSize: 4,
      useShadows: false,
      vertical: 'auto' as const,
      verticalHasArrows: false,
      verticalScrollbarSize: 4,
      verticalSliderSize: 4
    },
    selectionHighlight: false,
    smoothScrolling: false,
    suggestOnTriggerCharacters: false,
    tabCompletion: 'on' as const,
    wordBasedSuggestions: 'off' as const
  };
  let currentText = '';
  let enhancementHandles: number[] = [];
  let updateTimeout: number | undefined;
  let lastLineNumberWidth = 0;

  /**
   * Resize the gutter to fit the largest visible line number. Monaco only
   * sets `lineNumbersMinChars` once at construction, so the gutter crops
   * "100000" when a multi-MB file lands. Cap at 7 (10M lines is plenty).
   * Only updates when the digit count actually changes, to avoid layout
   * thrash on every keystroke.
   */
  function syncLineNumberWidth(text: string) {
    if (!editor) return;
    let lines = 1;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
    const digits = Math.max(3, Math.min(7, String(lines).length));
    if (digits === lastLineNumberWidth) return;
    lastLineNumberWidth = digits;
    editor.updateOptions({ lineNumbersMinChars: digits });
  }

  // requestIdleCallback fallback for Safari (still missing as of writing).
  const idle = (cb: () => void, timeout = 2000): number => {
    if (typeof self.requestIdleCallback === 'function') {
      return self.requestIdleCallback(cb, { timeout });
    }
    return self.setTimeout(cb, 16) as unknown as number;
  };

  const cancelIdle = (handle: number) => {
    if (typeof self.cancelIdleCallback === 'function') {
      self.cancelIdleCallback(handle);
    } else {
      self.clearTimeout(handle);
    }
  };

  /**
   * Schedule feature layers in waves: light → medium → heavy. Each layer
   * waits for the previous to complete (and the browser to idle) before
   * upgrading editor options. Files larger than LARGE_FILE_BYTES skip the
   * heavy layer entirely.
   */
  function scheduleProgressiveEnhancement() {
    if (!editor) return;

    // Phase 1 — light visual polish (~50ms idle). Re-checks file size at
    // fire time, not schedule time, so a file that grows past the cutoff
    // between scheduling and firing still gets the right gating.
    enhancementHandles.push(
      idle(() => {
        editor?.updateOptions({
          bracketPairColorization: { enabled: true },
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          guides: { indentation: true, bracketPairs: true },
          renderLineHighlight: 'gutter',
          smoothScrolling: true
        });

        // Phase 2 — folding + selection highlights (~500ms idle).
        enhancementHandles.push(
          idle(() => {
            const isLargeNow = currentText.length > LARGE_FILE_BYTES;
            editor?.updateOptions({
              folding: !isLargeNow,
              selectionHighlight: !isLargeNow,
              occurrencesHighlight: isLargeNow ? 'off' : 'singleFile',
              hover: { enabled: !isLargeNow, delay: 200 }
            });

            // Phase 3 — IntelliSense + schema validation. Skip when the
            // current file is large; the JSON worker stalls on multi-MB
            // validation and the hover error widget overflows the screen.
            if (isLargeNow) return;
            enhancementHandles.push(
              idle(() => {
                if (currentText.length > LARGE_FILE_BYTES) return;
                editor?.updateOptions({
                  quickSuggestions: { other: true, comments: false, strings: false },
                  suggestOnTriggerCharacters: true,
                  wordBasedSuggestions: 'allDocuments'
                });
                monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                  validate: true,
                  enableSchemaRequest: true,
                  schemas: [
                    {
                      fileMatch: ['config.json'],
                      uri: 'https://mermaid.js.org/schemas/config.schema.json'
                    }
                  ]
                });
              }, 2500)
            );
          }, 1000)
        );
      }, 500)
    );
  }

  self.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === 'json') {
        return new monacoJsonWorker();
      }
      return new monacoEditorWorker();
    }
  };

  const jsonUri = monaco.Uri.parse('internal://config.json');
  const jsonDiagramUri = monaco.Uri.parse('internal://diagram.json');
  const mermaidUri = monaco.Uri.parse('internal://mermaid.mmd');
  const markdownUri = monaco.Uri.parse('internal://document.md');
  const yamlUri = monaco.Uri.parse('internal://diagram.yaml');
  const jsonModel =
    monaco.editor.getModel(jsonUri) ?? monaco.editor.createModel('', 'json', jsonUri);
  const jsonDiagramModel =
    monaco.editor.getModel(jsonDiagramUri) ?? monaco.editor.createModel('', 'json', jsonDiagramUri);
  const mermaidModel =
    monaco.editor.getModel(mermaidUri) ?? monaco.editor.createModel('', 'mermaid', mermaidUri);
  const markdownModel =
    monaco.editor.getModel(markdownUri) ?? monaco.editor.createModel('', 'markdown', markdownUri);
  const yamlModel =
    monaco.editor.getModel(yamlUri) ?? monaco.editor.createModel('', 'yaml', yamlUri);

  function getCodeModel(editorMode: string) {
    if (editorMode !== 'code') return jsonModel;
    if (language === 'json') return jsonDiagramModel;
    if (language === 'markdown') return markdownModel;
    if (language === 'yaml') return yamlModel;
    return mermaidModel;
  }

  onMount(() => {
    if (!divElement) {
      throw new Error('divEl is undefined');
    }

    // Start with JSON validation OFF; the progressive-enhancement pass
    // re-enables it once the editor has settled (and only for small files).
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: false, schemas: [] });

    initEditor(monaco);
    editor = monaco.editor.create(divElement, initialEditorOptions);

    // Boot shiki + VS Code Dark+/Light+ themes for real mermaid highlighting.
    // Async — kicks off in the background; theme is applied here once ready.
    setupShiki(monaco)
      .then(() => {
        const currentMode = get(mode);
        const themeName = shikiThemeName(currentMode === 'dark' ? 'dark' : 'light');
        monaco.editor.setTheme(themeName);
        if (editor) {
          const m = editor.getModel();
          console.log('[shiki] model language:', m?.getLanguageId(), '| theme set to:', themeName);
          if (m) {
            const lang = m.getLanguageId();
            // Force tokenization refresh
            monaco.editor.setModelLanguage(m, 'plaintext');
            monaco.editor.setModelLanguage(m, lang);
          }
        }
      })
      .catch((err) => console.error('shiki init failed', err));

    // Initialize editor with current state immediately
    const currentState = get(stateStore);
    const model = getCodeModel(currentState.editorMode);
    editor.setModel(model);

    const initialText =
      currentState.editorMode === 'code' ? currentState.code : currentState.mermaid;
    editor.setValue(initialText);
    currentText = initialText;
    syncLineNumberWidth(initialText);

    // Kick off progressive enhancement once the bare editor is on-screen.
    // Bare options open instantly even on a 5MB file; phases 1-3 layer in
    // bracket colors, folding, IntelliSense over the next ~2.5s of idle.
    scheduleProgressiveEnhancement();

    editor.onDidChangeModelContent(({ isFlush }) => {
      const newText = editor?.getValue();
      if (!newText || currentText === newText || isFlush) {
        return;
      }
      const wasLarge = currentText.length > LARGE_FILE_BYTES;
      const isLarge = newText.length > LARGE_FILE_BYTES;
      currentText = newText;
      syncLineNumberWidth(newText);

      // Crossing into large: rip out validation + heavy options immediately
      // so the JSON worker doesn't choke and the hover error widget can't
      // render over the editor surface. Also clear any markers the worker
      // already stamped — disabling validation doesn't sweep stale ones.
      if (!wasLarge && isLarge) {
        monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
          validate: false,
          schemas: []
        });
        const m = editor?.getModel();
        if (m) {
          monaco.editor.setModelMarkers(m, 'json', []);
          monaco.editor.setModelMarkers(m, 'mermaid', []);
        }
        editor?.updateOptions({
          folding: false,
          hover: { enabled: false, delay: 200 },
          occurrencesHighlight: 'off',
          quickSuggestions: false,
          selectionHighlight: false,
          suggestOnTriggerCharacters: false,
          wordBasedSuggestions: 'off'
        });
      }

      // For large files, debounce the downstream sync — every keystroke or
      // big paste otherwise pushes 5MB through the store, the tree view's
      // JSON parse, and the chat panel re-render.
      if (isLarge) {
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = self.setTimeout(() => onUpdate(newText), 400) as unknown as number;
      } else {
        onUpdate(newText);
      }

      // Skip the potential-error regex on huge documents — it's a
      // catastrophic-backtracking risk and the validator only runs for
      // mermaid files anyway, which are never multi-MB.
      if (language !== 'mermaid' || isLarge) {
        return;
      }
      const hasPotentialError = /[^\]]*\[[^\]]*$|[^)]*\([^)]*$|[^}]*\{[^}]*$|"[^"]*$/.test(newText);
      triggerValidation(newText, hasPotentialError);
    });

    const unsubscribeState = stateStore.subscribe(({ errorMarkers, editorMode, code, mermaid }) => {
      if (!editor) {
        return;
      }

      const model = getCodeModel(editorMode);

      if (editor.getModel()?.id !== model.id) {
        editor.setModel(model);
      }

      // Update editor text if it's different or if this is the first load
      const newText = (editorMode === 'code' ? code : mermaid) || '';

      // Always update on first load or if text is different.
      // Skip when the editor is focused — the user is typing and the store
      // is just echoing our own onUpdate; calling setValue() here would
      // collapse the undo stack and reset scroll/cursor to the top.
      const editorHasFocus = editor.hasTextFocus();
      if (currentText === '' || (newText !== currentText && !editorHasFocus)) {
        try {
          editor.setValue(newText);
          editor.setScrollTop(0);
        } catch {
          // Guard against "Illegal value for lineNumber" when editor is in transitional state
        }
        const wasLarge = currentText.length > LARGE_FILE_BYTES;
        currentText = newText;
        const isLarge = newText.length > LARGE_FILE_BYTES;
        syncLineNumberWidth(newText);

        // File swap crossed the large-file threshold — re-run progressive
        // enhancement from Phase 0 so the heavy semantic layer is gated
        // on the new size. (Small→large drops IntelliSense; large→small
        // restores it.)
        if (wasLarge !== isLarge) {
          for (const handle of enhancementHandles) cancelIdle(handle);
          enhancementHandles = [];
          editor.updateOptions(initialEditorOptions);
          // Clear any pre-existing diagnostic markers — the previous file's
          // validator state can leak across the swap, producing phantom
          // squiggles on a perfectly valid new document.
          monaco.editor.setModelMarkers(model, 'json', []);
          monaco.editor.setModelMarkers(model, 'mermaid', []);
          if (isLarge) {
            monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
              validate: false,
              schemas: []
            });
          }
          scheduleProgressiveEnhancement();
        }

        // Trigger validation when switching to code mode
        if (editorMode === 'code' && language === 'mermaid') {
          triggerValidation(newText);
        }
      } else if (newText !== currentText && editorHasFocus) {
        // User is typing; just keep our local mirror in sync without
        // disturbing the editor view (the onDidChangeModelContent handler
        // already triggered validation for this text).
        currentText = newText;
      }

      // Mermaid validation markers only belong on the mermaid model. Stamping
      // them on the JSON/YAML/MD model causes phantom squiggles when the user
      // switches files (the mermaid validator leaves stale errors behind, and
      // owner='mermaid' on a JSON model never gets cleared otherwise).
      if (model === mermaidModel) {
        monaco.editor.setModelMarkers(model, 'mermaid', errorMarkers);
      } else {
        monaco.editor.setModelMarkers(model, 'mermaid', []);
      }
    });

    const unsubscribeMode = mode.subscribe((mode) => {
      if (editor) {
        monaco.editor.setTheme(shikiThemeName(mode === 'dark' ? 'dark' : 'light'));
      }
    });
    const resizeObserver = new ResizeObserver((entries) => {
      editor?.layout({
        height: entries[0].contentRect.height,
        width: entries[0].contentRect.width
      });
    });

    if (divElement.parentElement) {
      resizeObserver.observe(divElement);
    }

    // Suppress Monaco's internal "Canceled" promise rejections that fire after dispose
    const handleUnhandledRejection = (e: PromiseRejectionEvent) => {
      if (
        e.reason?.message === 'Canceled' ||
        e.reason?.name === 'Canceled' ||
        (typeof e.reason === 'string' && e.reason === 'Canceled')
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      if (validationTimeout) clearTimeout(validationTimeout);
      if (updateTimeout) clearTimeout(updateTimeout);
      // Cancel any pending feature-upgrade callbacks so we don't call
      // updateOptions() on a disposed editor.
      for (const handle of enhancementHandles) cancelIdle(handle);
      enhancementHandles = [];
      unsubscribeState();
      unsubscribeMode();
      resizeObserver.disconnect();
      try {
        jsonModel.dispose();
      } catch {
        // ignore disposal errors
      }
      try {
        jsonDiagramModel.dispose();
      } catch {
        // ignore disposal errors
      }
      try {
        mermaidModel.dispose();
      } catch {
        // ignore disposal errors
      }
      try {
        markdownModel.dispose();
      } catch {
        // Model may already be disposed by Monaco during HMR.
      }
      try {
        yamlModel.dispose();
      } catch {
        // ignore disposal errors
      }
      try {
        editor?.dispose();
      } catch {
        // ignore disposal errors
      }
      // Remove handler after a delay to catch any lingering rejections
      setTimeout(() => {
        window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      }, 1000);
    };
  });
</script>

<div class="relative h-full flex-1 overflow-hidden bg-background">
  <div bind:this={divElement} id="editor" class="h-full flex-1 overflow-hidden"></div>
</div>
