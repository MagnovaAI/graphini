import type { ErrorHash, MarkerData, State, ValidatedState } from '$/types';
import { parse } from '$lib/features/diagram/mermaid';
import type { MermaidConfig } from 'mermaid';
import { derived, get, writable, type Readable } from 'svelte/store';
import {
  extractErrorLineText,
  findMostRelevantLineNumber,
  replaceLineNumberInErrorMessage
} from '../error/errorHandling';
import { localStorage, persist } from './persist';
import { deserializeState, serializeState } from '../serialization/serde';
// Inlined to break circular dependency: state.ts → util.ts → url.ts → state.ts
const formatJSON = (data: unknown): string => JSON.stringify(data, undefined, 2);
let _debugCount = 0;
const errorDebug = (limit = 1000) => {
  _debugCount += 1;
  if (_debugCount > limit) {
    console.log(_debugCount, limit);
    // eslint-disable-next-line no-debugger
    debugger;
  }
};

export const defaultState: State = {
  code: '',
  editorMode: 'code',
  grid: true,
  mermaid: formatJSON({
    theme: 'default',
    layout: 'elk',
    flowchart: { defaultRenderer: 'elk' }
  }),
  panZoom: true,
  rough: false,
  updateDiagram: true
};

const urlParseFailedState = `flowchart TD
    A[Loading URL failed. We can try to figure out why.] -->|Decode JSON| B(Please check the console to see the JSON and error details.)
    B --> C{Is the JSON correct?}
    C -->|Yes| D(Please Click here to Raise an issue in github.<br/>Including the broken link in the issue <br/> will speed up the fix.)
    C -->|No| E{Did someone <br/>send you this link?}
    E -->|Yes| F[Ask them to send <br/>you the complete link]
    E -->|No| G{Did you copy <br/> the complete URL?}
    G --> |Yes| D
    G --> |"No :("| H(Try using the Timeline tab in History <br/>from same browser you used to create the diagram.)
    click D href "https://github.com/mermaid-js/mermaid-live-editor/issues/new?assignees=&labels=bug&template=bug_report.md&title=Broken%20link" "Raise issue"`;

// inputStateStore handles all updates and is shared externally when exporting via URL, History, etc.
export const inputStateStore = persist(writable(defaultState), localStorage(), 'codeStore');

// Always start in code mode — never persist config mode across page loads
inputStateStore.update((s) => ({ ...s, editorMode: 'code' }));

export const currentState: ValidatedState = (() => {
  const state = get(inputStateStore);
  return {
    ...state,
    editorMode: state.editorMode ?? 'code',
    error: undefined,
    errorMarkers: [],
    serialized: serializeState(state)
  };
})();

function sanitizeDiagramCode(code: string): string {
  if (!code) {
    return code;
  }

  const diagramTypes = [
    'flowchart',
    'graph',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'erDiagram',
    'gantt',
    'pie',
    'gitGraph'
  ];

  const typePattern = new RegExp(`^(?:\\s*)(${diagramTypes.join('|')})`, 'gim');
  const matches = [...code.matchAll(typePattern)];

  if (matches.length > 1) {
    // The second declaration marks the start of a concatenated diagram – trim at its index.
    const secondMatch = matches[1];
    if (secondMatch.index !== undefined) {
      console.warn('Detected concatenated Mermaid diagrams. Trimming to first declaration.');
      return code.substring(0, secondMatch.index).trimEnd();
    }
  }

  return code;
}

const processState = async (state: State) => {
  const sanitizedCode = sanitizeDiagramCode(state.code);

  const processed: ValidatedState = {
    ...state,
    code: sanitizedCode,
    editorMode: state.editorMode ?? 'code',
    error: undefined,
    errorMarkers: [],
    serialized: ''
  };
  // No changes should be done to fields part of `state`.
  try {
    processed.serialized = serializeState({ ...state, code: sanitizedCode });
    const { diagramType } = await parse(sanitizedCode);
    processed.diagramType = diagramType;
    JSON.parse(state.mermaid);
  } catch (error) {
    processed.error = error as Error;
    errorDebug();
    if ('hash' in error) {
      try {
        let errorString = processed.error.toString();

        // Use local analysis first (fast, no network calls)
        const errorLineText = extractErrorLineText(errorString);
        const realLineNumber = findMostRelevantLineNumber(errorLineText, sanitizedCode);

        const codeLines = sanitizedCode.split('\n');
        const problematicLine = realLineNumber !== -1 ? codeLines[realLineNumber - 1]?.trim() : '';

        if (realLineNumber !== -1) {
          errorString = replaceLineNumberInErrorMessage(errorString, realLineNumber);
        }

        const simplifiedMessage =
          realLineNumber !== -1
            ? `Line ${realLineNumber}: ${problematicLine || 'Invalid syntax'}`
            : errorString || 'Syntax error';

        let first_line: number, last_line: number, first_column: number, last_column: number;
        try {
          ({ first_line, last_line, first_column, last_column } = (error.hash as ErrorHash).loc);
        } catch {
          first_line = realLineNumber !== -1 ? realLineNumber : 1;
          last_line = realLineNumber !== -1 ? realLineNumber + 1 : 2;
          first_column = 0;
          last_column = 0;
        }

        processed.error = new Error(errorString);
        const marker: MarkerData = {
          endColumn: last_column + (first_column === last_column ? 0 : 5),
          endLineNumber: last_line + (realLineNumber !== -1 ? realLineNumber - first_line : 0),
          message: simplifiedMessage,
          severity: 8, // Error
          startColumn: first_column,
          startLineNumber: realLineNumber !== -1 ? realLineNumber : first_line
        };
        processed.errorMarkers = [marker];

        // Optionally enhance with LLM analysis in background (non-blocking)
        // This runs asynchronously and doesn't block the UI
        if (realLineNumber === -1 || !problematicLine) {
          // Only try LLM if local analysis failed
          (async () => {
            try {
              const { analyzeErrorWithLLM } = await import('../error/errorHandling');
              const llmResult = await analyzeErrorWithLLM(errorString, sanitizedCode);
              if (llmResult && llmResult.line_number && llmResult.problematic_line) {
                // Update marker with LLM result if better
                processed.errorMarkers = [
                  {
                    ...marker,
                    message: llmResult.simplified_message,
                    startLineNumber: llmResult.line_number,
                    endLineNumber: llmResult.line_number + 1
                  }
                ];
              }
            } catch {
              // Silently fail - we already have local analysis result
            }
          })();
        }
      } catch (error) {
        console.error('Error without line helper', error);
      }
    }
  }
  return processed;
};

