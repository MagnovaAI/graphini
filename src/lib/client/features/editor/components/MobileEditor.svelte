<script lang="ts">
  import type { EditorProps } from '$lib/client/types';
  import { stateStore } from '$lib/client/util/state/state';
  import { json, jsonLanguage } from '@codemirror/lang-json';
  import { markdown } from '@codemirror/lang-markdown';
  import { yamlFrontmatter } from '@codemirror/lang-yaml';
  import { language } from '@codemirror/language';
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView, lineNumbers } from '@codemirror/view';
  import { vsCodeDark } from '@fsegurai/codemirror-theme-vscode-dark';
  import { vsCodeLight } from '@fsegurai/codemirror-theme-vscode-light';
  import { basicSetup } from 'codemirror';
  import { mode } from 'mode-watcher';
  import { onMount } from 'svelte';

  let editorView: EditorView | undefined;
  let editorContainer: HTMLDivElement;
  let currentText = $state('');

  const { onUpdate }: EditorProps = $props();

  onMount(() => {
    const themeCompartment = new Compartment();
    const languageCompartment = new Compartment();

    editorView = new EditorView({
      state: EditorState.create({
        doc: currentText,
        extensions: [
          basicSetup,
          lineNumbers(),
          languageCompartment.of([]),
          themeCompartment.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              const newText = update.state.doc.toString();
              if (currentText === newText) {
                return;
              }
              currentText = newText;
              onUpdate(newText);
            }
          }),
          EditorView.theme({
            '&.cm-content': {
              padding: '0 8px'
            },
            '&.cm-editor': {
              height: '100%',
              fontSize: '12px',
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace'
            },
            '&.cm-focused': {
              outline: 'none'
            },
            '&.cm-line': {
              lineHeight: '16px'
            },
            '&.cm-scroller': {
              overflow: 'auto',
              padding: '8px 0'
            }
          })
        ]
      }),
      parent: editorContainer
    });

    const unsubscribeMode = mode.subscribe((mode) => {
      editorView?.dispatch({
        effects: themeCompartment.reconfigure(mode === 'dark' ? vsCodeDark : vsCodeLight)
      });
    });

    const unsubscribeState = stateStore.subscribe(({ editorMode, code, mermaid }) => {
      const text = editorMode === 'code' ? code : mermaid;
      if (currentText === text || !editorView) {
        return;
      }
      currentText = text;
      editorView.dispatch({
        changes: {
          from: 0,
          to: editorView.state.doc.length,
          insert: text
        }
      });
      const stateLanguage = editorView.state.facet(language);
      const isStateJson = stateLanguage === jsonLanguage;
      const isCodeJson = editorMode === 'config';
      if (stateLanguage && isStateJson === isCodeJson) {
        return;
      }
      editorView.dispatch({
        effects: languageCompartment.reconfigure(
          isCodeJson ? json() : yamlFrontmatter({ content: markdown() })
        )
      });
    });

    return () => {
      unsubscribeMode();
      unsubscribeState();
      editorView?.destroy();
    };
  });
</script>

<div bind:this={editorContainer} class="size-full"></div>
