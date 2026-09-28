import { describe, expect, it } from 'vitest';
import type { PullRequestCheck } from '@n10/vcs-core';
import type {
  CheckList,
  PullRequestReadiness,
} from '../../../host/contract.js';
import {
  checksLabel,
  duration,
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
    const unknown = readiness({ unknowns: ['Branch rules', 'Checks'] });
    expect(headline(unknown, 'github')).toEqual({
      text: 'Readiness not fully known',
      detail: 'Not known: Branch rules, Checks',
    });
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
    total: 3,
    complete: true,
    ...over,
  });

  it('counts what passed of what there is, and of what was read where not all was', () => {
    expect(checksLabel(list({}))).toBe('View checks · 1 of 3 passed');
    expect(checksLabel(list({ complete: false, total: 5 }))).toBe(
      'View checks · 1 passed · 3 of 5 read'
    );
    expect(checksLabel(list({ complete: false, total: null }))).toBe(
      'View checks · 1 passed · not all read'
    );
    expect(checksLabel(list({ rows: [] }))).toBe('No checks reported');
  });
});
