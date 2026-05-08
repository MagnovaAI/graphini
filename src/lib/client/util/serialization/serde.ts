import type { State } from '$lib/client/types';
import { fromBase64, fromUint8Array, toBase64, toUint8Array } from 'js-base64';
import { deflate, inflate } from 'pako';

interface Serde {
  serialize: (state: string) => string;
  deserialize: (state: string) => string;
}

const base64Serde: Serde = {
  serialize: (state: string): string => {
    return toBase64(state, true);
  },
  deserialize: (state: string): string => {
    return fromBase64(state);
  }
};

export const pakoSerde: Serde = {
  serialize: (state: string): string => {
    const data = new TextEncoder().encode(state);
    const compressed = deflate(data, { level: 9 });
    return fromUint8Array(compressed, true);
  },
  deserialize: (state: string): string => {
    const data = toUint8Array(state);
    return inflate(data, { to: 'string' });
  }
};

export type SerdeType = 'base64' | 'pako';

const serdes: Record<SerdeType, Serde> = {
  base64: base64Serde,
  pako: pakoSerde
};

export const serializeState = (state: State, serde: SerdeType = 'pako'): string => {
  if (!(serde in serdes)) {
    throw new Error(`Unknown serde type: ${serde}`);
  }
  // Strip transient fields that shouldn't affect the URL hash
  // These change frequently (pan/zoom, renderCount) and cause rapid hash updates
  const {
    renderCount,
    updateDiagram,
    pan,
    zoom,
    validationError,
    validationErrorLine,
    validationSuggestions,
    ...persistentState
  } = state;
  // Compact: only include non-default values to reduce hash size
  const compact: Record<string, unknown> = { c: persistentState.code };
  if (
    persistentState.mermaid &&
    persistentState.mermaid !==
      '{\n  "theme": "default",\n  "layout": "elk",\n  "flowchart": {\n    "defaultRenderer": "elk"\n  }\n}'
  ) {
    compact.m = persistentState.mermaid;
  }
  if (persistentState.rough) compact.r = true;
  if (persistentState.grid === false) compact.g = false;
  if (persistentState.panZoom === false) compact.p = false;
  if (persistentState.editorMode && persistentState.editorMode !== 'code')
    compact.e = persistentState.editorMode;
  const json = JSON.stringify(compact);
  const serialized = serdes[serde].serialize(json);
  return `${serde}:${serialized}`;
};

export const deserializeState = (state: string): State => {
  let type: SerdeType, serialized: string;
  if (state.includes(':')) {
    let tempType: string;
    [tempType, serialized] = state.split(':');
    if (tempType in serdes) {
      type = tempType as SerdeType;
    } else {
      throw new Error(`Unknown serde type: ${tempType}`);
    }
  } else {
    type = 'base64';
    serialized = state;
  }
  const json = serdes[type].deserialize(serialized);
  const parsed = JSON.parse(json);
  // Support compact format (c, m, r, g, p, e) and legacy full format (code, mermaid, ...)
  if ('c' in parsed && !('code' in parsed)) {
    return {
      code: parsed.c || '',
      mermaid:
        parsed.m ||
        '{\n  "theme": "default",\n  "layout": "elk",\n  "flowchart": {\n    "defaultRenderer": "elk"\n  }\n}',
      rough: parsed.r || false,
      grid: parsed.g !== false,
      panZoom: parsed.p !== false,
      editorMode: parsed.e || 'code',
      updateDiagram: true
    } as State;
  }
  return parsed as State;
};
