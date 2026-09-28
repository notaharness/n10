import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
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
  it('returns nothing when the agent has written nothing yet', async () => {
    expect(await store.readComments(SCOPE)).toEqual([]);
  });

  it('returns nothing rather than throwing on a half-written file', async () => {
    // A reader polls this file while the agent writes it; a parse error
    // here would take down the pane rather than show it a moment later.
    mkdirSync(store.commentDirPath(SCOPE), { recursive: true });
    writeFileSync(store.commentFilePath(SCOPE), '{"prId":42,"comm');
    expect(await store.readComments(SCOPE)).toEqual([]);
  });

  it('tolerates a file with no comments key', async () => {
    mkdirSync(store.commentDirPath(SCOPE), { recursive: true });
    writeFileSync(store.commentFilePath(SCOPE), '{"prId":42}');
    expect(await store.readComments(SCOPE)).toEqual([]);
  });

  it('keeps each pull request separate', async () => {
    await store.appendComment(SCOPE, comment('a'));
    await store.appendComment({ repo: REPO, prId: 99 }, comment('b'));
    expect((await store.readComments(SCOPE)).map((c) => c.id)).toEqual(['a']);
    expect(
      (await store.readComments({ repo: REPO, prId: 99 })).map((c) => c.id)
    ).toEqual(['b']);
  });

  /** Every repository has a #7. One repository's drafts showing up in
   *  another's review is not a display glitch: posting them would put
   *  one repository's review text on another's pull request. */
  it('keeps two repositories’ drafts for the same PR number apart', async () => {
    const one = store.draftRepoKey('github', { owner: 'acme', repo: 'one' })!;
    const two = store.draftRepoKey('github', { owner: 'acme', repo: 'two' })!;
    await store.appendComment({ repo: one, prId: 7 }, comment('from-one'));
    expect(await store.readComments({ repo: two, prId: 7 })).toEqual([]);
    expect(
      (await store.readComments({ repo: one, prId: 7 })).map((c) => c.id)
    ).toEqual(['from-one']);
  });
});

