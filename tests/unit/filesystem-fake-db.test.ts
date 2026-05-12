import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('drizzle-orm', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  const fakeDb = await import('./filesystem-fake-db');
  return {
    ...real,
    eq: fakeDb.eq,
    and: fakeDb.and,
    like: fakeDb.like,
    asc: fakeDb.asc,
    desc: fakeDb.desc
  };
});

import { fakeStore, buildFakeDb } from './filesystem-fake-db';
import { workspaceFiles } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

beforeEach(() => fakeStore.reset());

describe('buildFakeDb', () => {
  it('round-trips an insert + select', async () => {
    const db = buildFakeDb();
    fakeStore.addUser('u1');
    const [row] = (await db
      .insert(workspaceFiles)
      .values({ user_id: 'u1', path: 'a.md', kind: 'md', content: 'hi' })
      .returning()) as { path: string }[];
    expect(row.path).toBe('a.md');

    const found = (await db
      .select()
      .from(workspaceFiles)
      .where(
        and(eq(workspaceFiles.user_id, 'u1'), eq(workspaceFiles.path, 'a.md')) as never
      )) as {
      content: string;
    }[];
    expect(found).toHaveLength(1);
    expect(found[0].content).toBe('hi');
  });
});
