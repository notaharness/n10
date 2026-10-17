import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CommentStore from './comment-store.js';
import type { ReviewComment } from './types.js';

/**
 * Where a review agent's comments live between being written and being
 * posted.
 *
 * Two processes share this file: the agent appends to it through
 * `n10 util add-comment` while the reader — the TUI's viewer or the
 * desktop, which polls it — has it open and may be editing the same
 * comments. So the reads have to tolerate a file that is missing or
 * mid-write, and the writes must never leave a half-written file for a
 * poll to land on.
 */

let home: string;
let originalHome: string | undefined;
let store: typeof CommentStore;

const PR = 42;

function comment(id: string, body = `body ${id}`): ReviewComment {
  return {
    id,
    file: 'src/a.ts',
    lineStart: 1,
    lineEnd: 1,
    severity: 'minor',
    body,
    side: 'RIGHT',
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'n10-comment-store-'));
  process.env.HOME = home;
  vi.resetModules();
  store = await import('./comment-store.js');
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('readComments', () => {
  it('returns nothing when the agent has written nothing yet', () => {
    expect(store.readComments('/repo', PR)).toEqual([]);
  });

  it('returns nothing rather than throwing on a half-written file', () => {
    // A reader polls this file while the agent writes it; a parse error
    // here would take down the pane rather than show it a moment later.
    mkdirSync(store.commentDirPath('/repo', PR), { recursive: true });
    writeFileSync(store.commentFilePath('/repo', PR), '{"prId":42,"comm');
    expect(store.readComments('/repo', PR)).toEqual([]);
  });

  it('tolerates a file with no comments key', () => {
    mkdirSync(store.commentDirPath('/repo', PR), { recursive: true });
    writeFileSync(store.commentFilePath('/repo', PR), '{"prId":42}');
    expect(store.readComments('/repo', PR)).toEqual([]);
  });

  it('keeps each pull request separate', () => {
    store.appendComment('/repo', PR, comment('a'));
    store.appendComment('/repo', 99, comment('b'));
    expect(store.readComments('/repo', PR).map((c) => c.id)).toEqual(['a']);
    expect(store.readComments('/repo', 99).map((c) => c.id)).toEqual(['b']);
  });
});

describe('appendComment', () => {
  it('creates the directory on the first comment', () => {
    store.appendComment('/repo', PR, comment('first'));
    expect(store.readComments('/repo', PR).map((c) => c.id)).toEqual(['first']);
  });

  it('adds to what is already there, in order', () => {
    // The agent appends over the course of a review; earlier comments
    // (which the user may have edited) have to survive.
    store.appendComment('/repo', PR, comment('one'));
    store.appendComment('/repo', PR, comment('two'));
    expect(store.readComments('/repo', PR).map((c) => c.id)).toEqual([
      'one',
      'two',
    ]);
  });

  it('keeps an edit made between two appends', () => {
    store.appendComment('/repo', PR, comment('one'));
    store.updateComment('/repo', PR, 'one', { body: 'edited by hand' });
    store.appendComment('/repo', PR, comment('two'));

    const stored = store.readComments('/repo', PR);
    expect(stored.find((c) => c.id === 'one')?.body).toBe('edited by hand');
    expect(stored).toHaveLength(2);
  });

  it('leaves no temporary file behind', () => {
    // Writes go to a .tmp and are renamed into place, so a reader never
    // sees a partial file. A leftover .tmp means the rename did not
    // happen.
    store.appendComment('/repo', PR, comment('one'));
    const entries = readdirSync(store.commentDirPath('/repo', PR));
    expect(entries).toEqual(['comments.json']);
  });
});

describe('updateComment', () => {
  it('patches only the given fields', () => {
    store.appendComment('/repo', PR, comment('one'));
    expect(store.updateComment('/repo', PR, 'one', { body: 'new body' })).toBe(
      true
    );

    const stored = store.readComments('/repo', PR)[0];
    expect(stored.body).toBe('new body');
    expect(stored.file).toBe('src/a.ts');
    expect(stored.severity).toBe('minor');
  });

  it('reports an unknown id instead of inventing a comment', () => {
    store.appendComment('/repo', PR, comment('one'));
    expect(store.updateComment('/repo', PR, 'missing', { body: 'x' })).toBe(
      false
    );
    expect(store.readComments('/repo', PR)).toHaveLength(1);
  });

  it('reports false when there is no file at all', () => {
    expect(store.updateComment('/repo', PR, 'one', { body: 'x' })).toBe(false);
  });
});

describe('removeComment', () => {
  it('removes only the one asked for', () => {
    store.appendComment('/repo', PR, comment('one'));
    store.appendComment('/repo', PR, comment('two'));
    expect(store.removeComment('/repo', PR, 'one')).toBe(true);
    expect(store.readComments('/repo', PR).map((c) => c.id)).toEqual(['two']);
  });

  it('reports an unknown id rather than clearing the file', () => {
    store.appendComment('/repo', PR, comment('one'));
    expect(store.removeComment('/repo', PR, 'missing')).toBe(false);
    expect(store.readComments('/repo', PR)).toHaveLength(1);
  });
});

describe('the file on disk', () => {
  it('is valid JSON at every point a reader could look', () => {
    // Written to a temporary name and renamed, so a concurrent read
    // sees either the old file or the new one — never a partial write.
    store.appendComment('/repo', PR, comment('one'));
    store.appendComment('/repo', PR, comment('two'));

    const raw = execFileSync('cat', [store.commentFilePath('/repo', PR)], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(raw) as { prId: number; comments: unknown[] };
    expect(parsed.prId).toBe(PR);
    expect(parsed.comments).toHaveLength(2);
  });
});

it('isolates equal PR numbers by repository', () => {
  store.appendComment('/first/.git', PR, comment('first'));
  store.appendComment('/second/.git', PR, comment('second'));
  expect(store.readComments('/first/.git', PR).map((item) => item.id)).toEqual([
    'first',
  ]);
  expect(store.readComments('/second/.git', PR).map((item) => item.id)).toEqual(
    ['second']
  );
});
