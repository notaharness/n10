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
const REPO = '0123456789abcdef';
/** Pull request 42 of one repository. */
const SCOPE = { repo: REPO, prId: PR };

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
  // The module resolves ~/.n10 once at import time, so it has to be
  // re-imported after HOME changes.
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
    expect(store.readComments(SCOPE)).toEqual([]);
  });

  it('returns nothing rather than throwing on a half-written file', () => {
    // A reader polls this file while the agent writes it; a parse error
    // here would take down the pane rather than show it a moment later.
    mkdirSync(store.commentDirPath(SCOPE), { recursive: true });
    writeFileSync(store.commentFilePath(SCOPE), '{"prId":42,"comm');
    expect(store.readComments(SCOPE)).toEqual([]);
  });

  it('tolerates a file with no comments key', () => {
    mkdirSync(store.commentDirPath(SCOPE), { recursive: true });
    writeFileSync(store.commentFilePath(SCOPE), '{"prId":42}');
    expect(store.readComments(SCOPE)).toEqual([]);
  });

  it('keeps each pull request separate', () => {
    store.appendComment(SCOPE, comment('a'));
    store.appendComment({ repo: REPO, prId: 99 }, comment('b'));
    expect(store.readComments(SCOPE).map((c) => c.id)).toEqual(['a']);
    expect(
      store.readComments({ repo: REPO, prId: 99 }).map((c) => c.id)
    ).toEqual(['b']);
  });

  /** Every repository has a #7. One repository's drafts showing up in
   *  another's review is not a display glitch: posting them would put
   *  one repository's review text on another's pull request. */
  it('keeps two repositories’ drafts for the same PR number apart', () => {
    const one = store.draftRepoKey('github', { owner: 'acme', repo: 'one' })!;
    const two = store.draftRepoKey('github', { owner: 'acme', repo: 'two' })!;
    store.appendComment({ repo: one, prId: 7 }, comment('from-one'));
    expect(store.readComments({ repo: two, prId: 7 })).toEqual([]);
    expect(store.readComments({ repo: one, prId: 7 }).map((c) => c.id)).toEqual(
      ['from-one']
    );
  });
});

describe('draftRepoKey', () => {
  it('differs between providers for the same names', () => {
    expect(
      store.draftRepoKey('github', { owner: 'acme', repo: 'widgets' })
    ).not.toBe(
      store.draftRepoKey('azure-devops', {
        org: 'acme',
        project: 'widgets',
        repo: 'widgets',
      })
    );
  });

  it('is the same for names that differ only in case', () => {
    // Both providers resolve names case-insensitively, and two checkouts
    // of one repository can carry remotes cased differently.
    expect(store.draftRepoKey('github', { owner: 'Acme', repo: 'N10' })).toBe(
      store.draftRepoKey('github', { owner: 'acme', repo: 'n10' })
    );
  });

  it('ignores project fields that do not name the repository', () => {
    expect(
      store.draftRepoKey('github', {
        owner: 'acme',
        repo: 'widgets',
        username: 'someone',
      })
    ).toBe(store.draftRepoKey('github', { owner: 'acme', repo: 'widgets' }));
  });

  it('is null when there is no repository to post drafts to', () => {
    expect(store.draftRepoKey(undefined, {})).toBeNull();
    expect(store.draftRepoKey('github', { owner: 'acme' })).toBeNull();
    expect(
      store.draftRepoKey('azure-devops', { org: 'acme', repo: 'widgets' })
    ).toBeNull();
    expect(store.draftRepoKey('gitlab', { owner: 'a', repo: 'b' })).toBeNull();
  });

  it('is a key the store accepts as a path segment', () => {
    const key = store.draftRepoKey('github', { owner: 'a', repo: 'b' })!;
    expect(store.isDraftRepoKey(key)).toBe(true);
  });
});

