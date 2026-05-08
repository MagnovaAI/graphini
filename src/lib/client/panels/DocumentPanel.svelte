<script lang="ts">
  import { documentMarkdownStore } from '$lib/client/stores/documentStore.svelte';
  import { workspaceStore } from '$lib/client/stores/workspace.svelte';
  import { cn } from '$lib/client/util';
  import { Code2, Eye, FileText } from 'lucide-svelte';
  import { marked } from 'marked';
  import { mode } from 'mode-watcher';
  import * as monaco from 'monaco-editor';
  import monacoEditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
  import { onDestroy, onMount } from 'svelte';

  // Configure marked for safe rendering
  marked.setOptions({ breaks: true, gfm: true });

  let viewMode = $state<'rendered' | 'source'>('rendered');
  let markdownContent = $state('');

  let currentFileId = $state('_default');
  let currentFileName = $state('Untitled');

  // Monaco editor refs
  let editorContainer: HTMLDivElement | undefined = $state();
  let monacoEditor: monaco.editor.IStandaloneCodeEditor | undefined;
  let mdModel: monaco.editor.ITextModel | undefined;
  let currentEditorText = '';
  let resizeObserver: ResizeObserver | undefined;

  // Load markdown for current workspace
  function loadMarkdown() {
    const ws = workspaceStore.workspace;
    if (ws?.document?.documentMarkdown) {
      markdownContent = ws.document.documentMarkdown;
    } else {
      markdownContent = `# ${currentFileName}\n\nWrite your documentation here.\n`;
    }
    // Sync to Monaco if it exists
    if (monacoEditor && markdownContent !== currentEditorText) {
      currentEditorText = markdownContent;
      monacoEditor.setValue(markdownContent);
    }
  }

  // Save markdown via workspace store
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  function saveMarkdown() {
    if (saveTimeout) clearTimeout(saveTimeout);
    const content = markdownContent;
    saveTimeout = setTimeout(() => {
      documentMarkdownStore.set(content);
      workspaceStore.setActiveDiagramDocumentMarkdown(content);
    }, 400);
  }

  // Watch for file changes
  $effect(() => {
    const activeDiagram = workspaceStore.diagrams.find(
      (diagram) => diagram.id === workspaceStore.activeDiagramId
    );
    const newId =
      workspaceStore.workspace?.id && workspaceStore.activeDiagramId
        ? `${workspaceStore.workspace.id}:${workspaceStore.activeDiagramId}`
        : workspaceStore.workspace?.id || '_default';
    const newName = activeDiagram?.title || workspaceStore.workspace?.title || 'Untitled';
    if (newId !== currentFileId) {
      currentFileId = newId;
      currentFileName = newName;
      loadMarkdown();
    }
  });

  onDestroy(() => {
    if (saveTimeout) clearTimeout(saveTimeout);
    resizeObserver?.disconnect();
    try {
      mdModel?.dispose();
    } catch {}
    try {
      monacoEditor?.dispose();
    } catch {}
  });

  // React to external markdown updates (from chat markdownWrite tool)
  let ignoreExternalUpdate = false;
  $effect(() => {
    const externalMd = documentMarkdownStore.value;
    if (ignoreExternalUpdate) return;
    if (externalMd && externalMd !== markdownContent) {
      markdownContent = externalMd;
      workspaceStore.setActiveDiagramDocumentMarkdown(externalMd);
      // Sync to Monaco
      if (monacoEditor && markdownContent !== currentEditorText) {
        currentEditorText = markdownContent;
        monacoEditor.setValue(markdownContent);
      }
    }
  });

  // Initial load handled in onMount to avoid state_referenced_locally
  // (markdownContent is $state and must be referenced inside closures)

  // Initialize Monaco editor for markdown
  function initMonacoEditor() {
    if (!editorContainer || monacoEditor) return;

    self.MonacoEnvironment = {
      getWorker() {
        return new monacoEditorWorker();
      }
    };

    mdModel = monaco.editor.createModel(markdownContent, 'markdown');

    monacoEditor = monaco.editor.create(editorContainer, {
      model: mdModel,
      minimap: { enabled: false },
      overviewRulerLanes: 0,
      fontSize: 12,
      lineHeight: 20,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
      padding: { top: 16, bottom: 16 },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none' as const,
      lineNumbers: 'off' as const,
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 16,
      lineNumbersMinChars: 0,
      wordWrap: 'on' as const,
      wrappingIndent: 'same' as const,
      cursorBlinking: 'smooth' as const,
      cursorSmoothCaretAnimation: 'on' as const,
      smoothScrolling: true,
      bracketPairColorization: { enabled: false },
      guides: { indentation: false, bracketPairs: false },
      codeLens: false,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      scrollbar: {
        vertical: 'auto' as const,
        horizontal: 'hidden' as const,
        useShadows: false
      }
    });

    currentEditorText = markdownContent;

    monacoEditor.onDidChangeModelContent(({ isFlush }) => {
      const newText = monacoEditor?.getValue();
      if (!newText || currentEditorText === newText || isFlush) return;
      currentEditorText = newText;
      markdownContent = newText;
      saveMarkdown();
    });

    // Theme sync - use the same mermaid theme as the code editor to avoid global theme leak
    let currentMode: string | undefined;
    const unsub = mode.subscribe((m) => (currentMode = m));
    unsub();
    if (currentMode) {
      monaco.editor.setTheme(`mermaid${currentMode === 'dark' ? '-dark' : ''}`);
    }

    resizeObserver = new ResizeObserver((entries) => {
      monacoEditor?.layout({
        height: entries[0].contentRect.height,
        width: entries[0].contentRect.width
      });
    });
    resizeObserver.observe(editorContainer);
  }

  onMount(() => {
    // Run initial load: sync from localStorage first, then try DB
    loadMarkdown();
    ignoreExternalUpdate = true;
    documentMarkdownStore.set(markdownContent);
    ignoreExternalUpdate = false;
    // Document content is loaded from workspace store (no separate DB fetch needed)

    // Theme subscription - use mermaid theme to avoid leaking to code editor
    const unsubMode = mode.subscribe((m) => {
      if (monacoEditor) {
        monaco.editor.setTheme(`mermaid${m === 'dark' ? '-dark' : ''}`);
      }
    });

    return () => {
      unsubMode();
    };
  });

  // Initialize Monaco when switching to source view
  $effect(() => {
    if (viewMode === 'source' && editorContainer && !monacoEditor) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => initMonacoEditor());
    }
    // Sync content when switching to source
    if (viewMode === 'source' && monacoEditor && markdownContent !== currentEditorText) {
      currentEditorText = markdownContent;
      monacoEditor.setValue(markdownContent);
    }
  });

  // ── Markdown Renderer (using marked library) ──
  function renderMarkdown(md: string): string {
    if (!md.trim())
      return '<p class="text-[13px] text-muted-foreground italic">No content yet. Switch to Source to start writing.</p>';
    try {
      return marked.parse(md) as string;
    } catch {
      return `<p class="text-[13px] text-foreground/75">${md}</p>`;
    }
  }

  let renderedHtml = $derived.by(() => renderMarkdown(markdownContent));
