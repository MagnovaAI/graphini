import { randomUUID } from 'node:crypto';
import { workspaceFiles, users as usersTable } from '$lib/server/db/schema';

// workspaceFileRevisions is added in Task 1 and identified by the underlying
// table name to avoid an import-order coupling before that table exists.

export type FileKind = 'md' | 'json' | 'yaml' | 'mermaid';

export interface FakeFileRow {
  id: string;
  user_id: string;
  path: string;
  kind: FileKind;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export interface FakeRevisionRow {
  id: string;
  user_id: string;
  file_id: string;
  path: string;
  operation: 'create' | 'edit' | 'grep_replace' | 'delete';
  previous_content: string | null;
  previous_kind: FileKind;
  created_at: Date;
}

export interface FakeUserRow {
  id: string;
  firebase_uid: string | null;
}

export class FakeStore {
  files = new Map<string, FakeFileRow>();
  revisions = new Map<string, FakeRevisionRow>();
  users = new Map<string, FakeUserRow>();

  reset() {
    this.files.clear();
    this.revisions.clear();
    this.users.clear();
  }

  addUser(id: string, opts: { guest?: boolean } = {}) {
    this.users.set(id, { id, firebase_uid: opts.guest ? 'guest:' + id : 'firebase:' + id });
  }

  addFile(row: Omit<FakeFileRow, 'created_at' | 'updated_at'>) {
    const now = new Date();
    const stored: FakeFileRow = { ...row, created_at: now, updated_at: now };
    this.files.set(row.id, stored);
    return stored;
  }

  filesByUser(user_id: string): FakeFileRow[] {
    return [...this.files.values()].filter((f) => f.user_id === user_id);
  }

  revisionsForFile(user_id: string, file_id: string): FakeRevisionRow[] {
    return [...this.revisions.values()]
      .filter((r) => r.user_id === user_id && r.file_id === file_id)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }
}

export const fakeStore = new FakeStore();

let nextDate = 0;
function nextNow(): Date {
  // Monotonic timestamps for deterministic ordering in tests.
  nextDate += 1;
  return new Date(2026, 0, 1, 0, 0, 0, nextDate);
}

// =============================================================================
// drizzle-orm shim helpers
// =============================================================================
//
// Override drizzle-orm helpers ONLY inside test files that import from this
// fixture. We patch by re-exporting wrapped versions; each test does:
//   vi.mock('drizzle-orm', async (orig) => {
//     const real = await orig() as any;
//     return { ...real, eq, and, like, asc, desc };
//   });
// where eq/and/like/asc/desc come from this file.

type Predicate =
  | { kind: 'eq'; col: unknown; value: unknown }
  | { kind: 'and'; preds: Predicate[] }
  | { kind: 'like'; col: unknown; pattern: string };

export const eq = (col: unknown, value: unknown): Predicate => ({ kind: 'eq', col, value });
export const and = (...preds: Predicate[]): Predicate => ({ kind: 'and', preds });
export const like = (col: unknown, pattern: string): Predicate => ({
  kind: 'like',
  col,
  pattern
});
export const asc = (col: unknown) => ({ col, dir: 'asc' as const });
export const desc = (col: unknown) => ({ col, dir: 'desc' as const });

// =============================================================================
// Build a fake `db` that satisfies the Drizzle subset used by operation modules
// =============================================================================
//
// Supported operations (others throw):
//   - db.select({...}).from(table).where(cond).orderBy(...)
//   - db.select({...}).from(table).where(cond).limit(n)
//   - db.insert(table).values(v).returning()
//   - db.update(table).set(v).where(cond)
//   - db.delete(table).where(cond)
//
// `cond` predicates are matched by inspecting the Predicate tuples produced
// by the eq/and/like helpers exported above.

function tableFor(target: unknown): 'workspaceFiles' | 'workspaceFileRevisions' | 'users' {
  if (target === workspaceFiles) return 'workspaceFiles';
  if (target === usersTable) return 'users';
  // workspaceFileRevisions is identified by name to avoid the import order issue.
  const sym = Object.getOwnPropertySymbols(target as object).find(
    (s) => s.description === 'drizzle:Name'
  );
  const name = sym ? (target as Record<symbol, unknown>)[sym] : undefined;
  if (
    name === 'workspace_file_revisions' ||
    (target as { _?: { name?: string } })._?.name === 'workspace_file_revisions'
  ) {
    return 'workspaceFileRevisions';
  }
  throw new Error('Unknown table reference in fake-db');
}

function rowsFor(table: ReturnType<typeof tableFor>): Map<string, Record<string, unknown>> {
  if (table === 'workspaceFiles')
    return fakeStore.files as unknown as Map<string, Record<string, unknown>>;
  if (table === 'workspaceFileRevisions')
    return fakeStore.revisions as unknown as Map<string, Record<string, unknown>>;
  if (table === 'users') return fakeStore.users as unknown as Map<string, Record<string, unknown>>;
  throw new Error('unreachable');
}

function evalPred(row: Record<string, unknown>, pred: Predicate | undefined): boolean {
  if (!pred) return true;
  if (pred.kind === 'and') return pred.preds.every((p) => evalPred(row, p));
  // Map a Drizzle column reference to a row property name.
  // Both schemas snake_case their columns to match the row shape directly.
  const colName = (pred.col as { name: string }).name;
  if (pred.kind === 'eq') return row[colName] === pred.value;
  if (pred.kind === 'like') {
    // Translate SQL LIKE pattern to a JS substring/startsWith check.
    const p = pred.pattern;
    if (p.endsWith('%') && !p.slice(0, -1).includes('%')) {
      return (
        typeof row[colName] === 'string' && (row[colName] as string).startsWith(p.slice(0, -1))
      );
    }
    // We only use 'prefix%' in production code; bail out otherwise.
    throw new Error(`fake-db: unsupported LIKE pattern: ${p}`);
  }
  return false;
}

function cmp(a: unknown, b: unknown): number {
  if ((a as number) < (b as number)) return -1;
  if ((a as number) > (b as number)) return 1;
  return 0;
}

interface QueryState {
  table?: ReturnType<typeof tableFor>;
  projection?: Record<string, unknown>;
  where?: Predicate;
  orderBy?: { col: { name: string }; dir: 'asc' | 'desc' };
  limit?: number;
  values?: Record<string, unknown>;
}

function isCountProjection(p: unknown): boolean {
  // sql<number>`count(*)::int` is opaque to us; we detect it by the projection
  // key name "count" or "c" / "total" with a value that is an sql template object.
  if (!p || typeof p !== 'object') return false;
  return Object.keys(p as Record<string, unknown>).some((k) => /count|^c$|total/.test(k));
}

function makeQuery(
  state: QueryState,
  terminal: 'select' | 'insert' | 'update' | 'delete'
): Promise<unknown> {
  // Note: Drizzle queries are thenable. We return a real Promise that resolves
  // the moment it's awaited so the operation code can use `await` on every chain.
  return Promise.resolve().then(() => {
    if (!state.table) throw new Error('fake-db: no table specified');
    const map = rowsFor(state.table);

    if (terminal === 'select') {
      let rows = [...map.values()].filter((r) => evalPred(r, state.where));
      if (state.orderBy) {
        const orderBy = state.orderBy;
        const dir = orderBy.dir === 'desc' ? -1 : 1;
        rows.sort((a, b) => dir * cmp(a[orderBy.col.name], b[orderBy.col.name]));
      }
      if (state.limit !== undefined) rows = rows.slice(0, state.limit);
      // Apply projection: if it looks like a count() projection, return a single
      // row with the count value under the original key.
      if (state.projection && isCountProjection(state.projection)) {
        const key = Object.keys(state.projection)[0];
        return [{ [key]: rows.length }];
      }
      if (state.projection) {
        const projection = state.projection;
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const k of Object.keys(projection)) {
            const colName = (projection[k] as { name?: string } | undefined)?.name ?? k;
            out[k] = r[colName];
          }
          return out;
        });
      }
      return rows;
    }

