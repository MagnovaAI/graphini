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
  let editorOptions = {
    acceptSuggestionOnEnter: 'on' as const,
    bracketPairColorization: {
      enabled: true
    },
    codeLens: false,
    // Modern appearance
    cursorBlinking: 'smooth' as const,
    cursorSmoothCaretAnimation: 'on' as const,
    folding: true,
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: 12,
    glyphMargin: false,
    guides: {
      indentation: true,
      bracketPairs: true
    },
    // Enhanced error display
    hover: {
      enabled: true,
      delay: 200
    },
    lineDecorationsWidth: 0,
    lineHeight: 16,
    lineNumbers: 'on' as const,
    lineNumbersMinChars: 3,
    minimap: {
      enabled: false
    },
    occurrencesHighlight: 'singleFile' as const,
    overviewRulerLanes: 0,
    padding: { top: 16, bottom: 16 },
    // Enhanced validation indicators
    quickSuggestions: {
      other: true,
      comments: false,
      strings: false
    },
    renderLineHighlight: 'gutter' as const,
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
    // Better selection and highlighting
    selectionHighlight: true,
    smoothScrolling: true,
    suggestOnTriggerCharacters: true,
    tabCompletion: 'on' as const,
    wordBasedSuggestions: 'allDocuments' as const
  };
  let currentText = '';

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

    initEditor(monaco);
    editor = monaco.editor.create(divElement, editorOptions);

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

    editor.onDidChangeModelContent(({ isFlush }) => {
      const newText = editor?.getValue();
      if (!newText || currentText === newText || isFlush) {
        return;
      }
      currentText = newText;
      onUpdate(newText);

      // Immediate validation for potential errors (check for common error patterns)
      const hasPotentialError = /[^\]]*\[[^\]]*$|[^)]*\([^)]*$|[^}]*\{[^}]*$|"[^"]*$/.test(newText);

      // Trigger immediate validation if potential error detected, otherwise use debounce
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
        currentText = newText;

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

      // Display/clear errors
      monaco.editor.setModelMarkers(model, 'mermaid', errorMarkers);
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
