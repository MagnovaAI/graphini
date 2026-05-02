import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry, State } from '../../src/lib/types';
import { installKvStore, uninstallKvStore, type MemoryKvStore } from './kv-test-utils';

const stateFixture: State = {
  code: '',
  editorMode: 'code',
  grid: true,
  mermaid: '{}',
  panZoom: true,
  rough: false,
  updateDiagram: true
};

describe('history persistence', () => {
  let kv: MemoryKvStore;

  beforeEach(() => {
    vi.resetModules();
    kv = installKvStore();
  });

  afterEach(() => {
    uninstallKvStore();
  });

  it('saves and clears entries through the KV-backed persistence store', async () => {
    const { addHistoryEntry, clearHistoryData, historyModeStore } = await import(
      '../../src/lib/features/history/History/history'
    );

    addHistoryEntry({
      state: stateFixture,
      time: 12_345,
      type: 'manual'
    });
    addHistoryEntry({
      state: stateFixture,
      time: 54_321,
      type: 'auto'
    });

    const manualEntries = kv.get<HistoryEntry[]>('persist', 'manualHistoryStore') ?? [];
    const autoEntries = kv.get<HistoryEntry[]>('persist', 'autoHistoryStore') ?? [];

    expect(manualEntries).toHaveLength(2);
    expect(manualEntries[0]).toMatchObject({ time: 54_321, type: 'auto' });
    expect(manualEntries[1]).toMatchObject({ time: 12_345, type: 'manual' });
    expect(manualEntries.every((entry) => typeof entry.id === 'string')).toBe(true);
    expect(manualEntries.every((entry) => typeof entry.name === 'string')).toBe(true);
    expect(autoEntries).toHaveLength(1);
    expect(autoEntries[0]).toMatchObject({ time: 54_321, type: 'auto' });

    historyModeStore.set('manual');
    const [entryToClear, ...entriesToKeep] =
      kv.get<HistoryEntry[]>('persist', 'manualHistoryStore') ?? [];
    clearHistoryData(entryToClear.id);

    expect(kv.get<HistoryEntry[]>('persist', 'manualHistoryStore')).toEqual(entriesToKeep);

    clearHistoryData();

    expect(kv.get<HistoryEntry[]>('persist', 'manualHistoryStore')).toEqual([]);
  });
});
