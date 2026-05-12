import { describe, expect, it } from 'vitest';
import { runGrep } from '../../src/lib/server/chat/tools/fileSystem-grep';

describe('runGrep — text mode', () => {
  it('finds literal substrings case-insensitively by default', () => {
    const r = runGrep([{ path: 'a.md', content: 'Hello foo\nbar FOO baz\nno match' }], {
      query: 'foo'
    });
    expect(r.matches).toHaveLength(2);
    expect(r.matches[0]).toMatchObject({ path: 'a.md', lineNumber: 1, lineText: 'Hello foo' });
    expect(r.matches[1].lineNumber).toBe(2);
  });

  it('honors caseSensitive: true', () => {
    const r = runGrep([{ path: 'a.md', content: 'Foo\nfoo' }], {
      query: 'Foo',
      caseSensitive: true
    });
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].lineNumber).toBe(1);
  });

  it('includes contextBefore and contextAfter', () => {
    const r = runGrep([{ path: 'a.md', content: 'a\nb\nFOO\nc\nd' }], {
      query: 'foo',
      contextLines: 1
    });
    expect(r.matches[0].contextBefore).toEqual(['b']);
    expect(r.matches[0].contextAfter).toEqual(['c']);
  });

  it('contextLines: 0 returns empty arrays', () => {
    const r = runGrep([{ path: 'a.md', content: 'a\nfoo\nb' }], {
      query: 'foo',
      contextLines: 0
    });
    expect(r.matches[0].contextBefore).toEqual([]);
    expect(r.matches[0].contextAfter).toEqual([]);
  });

  it('truncates at maxMatches', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i} foo`).join('\n');
    const r = runGrep([{ path: 'a.md', content: lines }], { query: 'foo', maxMatches: 10 });
    expect(r.matches).toHaveLength(10);
    expect(r.truncated).toBe(true);
  });

  it('returns truncated: false when fewer than maxMatches', () => {
    const r = runGrep([{ path: 'a.md', content: 'foo\nfoo' }], { query: 'foo', maxMatches: 50 });
    expect(r.truncated).toBe(false);
  });

  it('scans files in the order given', () => {
    const r = runGrep(
      [
        { path: 'b.md', content: 'foo' },
        { path: 'a.md', content: 'foo' }
      ],
      { query: 'foo' }
    );
    expect(r.matches.map((m) => m.path)).toEqual(['b.md', 'a.md']);
  });

  it('filesScanned reports total file count', () => {
    const r = runGrep(
      [
        { path: 'a.md', content: 'foo' },
        { path: 'b.md', content: 'no' },
        { path: 'c.md', content: 'foo' }
      ],
      { query: 'foo' }
    );
    expect(r.filesScanned).toBe(3);
  });
});

describe('runGrep — regex mode', () => {
  it('matches via regex', () => {
    const r = runGrep([{ path: 'a.md', content: 'foo1\nbar2\nfoo3' }], {
      query: '^foo\\d',
      mode: 'regex'
    });
    expect(r.matches.map((m) => m.lineText)).toEqual(['foo1', 'foo3']);
  });

  it('case-insensitive by default in regex mode', () => {
    const r = runGrep([{ path: 'a.md', content: 'FOO\nbar' }], { query: '^foo', mode: 'regex' });
    expect(r.matches).toHaveLength(1);
  });

  it('case-sensitive when requested in regex mode', () => {
    const r = runGrep([{ path: 'a.md', content: 'FOO\nfoo' }], {
      query: '^foo',
      mode: 'regex',
      caseSensitive: true
    });
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].lineText).toBe('foo');
  });

  it('throws on invalid regex', () => {
    expect(() => runGrep([{ path: 'a.md', content: 'x' }], { query: '(', mode: 'regex' })).toThrow(
      /Invalid regex|SyntaxError|Unterminated/i
    );
  });

  it('rejects regex longer than 1000 chars', () => {
    expect(() =>
      runGrep([{ path: 'a.md', content: 'x' }], { query: 'a'.repeat(1001), mode: 'regex' })
    ).toThrow(/too long|1000/);
  });

  it('rejects nested unbounded quantifiers', () => {
    expect(() =>
      runGrep([{ path: 'a.md', content: 'x' }], { query: '(a+)+', mode: 'regex' })
    ).toThrow(/nested|quantifier/i);
  });
});

describe('runGrep — option validation', () => {
  it('rejects empty query', () => {
    expect(() => runGrep([], { query: '' })).toThrow(/query/i);
  });
  it('rejects out-of-range maxMatches', () => {
    expect(() => runGrep([], { query: 'x', maxMatches: 999 })).toThrow(/maxMatches/);
    expect(() => runGrep([], { query: 'x', maxMatches: 0 })).toThrow(/maxMatches/);
  });
  it('rejects out-of-range contextLines', () => {
    expect(() => runGrep([], { query: 'x', contextLines: 6 })).toThrow(/contextLines/);
    expect(() => runGrep([], { query: 'x', contextLines: -1 })).toThrow(/contextLines/);
  });
});
