import { describe, expect, it } from 'vitest';
import type { State } from '../../src/lib/client/types';
import {
  deserializeState,
  serializeState,
  type SerdeType
} from '../../src/lib/client/util/serialization/serde';

const defaultMermaidConfig =
  '{\n  "theme": "default",\n  "layout": "elk",\n  "flowchart": {\n    "defaultRenderer": "elk"\n  }\n}';

const stateFixture: State = {
  code: '',
  editorMode: 'code',
  grid: true,
  mermaid: defaultMermaidConfig,
  panZoom: true,
  rough: false,
  updateDiagram: true
};

describe('state serialization', () => {
  const verifySerde = (serde?: SerdeType): string => {
    const serialized = serializeState(
      {
        ...stateFixture,
        pan: { x: 10, y: 20 },
        renderCount: 12,
        updateDiagram: false,
        validationError: 'ignored',
        zoom: 2
      },
      serde
    );
    const deserialized = deserializeState(serialized);

    expect(deserialized).toEqual({
      code: stateFixture.code,
      editorMode: 'code',
      grid: true,
      mermaid: stateFixture.mermaid,
      panZoom: true,
      rough: false,
      updateDiagram: true
    });
    return serialized;
  };

  it('round trips compact state with the default pako serde', () => {
    expect(verifySerde()).toMatch(/^pako:/);
  });

  it('round trips compact state with base64 serde', () => {
    expect(verifySerde('base64')).toMatch(/^base64:/);
  });

  it('rejects unknown serde prefixes', () => {
    expect(() => deserializeState('unknown:hello')).toThrowError('Unknown serde type: unknown');
  });
});
