export class MemoryKvStore {
  private values = new Map<string, unknown>();

  delete(category: string, key: string): void {
    this.values.delete(`${category}:${key}`);
  }

  get<T = unknown>(category: string, key: string): T | null {
    return (this.values.get(`${category}:${key}`) as T | undefined) ?? null;
  }

  set(category: string, key: string, value: unknown): void {
    this.values.set(`${category}:${key}`, value);
  }
}

export function installKvStore(seed?: Record<string, unknown>): MemoryKvStore {
  const kv = new MemoryKvStore();
  for (const [key, value] of Object.entries(seed ?? {})) {
    kv.set('persist', key, value);
  }
  (globalThis as { __kvStoreModule?: MemoryKvStore }).__kvStoreModule = kv;
  return kv;
}

export function uninstallKvStore(): void {
  delete (globalThis as { __kvStoreModule?: MemoryKvStore }).__kvStoreModule;
}
