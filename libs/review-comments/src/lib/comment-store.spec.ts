import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CommentStore from './comment-store.js';
import type { ReviewComment } from './types.js';

/**
 * Where a review agent's comments live between being written and being
 * posted, and how they are read. Writes go through `@n10/core`'s
 * `changeAgentComments`, which locks the file across processes.
 *
 * The reader — the TUI's viewer or the desktop, which polls it — must
 * tolerate a file that is missing or mid-write.
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

function write(repository: string, prId: number, comments: ReviewComment[]) {
  mkdirSync(store.commentDirPath(repository, prId), { recursive: true });
  writeFileSync(
    store.commentFilePath(repository, prId),
    JSON.stringify({ prId, comments })
  );
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
    write('/repo', PR, [comment('a')]);
    write('/repo', 99, [comment('b')]);
    expect(store.readComments('/repo', PR).map((c) => c.id)).toEqual(['a']);
    expect(store.readComments('/repo', 99).map((c) => c.id)).toEqual(['b']);
  });
});

it('isolates equal PR numbers by repository', () => {
  write('/first/.git', PR, [comment('first')]);
  write('/second/.git', PR, [comment('second')]);
  expect(store.readComments('/first/.git', PR).map((item) => item.id)).toEqual([
    'first',
  ]);
  expect(store.readComments('/second/.git', PR).map((item) => item.id)).toEqual(
    ['second']
  );
});