describe('the scope', () => {
  /** The repository key reaches the store from an agent's command line
   *  and the PR id from the desktop's IPC, and both become path
   *  segments under ~/.n10/reviews. */
  it.each([
    { repo: '../../etc', prId: PR },
    { repo: REPO.toUpperCase(), prId: PR },
    { repo: REPO, prId: 0 },
    { repo: REPO, prId: 1.5 },
  ])('refuses to write outside a scope directory: %o', (scope) => {
    expect(() => store.appendComment(scope, comment('x'))).toThrow();
  });
});

describe('appendComment', () => {
  it('creates the directory on the first comment', () => {
    store.appendComment(SCOPE, comment('first'));
    expect(store.readComments(SCOPE).map((c) => c.id)).toEqual(['first']);
  });

  it('adds to what is already there, in order', () => {
    // The agent appends over the course of a review; earlier comments
    // (which the user may have edited) have to survive.
    store.appendComment(SCOPE, comment('one'));
    store.appendComment(SCOPE, comment('two'));
    expect(store.readComments(SCOPE).map((c) => c.id)).toEqual(['one', 'two']);
  });

  it('keeps an edit made between two appends', () => {
    store.appendComment(SCOPE, comment('one'));
    store.updateComment(SCOPE, 'one', { body: 'edited by hand' });
    store.appendComment(SCOPE, comment('two'));

    const stored = store.readComments(SCOPE);
    expect(stored.find((c) => c.id === 'one')?.body).toBe('edited by hand');
    expect(stored).toHaveLength(2);
  });

  it('leaves no temporary file behind', () => {
    // Writes go to a .tmp and are renamed into place, so a reader never
    // sees a partial file. A leftover .tmp means the rename did not
    // happen.
    store.appendComment(SCOPE, comment('one'));
    const entries = readdirSync(store.commentDirPath(SCOPE));
    expect(entries).toEqual(['comments.json']);
  });
});

describe('updateComment', () => {
  it('patches only the given fields', () => {
    store.appendComment(SCOPE, comment('one'));
    expect(store.updateComment(SCOPE, 'one', { body: 'new body' })).toBe(true);

    const stored = store.readComments(SCOPE)[0];
    expect(stored.body).toBe('new body');
    expect(stored.file).toBe('src/a.ts');
    expect(stored.severity).toBe('minor');
  });

  it('reports an unknown id instead of inventing a comment', () => {
    store.appendComment(SCOPE, comment('one'));
    expect(store.updateComment(SCOPE, 'missing', { body: 'x' })).toBe(false);
    expect(store.readComments(SCOPE)).toHaveLength(1);
  });

  it('reports false when there is no file at all', () => {
    expect(store.updateComment(SCOPE, 'one', { body: 'x' })).toBe(false);
  });
});

describe('removeComment', () => {
  it('removes only the one asked for', () => {
    store.appendComment(SCOPE, comment('one'));
    store.appendComment(SCOPE, comment('two'));
    expect(store.removeComment(SCOPE, 'one')).toBe(true);
    expect(store.readComments(SCOPE).map((c) => c.id)).toEqual(['two']);
  });

  it('reports an unknown id rather than clearing the file', () => {
    store.appendComment(SCOPE, comment('one'));
    expect(store.removeComment(SCOPE, 'missing')).toBe(false);
    expect(store.readComments(SCOPE)).toHaveLength(1);
  });
});

describe('the file on disk', () => {
  it('is valid JSON at every point a reader could look', () => {
    // Written to a temporary name and renamed, so a concurrent read
    // sees either the old file or the new one — never a partial write.
    store.appendComment(SCOPE, comment('one'));
    store.appendComment(SCOPE, comment('two'));

    const raw = execFileSync('cat', [store.commentFilePath(SCOPE)], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(raw) as { prId: number; comments: unknown[] };
    expect(parsed.prId).toBe(PR);
    expect(parsed.comments).toHaveLength(2);
  });
});
