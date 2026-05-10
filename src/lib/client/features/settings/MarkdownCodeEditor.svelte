<script lang="ts">
  import { markdown } from '@codemirror/lang-markdown';
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView, placeholder as editorPlaceholder } from '@codemirror/view';
  import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark';
  import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light';
  import { basicSetup } from 'codemirror';
  import { mode } from 'mode-watcher';
  import { onMount } from 'svelte';

  interface Props {
    class?: string;
    minHeight?: string;
    placeholder?: string;
    value: string;
    onValueChange?: (value: string) => void;
  }

  let {
    class: className = '',
    minHeight = '180px',
    placeholder = '',
    value = $bindable(''),
    onValueChange
  }: Props = $props();

  let editorContainer: HTMLDivElement;
  let editorView: EditorView | undefined;
  let currentValue = '';

  function syncEditorValue(nextValue: string): void {
    if (!editorView || currentValue === nextValue) return;
    currentValue = nextValue;
    editorView.dispatch({
      changes: {
        from: 0,
        insert: nextValue,
        to: editorView.state.doc.length
      }
    });
  }

  $effect(() => {
    syncEditorValue(value);
  });

  onMount(() => {
    const themeCompartment = new Compartment();
    currentValue = value;

    editorView = new EditorView({
      parent: editorContainer,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          themeCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const nextValue = update.state.doc.toString();
            if (currentValue === nextValue) return;
            currentValue = nextValue;
            value = nextValue;
            onValueChange?.(nextValue);
          }),
          EditorView.theme({
            '&': {
              height: '100%',
              minHeight,
              width: '100%'
            },
            '&.cm-focused': {
              outline: 'none'
            },
            '.cm-content': {
              minHeight,
              padding: '12px'
            },
            '.cm-gutters': {
              display: 'none'
            },
            '.cm-line': {
              lineHeight: '18px',
              padding: '0'
            },
            '.cm-placeholder': {
              color: 'hsl(var(--muted-foreground))'
            },
            '.cm-scroller': {
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
              fontSize: '12px',
              minHeight,
              overflow: 'auto'
            }
          }),
          placeholder ? editorPlaceholder(placeholder) : []
        ]
      })
    });

    const unsubscribeMode = mode.subscribe((mode) => {
      editorView?.dispatch({
        effects: themeCompartment.reconfigure(mode === 'dark' ? vsCodeDark : vsCodeLight)
      });
    });

    return () => {
      unsubscribeMode();
      editorView?.destroy();
    };
  });
</script>

<div
  bind:this={editorContainer}
  class={`h-full overflow-hidden rounded-md border border-border bg-background ${className}`}
  style:min-height={minHeight}>
</div>
