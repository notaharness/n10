import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PullRequestRef } from '@n10/vcs-core';
import { __resetFetchQueueForTests } from '../sync/fetch-queue.js';
import { recordPullRequestVisit } from './pr-history.js';
import {
  readRevisionRangeManifest,
  resolveRevisionRange,
  retainRevisions,
  type RevisionRangeResult,
} from './pr-revision-range.js';
import { VisitBaselines } from './review-checkpoints.js';

/**
 * Revision ranges against real git, over the spec's Q3 sequence: a push,
 * the target advancing and merged in, a force-push to unrelated history,
 * and a revision that is nowhere any more. The upstream repository plays
 * the provider and a clone of it plays n10's checkout.
 */

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@n10.dev');
  git(dir, 'config', 'user.name', 'n10 Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  // As GitHub does: a commit it still has can be fetched by id, even
  // one a force-push left reachable from no branch.
  git(dir, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
}

function commit(dir: string, path: string, text: string, message: string) {
  writeFileSync(join(dir, path), text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}

function rangeOf(result: RevisionRangeResult) {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.range;
}

const REF: PullRequestRef = {
  provider: 'github',
  host: 'github.com',
  repository: 'n10/fixture',
  number: 42,
};

describe('resolveRevisionRange over a revision sequence', () => {
  let root: string;
  let upstream: string;
  let clone: string;
  const oid: Record<string, string> = {};

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'n10-pr-revisions-'));
    upstream = join(root, 'upstream');
    clone = join(root, 'clone');
    initRepo(upstream);
    oid.B1 = commit(upstream, 'base.txt', 'base 1\n', 'B1');
    git(upstream, 'checkout', '-q', '-b', 'feature');
    oid.H1 = commit(upstream, 'a.txt', 'one\n', 'H1');
    git(root, 'clone', '-q', upstream, clone);

    // Pushed after the clone fetched.
    oid.H2 = commit(upstream, 'b.txt', 'two\n', 'H2');
    // H2 amended in place: rewritten on the same base.
    git(upstream, 'checkout', '-q', '-b', 'amended');
    git(upstream, 'commit', '-q', '--amend', '-m', 'H2, reworded');
    oid.H2r = git(upstream, 'rev-parse', 'HEAD');
    // The target advances…
    git(upstream, 'checkout', '-q', 'main');
    oid.B2 = commit(upstream, 'base.txt', 'base 2\n', 'B2');
    // …H2 rebased onto it…
    git(upstream, 'checkout', '-q', '-b', 'rebased', oid.H2);
    git(upstream, 'rebase', '-q', 'main');
    oid.H2b = git(upstream, 'rev-parse', 'HEAD');
    // …and the branch merges it in.
    git(upstream, 'checkout', '-q', 'feature');
    git(upstream, 'merge', '-q', '--no-edit', 'main');
    oid.H3 = git(upstream, 'rev-parse', 'HEAD');
    // A force-push onto history that shares nothing with the old.
    git(upstream, 'checkout', '-q', '--orphan', 'rewrite');
    git(upstream, 'rm', '-q', '-rf', '.');
    oid.H4 = commit(upstream, 'c.txt', 'rewritten\n', 'H4');
    oid.H5 = commit(upstream, 'c.txt', 'rewritten again\n', 'H5');
    git(upstream, 'branch', '-q', '-f', 'feature', 'rewrite');
    git(upstream, 'checkout', '-q', 'feature');
    git(upstream, 'branch', '-q', '-D', 'rewrite');
  });

  beforeEach(() => __resetFetchQueueForTests());

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reads a push since the last revision as the commits it added', async () => {
    const range = rangeOf(
      await resolveRevisionRange({
        cwd: clone,
        from: oid.H1!,
        to: oid.H2!,
        target: oid.B1!,
      })
    );
    // H2 was not in the clone: fetched by id, not by branch.
    expect(range).toEqual({
      fromOid: oid.H1,
      toOid: oid.H2,
      linear: true,
      backwards: false,
      base: { state: 'unchanged' },
    });
  });

  it('reads a range run back in time as backwards, not a rewrite', async () => {
    const range = rangeOf(
      await resolveRevisionRange({
        cwd: clone,
        from: oid.H2!,
        to: oid.H1!,
        target: oid.B1!,
      })
    );
    expect(range).toMatchObject({ linear: false, backwards: true });
  });

  it('does not count a target that moved on without the branch', async () => {
    const range = rangeOf(
      await resolveRevisionRange({
        cwd: clone,
        from: oid.H1!,
        to: oid.H2!,
        target: oid.B2!,
      })
    );
    expect(range).toMatchObject({ linear: true, base: { state: 'unchanged' } });
  });

  it('reads a rewrite on the same base as not linear, the base unmoved', async () => {
    const range = rangeOf(
      await resolveRevisionRange({
        cwd: clone,
        from: oid.H2!,
        to: oid.H2r!,
        target: oid.B2!,
      })
    );
    expect(range).toMatchObject({
      linear: false,
      backwards: false,
      base: { state: 'unchanged' },
    });
  });

  it('reads a rebase onto the moved target as not linear, the base moved', async () => {
    const range = rangeOf(
      await resolveRevisionRange({
        cwd: clone,
        from: oid.H2!,
        to: oid.H2b!,
        target: oid.B2!,
      })
    );
    expect(range).toMatchObject({ linear: false, base: { state: 'moved' } });
  });

  it('says why it cannot tell whether the base moved', async () => {
    const range = (target: string | null) =>
      resolveRevisionRange({ cwd: clone, from: oid.H1!, to: oid.H2!, target });
    expect(rangeOf(await range(null)).base).toEqual({
      state: 'unknown',
      reason: 'no-target',
    });
    expect(rangeOf(await range('d'.repeat(40))).base).toEqual({
      state: 'unknown',
      reason: 'target-unavailable',
    });
  });

  it('says when the target’s own changes came in between', async () => {
    const range = rangeOf(
      await resolveRevisionRange({
        cwd: clone,
        from: oid.H2!,
        to: oid.H3!,
        target: oid.B2!,
      })
    );
    expect(range).toMatchObject({ linear: true, base: { state: 'moved' } });
  });

  it('reads across a force-push as two trees, not as new commits', async () => {
    const range = rangeOf(
      await resolveRevisionRange({
        cwd: clone,
        from: oid.H3!,
        to: oid.H4!,
        target: oid.B2!,
      })
    );
    // H4 shares no history with the target: whether it moved is unknown.
    expect(range).toMatchObject({
      linear: false,
      base: { state: 'unknown', reason: 'no-merge-base' },
    });
  });

  it('does not call a base unchanged when neither revision meets the target', async () => {
    const range = rangeOf(
      await resolveRevisionRange({
        cwd: clone,
        from: oid.H4!,
        to: oid.H5!,
        target: oid.B2!,
      })
    );
    expect(range).toMatchObject({
      linear: true,
      base: { state: 'unknown', reason: 'no-merge-base' },
    });
  });

  it('lists the files changed between two revisions, and no others', async () => {
    const result = await readRevisionRangeManifest({
      cwd: clone,
      from: oid.H1!,
      to: oid.H2!,
      target: oid.B1!,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.manifest.files.map((f) => f.path)).toEqual(['b.txt']);
    expect(result.manifest.comparison).toMatchObject({
      mergeBaseOid: oid.H1,
      headOid: oid.H2,
    });
  });

  it('lists the target’s own changes when they came in between', async () => {
    const result = await readRevisionRangeManifest({
      cwd: clone,
      from: oid.H2!,
      to: oid.H3!,
      target: oid.B2!,
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.range.base).toEqual({ state: 'moved' });
    expect(result.manifest.files.map((f) => f.path)).toEqual(['base.txt']);
  });

  it('lists nothing for a revision it cannot find', async () => {
    const result = await readRevisionRangeManifest({
      cwd: clone,
      from: 'f'.repeat(40),
      to: oid.H1!,
      target: oid.B1!,
      fetch: false,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'from-unavailable' },
    });
  });

  it('names a revision that is nowhere, rather than reading another', async () => {
    const gone = 'f'.repeat(40);
    const result = await resolveRevisionRange({
      cwd: clone,
      from: gone,
      to: oid.H1!,
      target: null,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'from-unavailable',
        message:
          'Revision fffffff is not in this clone, and fetching it failed: the provider may no longer have it, or could not be reached.',
        oid: gone,
        fetchFailed: true,
      },
    });
  });

  it('names the revision that is gone, and still fetches the one that is not', async () => {
    const fresh = join(root, 'fresh');
    git(root, 'clone', '-q', '--single-branch', '-b', 'main', upstream, fresh);
    const result = await resolveRevisionRange({
      cwd: fresh,
      from: oid.H2!,
      to: 'e'.repeat(40),
      target: null,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'to-unavailable', oid: 'e'.repeat(40) },
    });
    expect(git(fresh, 'cat-file', '-t', oid.H2!)).toBe('commit');
  });

  it('does not claim the provider lacks what it was never asked for', async () => {
    const result = await resolveRevisionRange({
      cwd: clone,
      from: oid.H1!,
      to: 'e'.repeat(40),
      target: null,
      fetch: false,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'to-unavailable',
        message: 'Revision eeeeeee is not in this clone.',
      },
    });
  });

  it('refuses what is not an object id', async () => {
    const result = await resolveRevisionRange({
      cwd: clone,
      from: 'HEAD~1',
      to: oid.H1!,
      target: null,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' },
    });
  });
});

