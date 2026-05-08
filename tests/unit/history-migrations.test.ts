import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry, State } from '../../src/lib/client/types';
import { installKvStore, uninstallKvStore } from './kv-test-utils';

const stateFixture: State = {
  code: '',
  editorMode: 'code',
  grid: true,
  mermaid: '{}',
  panZoom: true,
  rough: false,
  updateDiagram: true
};

describe('history migrations', () => {
  afterEach(() => {
    uninstallKvStore();
  });

  it('adds ids to legacy history entries stored in KV persistence', async () => {
    vi.resetModules();
    const legacyManual = [
      { name: 'old-manual', state: stateFixture, time: 1, type: 'manual' },
      { name: 'older-manual', state: stateFixture, time: 2, type: 'manual' }
    ];
    const legacyAuto = [{ name: 'old-auto', state: stateFixture, time: 3, type: 'auto' }];
    const kv = installKvStore({
      autoHistoryStore: legacyAuto,
      manualHistoryStore: legacyManual,
      migrations: { version: -1 }
    });
    const { applyMigrations } = await import('../../src/lib/client/util/state/migrations');

    applyMigrations();

    const manualEntries = kv.get<HistoryEntry[]>('persist', 'manualHistoryStore') ?? [];
    const autoEntries = kv.get<HistoryEntry[]>('persist', 'autoHistoryStore') ?? [];

    expect(manualEntries).toHaveLength(2);
    expect(autoEntries).toHaveLength(1);
    expect(manualEntries.every((entry) => typeof entry.id === 'string')).toBe(true);
    expect(autoEntries.every((entry) => typeof entry.id === 'string')).toBe(true);
    expect(kv.get('persist', 'migrations')).toEqual({ version: 0 });
  });
});