describe('draftRepoKey', () => {
  it('differs between providers for the same names', async () => {
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

  it('is the same for names that differ only in case', async () => {
    // Both providers resolve names case-insensitively, and two checkouts
    // of one repository can carry remotes cased differently.
    expect(store.draftRepoKey('github', { owner: 'Acme', repo: 'N10' })).toBe(
      store.draftRepoKey('github', { owner: 'acme', repo: 'n10' })
    );
  });

  it('ignores project fields that do not name the repository', async () => {
    expect(
      store.draftRepoKey('github', {
        owner: 'acme',
        repo: 'widgets',
        username: 'someone',
      })
    ).toBe(store.draftRepoKey('github', { owner: 'acme', repo: 'widgets' }));
  });

  it('is null when there is no repository to post drafts to', async () => {
    expect(store.draftRepoKey(undefined, {})).toBeNull();
    expect(store.draftRepoKey('github', { owner: 'acme' })).toBeNull();
    expect(
      store.draftRepoKey('azure-devops', { org: 'acme', repo: 'widgets' })
    ).toBeNull();
    expect(store.draftRepoKey('gitlab', { owner: 'a', repo: 'b' })).toBeNull();
  });

  it('is a key the store accepts as a path segment', async () => {
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
  ])('refuses to write outside a scope directory: %o', async (scope) => {
    await expect(store.appendComment(scope, comment('x'))).rejects.toThrow();
  });
});

describe('appendComment', () => {
  it('creates the directory on the first comment', async () => {
    await store.appendComment(SCOPE, comment('first'));
    expect((await store.readComments(SCOPE)).map((c) => c.id)).toEqual([
      'first',
    ]);
  });

  it('adds to what is already there, in order', async () => {
    // The agent appends over the course of a review; earlier comments
    // (which the user may have edited) have to survive.
    await store.appendComment(SCOPE, comment('one'));
    await store.appendComment(SCOPE, comment('two'));
    expect((await store.readComments(SCOPE)).map((c) => c.id)).toEqual([
      'one',
      'two',
    ]);
  });

  it('keeps an edit made between two appends', async () => {
    await store.appendComment(SCOPE, comment('one'));
    await store.updateComment(SCOPE, 'one', { body: 'edited by hand' });
    await store.appendComment(SCOPE, comment('two'));

    const stored = await store.readComments(SCOPE);
    expect(stored.find((c) => c.id === 'one')?.body).toBe('edited by hand');
    expect(stored).toHaveLength(2);
  });

  it('leaves neither a temporary file nor its lock behind', async () => {
    // Writes go to a .tmp and are renamed into place, so a reader never
    // sees a partial file. A leftover .tmp means the rename did not
    // happen; a leftover .lock would stall the next writer.
    await store.appendComment(SCOPE, comment('one'));
    const entries = readdirSync(store.commentDirPath(SCOPE));
    expect(entries).toEqual(['comments.json']);
  });

  it('takes over a lock left by a writer that died holding it', async () => {
    const lock = `${store.commentFilePath(SCOPE)}.lock`;
    mkdirSync(store.commentDirPath(SCOPE), { recursive: true });
    // A process that has exited, as a writer killed mid-write would be.
    const { pid } = spawnSync(process.execPath, ['-e', '']);
    writeFileSync(lock, JSON.stringify({ host: hostname(), pid, id: 'x' }));

    await store.appendComment(SCOPE, comment('one'));
    expect((await store.readComments(SCOPE)).map((c) => c.id)).toEqual(['one']);
    expect(existsSync(lock)).toBe(false);
  });
});

/**
 * Review agents append through their own `n10 util add-comment`
 * processes while the TUI or the desktop edits and posts, so two
 * processes can be inside a read-modify-write at once. Real processes,
 * because the store is synchronous: nothing within one can interleave.
 */
describe('concurrent writers', () => {
  const storeSource = fileURLToPath(
    new URL('./comment-store.ts', import.meta.url)
  );

  /**
   * A process that appends `id`. Its reads of the drafts file stop
   * after reading until `go` exists, which holds a writer between its
   * read and its write for as long as the test needs it there; `read-<id>`
   * says that it has read.
   */
  function writer(bundle: string, id: string) {
    const code = `
      import fs from 'node:fs';
      import fsp from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const read = fsp.readFile;
      fsp.readFile = async function (path, ...rest) {
        const value = await read.call(this, path, ...rest);
        if (String(path).endsWith('comments.json')) {
          fs.writeFileSync(${JSON.stringify(
            join(home, 'read-')
          )} + ${JSON.stringify(id)}, '');
          while (!fs.existsSync(${JSON.stringify(join(home, 'go'))})) {
            await new Promise((r) => setTimeout(r, 5));
          }
        }
        return value;
      };
      syncBuiltinESMExports();
      const { appendComment } = await import(${JSON.stringify(bundle)});
      await appendComment(${JSON.stringify(SCOPE)}, ${JSON.stringify(
      comment(id)
    )});
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, HOME: home },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    return new Promise<{ code: number | null; stderr: string }>((resolve) =>
      child.on('close', (code) => resolve({ code, stderr }))
    );
  }

  const until = async (done: () => boolean, ms: number) => {
    const deadline = Date.now() + ms;
    while (!done() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it('keeps both comments when two processes append at once', async () => {
    const bundle = join(home, 'comment-store.mjs');
    await build({
      entryPoints: [storeSource],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    // The file has to exist for a writer to be held after reading it.
    await store.appendComment(SCOPE, comment('seed'));

    const hasRead = (id: string) => existsSync(join(home, `read-${id}`));
    const writers = [writer(bundle, 'one'), writer(bundle, 'two')];
    // Without a lock both read the same snapshot and wait here; with
    // one, the second is still waiting for the lock when this gives up.
    await until(() => hasRead('one') || hasRead('two'), 5_000);
    await until(() => hasRead('one') && hasRead('two'), 500);
    writeFileSync(join(home, 'go'), '');

    for (const result of await Promise.all(writers)) {
      expect(result).toEqual({ code: 0, stderr: '' });
    }
    expect((await store.readComments(SCOPE)).map((c) => c.id).sort()).toEqual([
      'one',
      'seed',
      'two',
    ]);
  }, 20_000);

  /** The TUI and the desktop host take this lock on the thread that
   *  draws the UI and answers everything else; waiting for another
   *  writer must leave it free to. */
  it('keeps the event loop running while another writer holds the lock', async () => {
    const lock = `${store.commentFilePath(SCOPE)}.lock`;
    mkdirSync(store.commentDirPath(SCOPE), { recursive: true });
    // A live writer, mid-transaction.
    writeFileSync(
      lock,
      JSON.stringify({ host: hostname(), pid: process.ppid, id: 'writer' })
    );

    let settled = false;
    const append = store
      .appendComment(SCOPE, comment('waiting'))
      .finally(() => (settled = true));
    let ticksWhileWaiting = 0;
    const ticker = setInterval(() => {
      if (!settled) ticksWhileWaiting += 1;
    }, 5);
    try {
      await new Promise((r) => setTimeout(r, 100));
      expect(settled).toBe(false);
      expect(ticksWhileWaiting).toBeGreaterThan(5);

      rmSync(lock); // The other writer finishes.
      await append;
      expect((await store.readComments(SCOPE)).map((c) => c.id)).toEqual([
        'waiting',
      ]);
    } finally {
      clearInterval(ticker);
    }
  });
});

describe('updateComment', () => {
  it('patches only the given fields', async () => {
    await store.appendComment(SCOPE, comment('one'));
    expect(await store.updateComment(SCOPE, 'one', { body: 'new body' })).toBe(
      true
    );

    const stored = (await store.readComments(SCOPE))[0];
    expect(stored.body).toBe('new body');
    expect(stored.file).toBe('src/a.ts');
    expect(stored.severity).toBe('minor');
  });

  it('reports an unknown id instead of inventing a comment', async () => {
    await store.appendComment(SCOPE, comment('one'));
    expect(await store.updateComment(SCOPE, 'missing', { body: 'x' })).toBe(
      false
    );
    expect(await store.readComments(SCOPE)).toHaveLength(1);
  });

  it('reports false when there is no file at all', async () => {
    expect(await store.updateComment(SCOPE, 'one', { body: 'x' })).toBe(false);
  });
});

describe('removeComment', () => {
  it('removes only the one asked for', async () => {
    await store.appendComment(SCOPE, comment('one'));
    await store.appendComment(SCOPE, comment('two'));
    expect(await store.removeComment(SCOPE, 'one')).toBe(true);
    expect((await store.readComments(SCOPE)).map((c) => c.id)).toEqual(['two']);
  });

  it('reports an unknown id rather than clearing the file', async () => {
    await store.appendComment(SCOPE, comment('one'));
    expect(await store.removeComment(SCOPE, 'missing')).toBe(false);
    expect(await store.readComments(SCOPE)).toHaveLength(1);
  });
});

describe('the file on disk', () => {
  it('is valid JSON at every point a reader could look', async () => {
    // Written to a temporary name and renamed, so a concurrent read
    // sees either the old file or the new one — never a partial write.
    await store.appendComment(SCOPE, comment('one'));
    await store.appendComment(SCOPE, comment('two'));

    const raw = execFileSync('cat', [store.commentFilePath(SCOPE)], {
      encoding: 'utf8',
    });
    const parsed = JSON.parse(raw) as { prId: number; comments: unknown[] };
    expect(parsed.prId).toBe(PR);
    expect(parsed.comments).toHaveLength(2);
  });
});

/**
 * What the TUI's diff viewer shows the agent's drafts through while the
 * review runs. The common case is the hard one: the PR is opened before
 * the agent has written anything, so there is nothing on disk yet to
 * watch.
 */
describe('watchComments', () => {
  const changes = () => {
    const seen = { count: 0 };
    return { seen, onChange: () => (seen.count += 1) };
  };
  const until = async (done: () => boolean) => {
    const deadline = Date.now() + 2_000;
    while (!done() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it('reports the first draft written after watching a PR with none', async () => {
    const { seen, onChange } = changes();
    const unwatch = store.watchComments(SCOPE, onChange);
    try {
      await store.appendComment(SCOPE, comment('first'));
      await until(() => seen.count > 0);
      expect(seen.count).toBeGreaterThan(0);
    } finally {
      unwatch();
    }
  });

  it('reports a draft written by another process', async () => {
    // A review with drafts already: the PR's directory exists.
    mkdirSync(store.commentDirPath(SCOPE), { recursive: true });
    const { seen, onChange } = changes();
    const unwatch = store.watchComments(SCOPE, onChange);
    await new Promise((r) => setTimeout(r, 50));
    seen.count = 0;
    try {
      // The agent's `add-comment` replaces the file by rename.
      writeFileSync(`${store.commentFilePath(SCOPE)}.tmp`, '{}');
      execFileSync('mv', [
        `${store.commentFilePath(SCOPE)}.tmp`,
        store.commentFilePath(SCOPE),
      ]);
      await until(() => seen.count > 0);
      expect(seen.count).toBeGreaterThan(0);
    } finally {
      unwatch();
    }
  });

  /** The TUI watches the PR under the sidebar cursor, reviewed or
   *  not; that must not leave a directory behind for each one. */
  it('creates no directory for a PR it only looked at', () => {
    const unwatch = store.watchComments(SCOPE, () => undefined);
    unwatch();
    expect(existsSync(store.commentDirPath(SCOPE))).toBe(false);
  });

  it('stops reporting once unwatched', async () => {
    const { seen, onChange } = changes();
    store.watchComments(SCOPE, onChange)();
    await store.appendComment(SCOPE, comment('after'));
    await new Promise((r) => setTimeout(r, 200));
    expect(seen.count).toBe(0);
  });
});
