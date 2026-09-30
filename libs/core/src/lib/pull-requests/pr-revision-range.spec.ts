import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * How revisions a clone lacks are fetched. Over GitHub's transport a
 * fetch naming several commits fails whole when one is gone, bringing
 * none of them; a local remote does not behave that way, so the calls
 * themselves are what is checked here.
 */

const fetched = vi.hoisted(() => [] as (readonly string[] | 'all')[]);
vi.mock('../sync/fetch-queue.js', () => ({
  fetchRefs: (req: { refs: readonly string[] | 'all' }) => {
    fetched.push(req.refs);
    return Promise.resolve(false);
  },
}));

const { resolveRevisionRange } = await import('./pr-revision-range.js');

let repo: string;
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'n10-range-unit-'));
  execFileSync('git', ['init', '-q', repo]);
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('fetching revisions the clone lacks', () => {
  it('asks for each by itself, so one that is gone costs no other', async () => {
    const [from, to, target] = ['a', 'b', 'c'].map((c) => c.repeat(40));
    const result = await resolveRevisionRange({ cwd: repo, from, to, target });
    expect(fetched).toEqual([[from], [to], [target]]);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'from-unavailable', oid: from, fetchFailed: true },
    });
  });
});
