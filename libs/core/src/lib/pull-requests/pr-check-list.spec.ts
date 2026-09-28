import { describe, expect, it } from 'vitest';
import type {
  ListRead,
  PullRequestCheck,
  PullRequestChecks,
} from '@n10/vcs-core';
import { checkList } from './pr-check-list.js';

/** The checks as a list to read: standing, staleness and order. */

const HEAD = '1'.repeat(40);
const OLD = '2'.repeat(40);

function check(
  name: string,
  outcome: PullRequestCheck['outcome'],
  over: Partial<PullRequestCheck> = {}
): PullRequestCheck {
  return {
    key: `check:${name}:${outcome}`,
    kind: 'check',
    requires: null,
    name,
    group: null,
    source: null,
    outcome,
    native: null,
    requirement: 'required',
    revision: HEAD,
    ranOn: null,
    startedAt: null,
    completedAt: null,
    attempt: null,
    url: null,
    ...over,
  };
}

function checks(
  items: PullRequestCheck[],
  list: { total?: number | null; complete?: boolean } = {}
): PullRequestChecks {
  return {
    ref: {
      provider: 'github',
      host: 'github.com',
      repository: 'a/b',
      number: 1,
    },
    head: HEAD,
    checks: {
      state: 'read',
      value: {
        items,
        total: list.total === undefined ? items.length : list.total,
        complete: list.complete ?? true,
      } as ListRead<PullRequestCheck>,
    },
    rules: { state: 'unsupported', reason: 'x' },
    merge: {
      lifecycle: { state: 'open', isDraft: false, native: 'OPEN' },
      conflicts: 'none',
      behind: false,
      blocked: false,
      reviews: 'approved',
      conversations: null,
      native: 'CLEAN',
    },
  };
}

describe('checkList', () => {
  it('puts what blocks first, then what waits, then the rest', () => {
    const list = checkList(
      checks([
        check('docs', 'skipped', { requirement: 'optional' }),
        check('lint', 'succeeded'),
        check('preview', 'failed', { requirement: 'optional' }),
        check('e2e', 'expected', { revision: null }),
        check('build', 'failed'),
        check('deploy', 'running', { requirement: 'optional' }),
        check('audit', 'unknown'),
        check('fmt', 'cancelled', { requirement: 'unknown' }),
      ])
    );
    expect(list?.rows.map((r) => [r.check.name, r.standing])).toEqual([
      ['build', 'blocking'],
      ['e2e', 'waiting'],
      ['audit', 'unknown'],
      ['fmt', 'advisory'],
      ['preview', 'advisory'],
      ['lint', 'passed'],
      ['deploy', 'neutral'],
      ['docs', 'neutral'],
    ]);
    expect(list?.count).toEqual({
      blocking: 1,
      waiting: 1,
      unknown: 1,
      advisory: 2,
      passed: 1,
      neutral: 2,
    });
  });

  it('marks a result on an older revision as stale, and an expected one as not', () => {
    const list = checkList(
      checks([
        check('build', 'succeeded', { revision: OLD }),
        check('lint', 'succeeded'),
        check('e2e', 'expected', { revision: null }),
      ])
    );
    expect(
      Object.fromEntries(list?.rows.map((r) => [r.check.name, r.stale]) ?? [])
    ).toEqual({ build: true, lint: false, e2e: false });
  });

  it('keeps two checks of one name apart, in a stable order', () => {
    const list = checkList(
      checks([
        check('build', 'succeeded', { key: 'check:2' }),
        check('build', 'succeeded', { key: 'check:1' }),
      ])
    );
    expect(list?.rows.map((r) => r.check.key)).toEqual(['check:1', 'check:2']);
  });

  it('carries a partial list’s total, and has none where the checks were not read', () => {
    expect(
      checkList(
        checks([check('a', 'succeeded')], { total: 30, complete: false })
      )
    ).toMatchObject({ total: 30, complete: false });
    const unread = checks([]);
    unread.checks = { state: 'failed', kind: 'network', reason: 'offline' };
    expect(checkList(unread)).toBeNull();
  });
});
