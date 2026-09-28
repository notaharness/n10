import { describe, expect, it } from 'vitest';
import type { MergeState, PullRequestCheck } from '@n10/vcs-core';
import { evaluateReadiness, type ReadinessInputs } from './pr-readiness.js';

/** Each readiness row on its own, as the Completion section shows it. */

const CLEAN: MergeState = {
  lifecycle: { state: 'open', isDraft: false, native: 'OPEN' },
  conflicts: 'none',
  behind: false,
  blocked: false,
  reviews: 'approved',
  conversations: null,
  native: 'CLEAN',
};

function check(
  name: string,
  outcome: PullRequestCheck['outcome'],
  over: Partial<PullRequestCheck> = {}
): PullRequestCheck {
  return {
    key: `check:${name}`,
    kind: 'check',
    requires: null,
    name,
    group: null,
    source: null,
    outcome,
    native: null,
    requirement: 'required',
    revision: 'a'.repeat(40),
    ranOn: null,
    startedAt: null,
    completedAt: null,
    attempt: null,
    url: null,
    ...over,
  };
}

function inputs(over: Partial<ReadinessInputs> = {}): ReadinessInputs {
  return {
    merge: CLEAN,
    checks: {
      state: 'read',
      value: { items: [check('test', 'succeeded')], total: 1, complete: true },
    },
    rules: {
      state: 'read',
      value: { requiredChecks: [], conversationResolution: true },
    },
    unresolvedThreads: 0,
    ...over,
  };
}

function aspect(i: ReadinessInputs, id: string) {
  const found = evaluateReadiness(i).aspects.find((a) => a.id === id);
  return found && { state: found.state, text: found.text };
}

const listed = (...items: PullRequestCheck[]): ReadinessInputs['checks'] => ({
  state: 'read',
  value: { items, total: items.length, complete: true },
});

describe('readiness aspects', () => {
  it('reads the lifecycle', () => {
    const draft = {
      ...CLEAN,
      lifecycle: { ...CLEAN.lifecycle, isDraft: true },
    };
    expect(aspect(inputs({ merge: draft }), 'lifecycle')).toEqual({
      state: 'blocked',
      text: 'Draft',
    });
  });

  it('reads the review requirement, moot where the provider is clear', () => {
    const reviews = (r: MergeState['reviews'], blocked: boolean | null) =>
      aspect(inputs({ merge: { ...CLEAN, reviews: r, blocked } }), 'reviews');
    expect(reviews('required', true)).toEqual({
      state: 'waiting',
      text: 'Waiting for review',
    });
    expect(reviews('changes-requested', true)).toEqual({
      state: 'blocked',
      text: 'Changes requested',
    });
    expect(reviews('not-required', false)?.state).toBe('met');
    expect(reviews('unknown', true)).toEqual({
      state: 'unknown',
      text: 'Requirement not stated',
    });
    expect(reviews('unknown', false)).toEqual({
      state: 'met',
      text: 'Not in the way',
    });
  });

  it('names the worst required check or policy, in the verdict’s words', () => {
    const blocked = { ...CLEAN, blocked: true };
    expect(
      aspect(
        inputs({
          merge: blocked,
          checks: listed(check('lint', 'running'), check('test', 'failed')),
        }),
        'checks'
      )
    ).toEqual({ state: 'blocked', text: '1 required check failing: test' });
    expect(
      aspect(
        inputs({ merge: blocked, checks: listed(check('lint', 'queued')) }),
        'checks'
      )
    ).toEqual({ state: 'waiting', text: 'Waiting for 1 required check: lint' });
    // One nobody has started waits too; it has not failed.
    expect(
      aspect(
        inputs({
          merge: blocked,
          checks: listed({ ...check('nightly', 'queued'), manual: true }),
        }),
        'checks'
      )
    ).toEqual({
      state: 'waiting',
      text: 'Someone must start 1 required check: nightly',
    });
    expect(
      aspect(
        inputs({
          checks: listed(check('docs', 'failed', { requirement: 'optional' })),
        }),
        'checks'
      )
    ).toEqual({
      state: 'advisory',
      text: '1 check failing, not required: docs',
    });
    expect(aspect(inputs({ checks: listed() }), 'checks')).toEqual({
      state: 'met',
      text: 'None required',
    });
  });

  it('says what it could not read about the checks', () => {
    const failed = { state: 'failed', kind: 'network', reason: 'x' } as const;
    expect(aspect(inputs({ checks: failed }), 'checks')).toEqual({
      state: 'unknown',
      text: 'Could not be read',
    });
    const partial: ReadinessInputs['checks'] = {
      state: 'read',
      value: { items: [], total: 30, complete: false },
    };
    expect(aspect(inputs({ checks: partial }), 'checks')).toEqual({
      state: 'unknown',
      text: 'Not all read',
    });
  });

  it('reads conflicts and branch currency', () => {
    const conflicts = (merge: Partial<MergeState>) =>
      aspect(
        inputs({ merge: { ...CLEAN, blocked: true, ...merge } }),
        'conflicts'
      );
    expect(conflicts({ conflicts: 'conflicting' })?.state).toBe('blocked');
    expect(conflicts({ behind: true })).toEqual({
      state: 'blocked',
      text: 'Behind its target',
    });
    expect(conflicts({ conflicts: 'unknown' })?.state).toBe('unknown');
  });

  it('reads conversations: enforced, advisory, resolved or unread', () => {
    const blocked = { ...CLEAN, blocked: true };
    expect(
      aspect(inputs({ merge: blocked, unresolvedThreads: 2 }), 'conversations')
    ).toEqual({ state: 'blocked', text: '2 unresolved conversations' });
    expect(
      aspect(inputs({ unresolvedThreads: 2 }), 'conversations')?.state
    ).toBe('advisory');
    expect(
      aspect(
        inputs({
          merge: { ...CLEAN, conversations: 'resolved' },
          unresolvedThreads: null,
        }),
        'conversations'
      )
    ).toEqual({ state: 'met', text: 'All resolved' });
    expect(
      aspect(inputs({ unresolvedThreads: null }), 'conversations')?.state
    ).toBe('unknown');
  });
});
