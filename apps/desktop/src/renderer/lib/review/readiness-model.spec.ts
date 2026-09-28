import { describe, expect, it } from 'vitest';
import type { PullRequestCheck } from '@n10/vcs-core';
import type {
  CheckList,
  PullRequestReadiness,
} from '../../../host/contract.js';
import {
  checksLabel,
  duration,
  failureText,
  headline,
  outcomeText,
} from './readiness-model.js';

/** The Completion section's words for what core decided. */

function readiness(over: Partial<PullRequestReadiness>): PullRequestReadiness {
  return {
    state: 'unknown',
    blockers: [],
    advisories: [],
    unknowns: [],
    aspects: [],
    ...over,
  };
}

describe('headline', () => {
  it('says ready in the provider’s own verb, and only when core says ready', () => {
    const ready = readiness({ state: 'ready' });
    expect(headline(ready, 'github').text).toBe('Ready to merge');
    expect(headline(ready, 'azure-devops').text).toBe('Ready to complete');
  });

  it('leads with the strongest blocker', () => {
    const blocked = readiness({
      state: 'blocked',
      blockers: [
        { kind: 'draft', text: 'Draft', resolvedBy: 'author' },
        { kind: 'conflicts', text: 'Conflicts', resolvedBy: 'author' },
      ],
    });
    expect(headline(blocked, 'github')).toEqual({
      text: 'Draft',
      detail: null,
    });
  });

  it('says what it does not know, never ready', () => {
    const unknown = readiness({
      unknowns: ['Branch rules', 'The review requirement'],
    });
    expect(headline(unknown, 'github')).toEqual({
      text: 'Readiness not fully known',
      detail: 'Not known: branch rules, the review requirement',
    });
    // Blockers core names do not make it blocked where the provider
    // has not said so.
    const named = readiness({
      blockers: [
        { kind: 'conflicts', text: 'Conflicts', resolvedBy: 'author' },
      ],
    });
    expect(headline(named, 'github').text).toBe('Readiness not fully known');
  });
});

describe('failureText', () => {
  it('gives the provider’s reason, and when to try again where it said', () => {
    const failed = {
      state: 'failed',
      kind: 'throttled',
      reason: 'Rate limited',
    } as const;
    expect(failureText(failed)).toBe('Rate limited');
    expect(failureText({ ...failed, retryAfterMs: 30_000 })).toBe(
      'Rate limited (try again in 30 s)'
    );
    expect(failureText({ ...failed, retryAfterMs: 150_000 })).toBe(
      'Rate limited (try again in 3 min)'
    );
  });
});

describe('check words', () => {
  const check = (over: Partial<PullRequestCheck>) =>
    ({ outcome: 'succeeded', native: null, ...over } as PullRequestCheck);

  it('says how long a check ran, where both ends are known', () => {
    const at = (s: string) => `2026-09-26T10:${s}Z`;
    expect(
      duration(check({ startedAt: at('00:00'), completedAt: at('02:31') }))
    ).toBe('2m 31s');
    expect(
      duration(check({ startedAt: at('00:00'), completedAt: at('00:48') }))
    ).toBe('48s');
    expect(duration(check({ startedAt: at('00:00'), completedAt: null }))).toBe(
      null
    );
  });

  it('keeps the provider’s word for an outcome n10 does not know', () => {
    expect(outcomeText(check({ outcome: 'unknown', native: 'STALE' }))).toBe(
      'STALE'
    );
    expect(outcomeText(check({ outcome: 'queued', manual: true }))).toBe(
      'Not started'
    );
  });
});

describe('checksLabel', () => {
  const list = (over: Partial<CheckList>): CheckList => ({
    rows: Array.from({ length: 3 }, () => ({} as CheckList['rows'][number])),
    count: { passed: 1 } as CheckList['count'],
    stale: 0,
    total: 3,
    complete: true,
    ...over,
  });

  it('counts what passed of what there is, and of what was read where not all was', () => {
    expect(checksLabel(list({}))).toBe('View checks · 1 of 3 passed');
    expect(checksLabel(list({ complete: false, total: 5 }))).toBe(
      'View checks · 1 of 3 passed · 3 of 5 read'
    );
    expect(checksLabel(list({ complete: false, total: null }))).toBe(
      'View checks · 1 of 3 passed · not all read'
    );
    expect(checksLabel(list({ rows: [] }))).toBe('No checks reported');
    // A list that stopped short with nothing in it is not "none".
    expect(checksLabel(list({ rows: [], complete: false, total: null }))).toBe(
      'Checks not all read'
    );
  });

  it('says how many reported on an older push', () => {
    expect(checksLabel(list({ stale: 1 }))).toBe(
      'View checks · 1 of 3 passed, 1 on an older revision'
    );
  });
});