describe('retainRevisions', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'n10-pr-retain-'));
    initRepo(repo);
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const exists = (oid: string) => {
    try {
      git(repo, 'cat-file', '-e', `${oid}^{commit}`);
      return true;
    } catch {
      return false;
    }
  };

  it('keeps a reviewed head through garbage collection after a force-push', async () => {
    commit(repo, 'x.txt', 'base\n', 'base');
    const reviewed = commit(repo, 'x.txt', 'reviewed\n', 'reviewed');
    const dropped = commit(repo, 'x.txt', 'dropped\n', 'dropped');
    await retainRevisions(repo, REF, 'octocat', [reviewed]);
    // Rewrite the branch past both, and forget every other trace.
    git(repo, 'reset', '-q', '--hard', 'HEAD~2');
    git(repo, 'reflog', 'expire', '--expire=now', '--all');
    git(repo, 'gc', '-q', '--prune=now');
    expect(exists(reviewed)).toBe(true);
    expect(exists(dropped)).toBe(false);
  });

  it('holds exactly the set it is given, per account and pull request', async () => {
    const a = commit(repo, 'y.txt', 'a\n', 'a');
    const b = commit(repo, 'y.txt', 'b\n', 'b');
    await retainRevisions(repo, REF, 'octocat', [a, b]);
    await retainRevisions(repo, REF, 'someone-else', [a]);
    await retainRevisions(repo, REF, 'octocat', [b]);
    const refs = git(
      repo,
      'for-each-ref',
      '--format=%(objectname)',
      'refs/n10/'
    )
      .split('\n')
      .sort();
    // octocat now holds b only; someone-else still holds a.
    expect(refs).toEqual([a, b].sort());
  });
});

