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
    const rule = (
      conversationResolution: boolean
    ): ReadinessInputs['rules'] => ({
      state: 'read',
      value: { requiredChecks: [], conversationResolution },
    });
    expect(
      aspect(inputs({ merge: blocked, unresolvedThreads: 2 }), 'conversations')
    ).toEqual({ state: 'blocked', text: '2 unresolved conversations' });
    expect(
      aspect(inputs({ unresolvedThreads: 2 }), 'conversations')?.state
    ).toBe('advisory');
    // Resolved on the provider's word: Azure's verdict, or GitHub's clear
    // under the rule.
    expect(
      aspect(
        inputs({
          merge: { ...CLEAN, blocked: null, conversations: 'resolved' },
          unresolvedThreads: null,
        }),
        'conversations'
      )
    ).toEqual({ state: 'met', text: 'All resolved' });
    expect(
      aspect(inputs({ unresolvedThreads: null }), 'conversations')
    ).toEqual({ state: 'met', text: 'All resolved' });
    expect(
      aspect(
        inputs({ merge: blocked, rules: rule(false), unresolvedThreads: 0 }),
        'conversations'
      )
    ).toEqual({ state: 'met', text: 'Not required' });
    // The list's count is a lower bound: none unresolved on its first
    // page is not all resolved while the provider blocks.
    expect(
      aspect(inputs({ merge: blocked, unresolvedThreads: 0 }), 'conversations')
    ).toEqual({ state: 'observed', text: 'None unresolved' });
    expect(
      aspect(
        inputs({ merge: { ...CLEAN, blocked: null }, unresolvedThreads: null }),
        'conversations'
      )?.state
    ).toBe('unknown');
  });

  it('reads no conflicts as met', () => {
    expect(aspect(inputs(), 'conflicts')).toEqual({
      state: 'met',
      text: 'No conflicts',
    });
  });

  it('names a failure over what is still going, across kinds', () => {
    expect(
      aspect(
        inputs({
          merge: { ...CLEAN, blocked: true },
          checks: listed(
            check('e2e', 'running'),
            check('linking', 'failed', { kind: 'policy' })
          ),
        }),
        'checks'
      )
    ).toEqual({ state: 'blocked', text: '1 required policy not met: linking' });
  });

  it('never calls the checks passing where it cannot vouch for them', () => {
    const blocked = { ...CLEAN, blocked: true };
    // An outcome n10 does not know is not a pass.
    expect(
      aspect(
        inputs({
          merge: blocked,
          checks: listed(check('build', 'unknown', { native: 'NEW_THING' })),
        }),
        'checks'
      )
    ).toEqual({ state: 'unknown', text: 'Outcome not known' });
    // Without the rules, a required check that never reported is absent.
    const unread = { state: 'failed', kind: 'auth', reason: 'x' } as const;
    expect(
      aspect(
        inputs({ merge: blocked, rules: unread, checks: listed() }),
        'checks'
      )
    ).toEqual({ state: 'unknown', text: 'Not known which are required' });
    // A failure not known to be required is neither a block nor "not
    // required".
    expect(
      aspect(
        inputs({
          merge: blocked,
          checks: listed(check('build', 'failed', { requirement: 'unknown' })),
        }),
        'checks'
      )
    ).toEqual({
      state: 'unknown',
      text: '1 check failing, not known if required: build',
    });
    // Moot where the provider says nothing enforced is in the way, and
    // said as only that.
    expect(
      aspect(inputs({ rules: unread, checks: listed() }), 'checks')
    ).toEqual({ state: 'met', text: 'Not in the way' });
    expect(
      aspect(
        inputs({
          rules: unread,
          checks: listed(check('build', 'failed', { requirement: 'unknown' })),
        }),
        'checks'
      )
    ).toEqual({
      state: 'advisory',
      text: '1 check failing, not known if required: build',
    });
  });

  it('keeps a failure nothing enforces in sight beside a pass', () => {
    expect(
      aspect(
        inputs({
          checks: listed(
            check('build', 'succeeded'),
            check('docs', 'failed', { requirement: 'optional' })
          ),
        }),
        'checks'
      )
    ).toEqual({
      state: 'met',
      text: 'Required checks pass · 1 check failing, not required: docs',
    });
  });

  it('says a provider that reads no checks does not', () => {
    expect(
      aspect(
        inputs({ checks: { state: 'unsupported', reason: 'x' } }),
        'checks'
      )
    ).toEqual({ state: 'unknown', text: 'Not read by this provider' });
  });
});
