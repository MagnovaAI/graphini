/**
 * HMR State Preservation Utilities
 *
 * When Vite hot-reloads a `.svelte.ts` module, the module re-executes and all
 * module-level $state() declarations reset to their initial values. These
 * helpers stash runtime state onto globalThis during dispose so it survives
 * the reload cycle.
 *
 * Usage for plain $state objects:
 *   const state = $state<T>(hmrRestore('myKey') ?? { ...defaults });
 *   hmrPreserve('myKey', () => state);
 *
 * Usage for singleton class instances:
 *   export const kv: KvStore = hmrRestore('kv') ?? new KvStore();
 *   hmrPreserve('kv', () => kv);
 */

const HMR_NS = '__graphini_hmr_';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as Record<string, any>;

/**
 * Restore a previously stashed value (returns undefined on first load or in prod).
 */
export function hmrRestore<T>(key: string): T | undefined {
  const full = HMR_NS + key;
  const v = g[full] as T | undefined;
  // Clean up after restore so stale values don't linger across multiple reloads
  if (full in g) g[full] = undefined;
  return v;
}

/**
 * Register a dispose callback that stashes the current value before HMR unloads the module.
 * No-op in production builds (import.meta.hot is stripped).
 */
export function hmrPreserve(key: string, getValue: () => unknown): void {
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      g[HMR_NS + key] = getValue();
    });
  }
}