describe('recordPullRequestVisit', () => {
  let repo: string;
  let store: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'n10-pr-visit-'));
    store = mkdtempSync(join(tmpdir(), 'n10-pr-visit-store-'));
    initRepo(repo);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(store, { recursive: true, force: true });
  });

  it('keeps every head a later comparison may start from', async () => {
    const base = commit(repo, 'v.txt', 'base\n', 'base');
    const reviewed = commit(repo, 'v.txt', 'reviewed\n', 'reviewed');
    const earlier = commit(repo, 'v.txt', 'earlier\n', 'earlier');
    const src = {
      cwd: repo,
      repository: () => REF,
      viewer: () => 'octocat',
      baselines: new VisitBaselines(store),
    };
    const at = (visitId: string, head: string) => ({
      ref: REF,
      visitId,
      visit: { head, target: base, mergeBase: base },
    });
    const visit = async (visitId: string, head: string) => {
      src.baselines.lastVisit(REF, 'octocat', visitId);
      await recordPullRequestVisit(at(visitId, head), src);
    };
    src.baselines.lastVisit(REF, 'octocat', 'v1');
    await recordPullRequestVisit({ ...at('v1', earlier), reviewed }, src);
    // One long visit that moves through more heads than the record
    // keeps: its baseline, `earlier`, falls out of the kept visits and
    // must still be held.
    const later: string[] = [];
    for (let i = 0; i < 11; i++) {
      later.push(commit(repo, 'v.txt', `later ${i}\n`, `later ${i}`));
      await visit('v2', later[i]!);
    }
    const refs = git(
      repo,
      'for-each-ref',
      '--format=%(objectname)',
      'refs/n10/'
    )
      .split('\n')
      .sort();
    expect(refs).toEqual([reviewed, earlier, ...later.slice(1)].sort());
  });

  it('refuses another repository’s pull request before writing anything', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'n10-pr-visit-store-'));
    const src = {
      cwd: repo,
      repository: () => ({ ...REF, repository: 'n10/other' }),
      viewer: () => 'octocat',
      baselines: new VisitBaselines(empty),
    };
    src.baselines.lastVisit(REF, 'octocat', 'v9');
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(
      recordPullRequestVisit(
        {
          ref: REF,
          visitId: 'v9',
          visit: { head, target: head, mergeBase: head },
        },
        src
      )
    ).rejects.toThrow('is not in github.com/n10/other');
    expect(readdirSync(empty)).toEqual([]);
    rmSync(empty, { recursive: true });
  });

  it('records a visit only after its history was read', async () => {
    const head = git(repo, 'rev-parse', 'HEAD');
    const src = {
      cwd: repo,
      repository: () => REF,
      viewer: () => 'octocat',
      baselines: new VisitBaselines(store),
    };
    await expect(
      recordPullRequestVisit(
        {
          ref: { ...REF, id: 'R_claimed' },
          visitId: 'unread',
          visit: { head, target: head, mergeBase: head },
        },
        src
      )
    ).rejects.toThrow('after its pull request history is read');
  });
});
