import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ensureRecent,
  forgetRecent,
  loadRecents,
  recordOpen,
  saveRecents,
  withColors,
  type RecentRepo,
} from './recent-repos.js';

let file: string;

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'n10-recents-')), 'recents.json');
});

describe('loadRecents', () => {
  it('returns an empty list when no file exists', () => {
    expect(loadRecents(file)).toEqual([]);
  });

  it('round-trips saved entries', () => {
    const recents: RecentRepo[] = [
      { cwd: '/a/b', lastOpenedAt: 100 },
      { cwd: '/c/d', lastOpenedAt: 200 },
    ];
    saveRecents(recents, file);
    expect(loadRecents(file)).toEqual(recents);
  });

  it('survives corrupt json by returning empty list', () => {
    writeFileSync(file, '{not json');
    expect(loadRecents(file)).toEqual([]);
  });
});

describe('recordOpen', () => {
  it('adds a new repo at the front with a timestamp', () => {
    const t0 = Date.now();
    const next = recordOpen([], '/repos/alpha');
    expect(next).toHaveLength(1);
    expect(next[0]!.cwd).toBe('/repos/alpha');
    expect(next[0]!.lastOpenedAt).toBeGreaterThanOrEqual(t0);
  });

  it('moves an existing repo to the front instead of duplicating', () => {
    let recents: RecentRepo[] = [
      { cwd: '/old', lastOpenedAt: 1 },
      { cwd: '/newer', lastOpenedAt: 2 },
    ];
    recents = recordOpen(recents, '/old');
    expect(recents.map((r) => r.cwd)).toEqual(['/old', '/newer']);
  });

  it('caps the list at ten entries', () => {
    let recents: RecentRepo[] = [];
    for (let i = 0; i < 15; i++) {
      recents = recordOpen(recents, `/repo-${i}`);
    }
    expect(recents).toHaveLength(10);
    expect(recents[0]!.cwd).toBe('/repo-14');
    expect(recents.at(-1)!.cwd).toBe('/repo-5');
  });
});

describe('repository colours', () => {
  const colors = (recents: RecentRepo[]) =>
    Object.fromEntries(recents.map((r) => [r.cwd, r.color]));

  it('gives a new repository the lowest colour no other one holds', () => {
    const recents: RecentRepo[] = [
      { cwd: '/a', lastOpenedAt: 2, color: 0 },
      { cwd: '/b', lastOpenedAt: 1, color: 2 },
    ];
    expect(colors(recordOpen(recents, '/c'))).toEqual({
      '/a': 0,
      '/b': 2,
      '/c': 1,
    });
  });

  it('keeps a repository its colour when it is opened again', () => {
    const recents: RecentRepo[] = [
      { cwd: '/a', lastOpenedAt: 2, color: 0 },
      { cwd: '/b', lastOpenedAt: 1, color: 1 },
    ];
    const next = recordOpen(recents, '/b');
    expect(next.map((r) => r.cwd)).toEqual(['/b', '/a']);
    expect(colors(next)).toEqual({ '/a': 0, '/b': 1 });
  });

  it('frees the colour of a repository that falls off the list', () => {
    let recents: RecentRepo[] = [];
    for (let i = 0; i < 10; i++) recents = recordOpen(recents, `/repo-${i}`);
    // /repo-0 held colour 0 and is the oldest.
    recents = recordOpen(recents, '/new');
    expect(recents.some((r) => r.cwd === '/repo-0')).toBe(false);
    expect(colors(recents)['/new']).toBe(0);
  });

  it('colours entries saved before colours, leaving the rest alone', () => {
    expect(
      colors(
        withColors([
          { cwd: '/a', lastOpenedAt: 3 },
          { cwd: '/b', lastOpenedAt: 2, color: 0 },
          { cwd: '/c', lastOpenedAt: 1 },
        ])
      )
    ).toEqual({ '/a': 1, '/b': 0, '/c': 2 });
  });

  it('colours a repository put on the list without being opened', () => {
    saveRecents([{ cwd: '/a', lastOpenedAt: 1, color: 0 }], file);
    ensureRecent('/b', file);
    expect(colors(loadRecents(file))).toEqual({ '/a': 0, '/b': 1 });
  });
});

describe('ensureRecent', () => {
  // A terminal restored at a repository root puts that repository back
  // on the list — at the end, and without touching the order the user
  // made by opening things, because nobody opened it just now.
  it('appends a repository that is missing without reordering', () => {
    saveRecents(
      [
        { cwd: '/a', lastOpenedAt: 2 },
        { cwd: '/b', lastOpenedAt: 1 },
      ],
      file
    );
    ensureRecent('/c', file);
    expect(loadRecents(file).map((r) => r.cwd)).toEqual(['/a', '/b', '/c']);
  });

  it('leaves a repository that is already listed where it is', () => {
    saveRecents(
      [
        { cwd: '/a', lastOpenedAt: 2 },
        { cwd: '/b', lastOpenedAt: 1 },
      ],
      file
    );
    ensureRecent('/b', file);
    expect(loadRecents(file).map((r) => r.cwd)).toEqual(['/a', '/b']);
  });
});

describe('forgetRecent', () => {
  it('removes the entry and persists the change', () => {
    saveRecents(
      [
        { cwd: '/a', lastOpenedAt: 1 },
        { cwd: '/b', lastOpenedAt: 2 },
      ],
      file
    );
    forgetRecent('/a', file);
    expect(loadRecents(file).map((r) => r.cwd)).toEqual(['/b']);
  });

  it('removes the state file entirely when the last entry goes', () => {
    saveRecents([{ cwd: '/a', lastOpenedAt: 1 }], file);
    forgetRecent('/a', file);
    expect(existsSync(file)).toBe(false);
    expect(loadRecents(file)).toEqual([]);
  });
});

describe('saveRecents round trip via loadRecents', () => {
  it('writes valid json to disk', () => {
    saveRecents([{ cwd: '/x', lastOpenedAt: 5 }], file);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw[0].cwd).toBe('/x');
  });
});