// Cache key fields to skip expensive processState when only transient fields change
let lastProcessedKey = '';
let lastProcessedResult: ValidatedState | null = null;

// All internal reads should be done via stateStore, but it should not be persisted/shared externally.
export const stateStore: Readable<ValidatedState> = derived(
  [inputStateStore],
  ([state], set) => {
    // Build a key from fields that actually affect rendering
    const key = `${state.code}\0${state.mermaid}\0${state.rough}\0${state.panZoom}\0${state.updateDiagram}\0${state.editorMode}`;
    if (key === lastProcessedKey && lastProcessedResult) {
      // Only transient fields changed (pan, zoom, renderCount) — reuse cached result
      set({
        ...lastProcessedResult,
        ...state,
        error: lastProcessedResult.error,
        errorMarkers: lastProcessedResult.errorMarkers
      });
      return;
    }
    lastProcessedKey = key;
    void processState(state).then((result) => {
      lastProcessedResult = result;
      set(result);
    });
  },
  currentState
);

export const loadState = (data: string): void => {
  let state: State;
  console.log(`Loading '${data}'`);
  try {
    state = deserializeState(data);
    if (!state.mermaid) {
      state.mermaid = defaultState.mermaid;
    }
    state.code = sanitizeDiagramCode(state.code);
    const mermaidConfig: MermaidConfig =
      typeof state.mermaid === 'string'
        ? (JSON.parse(state.mermaid) as MermaidConfig)
        : state.mermaid;
    if (
      mermaidConfig.securityLevel &&
      mermaidConfig.securityLevel !== 'strict' &&
      confirm(
        `Removing "securityLevel":"${mermaidConfig.securityLevel}" from the config for safety.\nClick Cancel if you trust the source of this Diagram.`
      )
    ) {
      delete mermaidConfig.securityLevel; // Prevent setting overriding securityLevel when loading state to mitigate possible XSS attack
    }
    state.mermaid = formatJSON(mermaidConfig);
  } catch (error) {
    state = get(inputStateStore);
    if (data) {
      console.error('Init error', error);
      state.code = urlParseFailedState;
      state.mermaid = defaultState.mermaid;
    }
  }
  updateCodeStore(state);
};

let renderCount = 0;
export const updateCodeStore = (newState: Partial<State>): void => {
  inputStateStore.update((state) => {
    renderCount++;
    return { ...state, ...newState, renderCount };
  });
};

export const updateCode = (
  code: string,
  {
    updateDiagram = false,
    resetPanZoom = false
  }: { updateDiagram?: boolean; resetPanZoom?: boolean } = {}
): void => {
  errorDebug();

  inputStateStore.update((state) => {
    if (resetPanZoom) {
      state.pan = undefined;
      state.zoom = undefined;
    }
    return { ...state, code: sanitizeDiagramCode(code), updateDiagram };
  });
};

export const updateConfig = (config: string): void => {
  updateCodeStore({ mermaid: config });
};

export type LayoutOption = 'dagre' | 'elk';

export const setLayout = (layout: LayoutOption): void => {
  inputStateStore.update((state) => {
    let config: MermaidConfig;
    try {
      config = JSON.parse(state.mermaid) as MermaidConfig;
    } catch {
      config = { theme: 'default' } as MermaidConfig;
    }

    // Set the layout engine
    config.layout = layout;

    // Flowchart diagrams respect defaultRenderer for dagre/elk
    if (typeof config.flowchart !== 'object' || config.flowchart === null) {
      config.flowchart = {} as NonNullable<MermaidConfig['flowchart']>;
    }
    const fc = config.flowchart as NonNullable<MermaidConfig['flowchart']>;

    if (layout === 'elk') {
      fc.defaultRenderer = 'elk';
      config.elk = { ...config.elk };
    } else {
      // dagre — use 'dagre-wrapper' which is the valid type
      fc.defaultRenderer = 'dagre-wrapper';
      delete config.elk;
    }

    return {
      ...state,
      mermaid: formatJSON(config),
      updateDiagram: true
    };
  });
};

export const toggleDarkTheme = (isDark: boolean): void => {
  inputStateStore.update((state) => {
    const config = JSON.parse(state.mermaid) as MermaidConfig;
    // Set mermaid theme based on current mode
    config.theme = isDark ? 'dark' : 'default';
    return { ...state, mermaid: formatJSON(config), updateDiagram: true };
  });
};

export const getStateString = (): string => {
  const state = get(inputStateStore);
  return JSON.stringify({
    ...state,
    serialized: serializeState(state)
  });
};

export const verifyState = (): void => {
  const state = get(inputStateStore);
  if (!state.panZoom) {
    state.panZoom = true;
  }
  updateCodeStore(state);
};