</script>

<div class="flex h-full flex-col bg-card">
  <!-- Header -->
  <div class="flex h-10 items-center justify-between border-b border-border/30 px-3">
    <div class="flex items-center gap-2">
      <FileText class="size-4 text-muted-foreground" />
      <span class="text-[13px] font-semibold text-foreground">Document</span>
      <span class="rounded bg-muted/50 px-2 py-1 text-[13px] text-muted-foreground">.md</span>
    </div>
    <!-- View mode toggle -->
    <div class="flex items-center rounded-md border border-border/30 bg-muted/20 p-1">
      <button
        type="button"
        class={cn(
          'flex items-center gap-1 rounded-sm px-2 py-1 text-[13px] font-medium transition-all',
          viewMode === 'rendered'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
        onclick={() => (viewMode = 'rendered')}>
        <Eye class="size-3" />
        Preview
      </button>
      <button
        type="button"
        class={cn(
          'flex items-center gap-1 rounded-sm px-2 py-1 text-[13px] font-medium transition-all',
          viewMode === 'source'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
        onclick={() => (viewMode = 'source')}>
        <Code2 class="size-3" />
        Source
      </button>
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-hidden">
    {#if viewMode === 'rendered'}
      <div class="scrollbar-thin h-full overflow-y-auto px-8 py-6">
        <article class="doc-prose mx-auto max-w-none">
          {@html renderedHtml}
        </article>
      </div>
    {:else}
      <div class="h-full w-full overflow-hidden">
        <div bind:this={editorContainer} class="h-full w-full"></div>
      </div>
    {/if}
  </div>
</div>

<style>
  :global(.doc-prose) {
    color: hsl(var(--foreground) / 0.8);
    font-size: 0.8125rem;
    line-height: 1.7;
  }
  :global(.doc-prose h1) {
    font-size: 1.125rem;
    font-weight: 700;
    color: hsl(var(--foreground));
    margin-bottom: 0.75rem;
  }
  :global(.doc-prose h2) {
    font-size: 0.9375rem;
    font-weight: 700;
    color: hsl(var(--foreground));
    margin-top: 1.5rem;
    margin-bottom: 0.5rem;
    padding-bottom: 0.375rem;
    border-bottom: 1px solid hsl(var(--border) / 0.2);
  }
  :global(.doc-prose h3) {
    font-size: 0.8125rem;
    font-weight: 600;
    color: hsl(var(--foreground));
    margin-top: 1.25rem;
    margin-bottom: 0.375rem;
  }
  :global(.doc-prose h4) {
    font-size: 0.75rem;
    font-weight: 600;
    color: hsl(var(--foreground));
    margin-top: 1rem;
    margin-bottom: 0.25rem;
  }
  :global(.doc-prose p) {
    margin: 0.375rem 0;
  }
  :global(.doc-prose ul, .doc-prose ol) {
    margin: 0.5rem 0;
    padding-left: 1.25rem;
  }
  :global(.doc-prose ul) {
    list-style-type: disc;
  }
  :global(.doc-prose ol) {
    list-style-type: decimal;
  }
  :global(.doc-prose li) {
    margin: 0.125rem 0;
  }
  :global(.doc-prose code) {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Consolas, monospace;
    font-size: 0.6875rem;
    background: hsl(var(--muted) / 0.7);
    border: 1px solid hsl(var(--border) / 0.2);
    border-radius: 0.375rem;
    padding: 0.125rem 0.375rem;
  }
  :global(.doc-prose pre) {
    background: hsl(var(--muted) / 0.6);
    border: 1px solid hsl(var(--border) / 0.2);
    border-radius: 0.5rem;
    padding: 0.875rem;
    overflow-x: auto;
    margin: 0.75rem 0;
  }
  :global(.doc-prose pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.6875rem;
    line-height: 1.6;
    white-space: pre;
  }
  :global(.doc-prose blockquote) {
    border-left: 2px solid hsl(var(--primary) / 0.4);
    padding-left: 0.75rem;
    margin: 0.5rem 0;
    font-style: italic;
    color: hsl(var(--foreground) / 0.6);
  }
  :global(.doc-prose a) {
    color: hsl(var(--primary));
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  :global(.doc-prose hr) {
    border-color: hsl(var(--border) / 0.3);
    margin: 1rem 0;
  }
  :global(.doc-prose img) {
    max-width: 100%;
    border-radius: 0.5rem;
    border: 1px solid hsl(var(--border) / 0.2);
    margin: 0.5rem 0;
  }
  :global(.doc-prose table) {
    width: 100%;
    border-collapse: collapse;
    margin: 0.75rem 0;
    font-size: 0.75rem;
  }
  :global(.doc-prose th, .doc-prose td) {
    border: 1px solid hsl(var(--border) / 0.3);
    padding: 0.375rem 0.625rem;
    text-align: left;
  }
  :global(.doc-prose th) {
    background: hsl(var(--muted) / 0.5);
    font-weight: 600;
  }
  :global(.doc-prose strong) {
    font-weight: 600;
    color: hsl(var(--foreground));
  }
  :global(.doc-prose del) {
    text-decoration: line-through;
    color: hsl(var(--muted-foreground));
  }
</style>