    if (terminal === 'insert') {
      const v = state.values ?? {};
      const id = (v.id as string | undefined) ?? randomUUID();
      const now = nextNow();
      const base: Record<string, unknown> = {
        ...v,
        id,
        created_at: (v.created_at as Date | undefined) ?? now,
        updated_at: (v.updated_at as Date | undefined) ?? now
      };
      // Per-property assignment so Proxy-based test hooks fire.
      const slot: Record<string, unknown> = {};
      for (const k of Object.keys(base)) slot[k] = base[k];
      map.set(id, slot);
      return [slot];
    }

    if (terminal === 'update') {
      const rows = [...map.values()].filter((r) => evalPred(r, state.where));
      for (const r of rows) {
        for (const k of Object.keys(state.values ?? {})) {
          r[k] = (state.values as Record<string, unknown>)[k]; // per-property so Proxy traps fire (see Task 7)
        }
      }
      return rows;
    }

    if (terminal === 'delete') {
      const toDelete = [...map.entries()].filter(([, r]) => evalPred(r, state.where));
      for (const [id] of toDelete) map.delete(id);
      return toDelete.map(([, r]) => r);
    }
    return [];
  });
}

export function buildFakeDb() {
  return {
    select(projection?: Record<string, unknown>) {
      const state: QueryState = { projection };
      return {
        from(t: unknown) {
          state.table = tableFor(t);
          return {
            where(pred: Predicate) {
              state.where = pred;
              return {
                orderBy(o: { col: { name: string }; dir: 'asc' | 'desc' }) {
                  state.orderBy = o;
                  return {
                    limit(n: number) {
                      state.limit = n;
                      return makeQuery(state, 'select');
                    },
                    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                      makeQuery(state, 'select').then(resolve, reject)
                  };
                },
                limit(n: number) {
                  state.limit = n;
                  return makeQuery(state, 'select');
                },
                then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                  makeQuery(state, 'select').then(resolve, reject)
              };
            },
            orderBy(o: { col: { name: string }; dir: 'asc' | 'desc' }) {
              state.orderBy = o;
              return {
                then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                  makeQuery(state, 'select').then(resolve, reject)
              };
            },
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              makeQuery(state, 'select').then(resolve, reject)
          };
        }
      };
    },
    insert(t: unknown) {
      const state: QueryState = { table: tableFor(t) };
      return {
        values(v: Record<string, unknown>) {
          state.values = v;
          return {
            returning() {
              return makeQuery(state, 'insert');
            },
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              makeQuery(state, 'insert').then(resolve, reject)
          };
        }
      };
    },
    update(t: unknown) {
      const state: QueryState = { table: tableFor(t) };
      return {
        set(v: Record<string, unknown>) {
          state.values = v;
          return {
            where(pred: Predicate) {
              state.where = pred;
              return {
                returning() {
                  return makeQuery(state, 'update');
                },
                then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                  makeQuery(state, 'update').then(resolve, reject)
              };
            }
          };
        }
      };
    },
    delete(t: unknown) {
      const state: QueryState = { table: tableFor(t) };
      return {
        where(pred: Predicate) {
          state.where = pred;
          return {
            returning() {
              return makeQuery(state, 'delete');
            },
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              makeQuery(state, 'delete').then(resolve, reject)
          };
        }
      };
    }
  };
}

/** Helper called from each test file's vi.mock factory. */
export function mockGetDb() {
  return {
    getDb: () => ({ db: buildFakeDb() })
  };
}
