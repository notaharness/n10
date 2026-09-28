import { describe, expect, it } from 'vitest';
import type {
  BranchRules,
  MergeState,
  PullRequestCheck,
  ReadOutcome,
} from '@n10/vcs-core';
import { evaluateReadiness, type ReadinessInputs } from './pr-readiness.js';

/** Every blocker alone and together, as O9 asks. */

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
  requirement: PullRequestCheck['requirement'] = 'required'
): PullRequestCheck {
  return {
    key: `check:1::${name}`,
    kind: 'check',
    requires: null,
    name,
    group: null,
    source: 'github-actions',
    outcome,
    native: null,
    requirement,
    revision: outcome === 'expected' ? null : 'a'.repeat(40),
    ranOn: null,
    startedAt: null,
    completedAt: null,
    attempt: 1,
    url: null,
  };
}

const RULES: ReadOutcome<BranchRules> = {
  state: 'read',
  value: {
    requiredChecks: [{ name: 'test', app: null }],
    conversationResolution: false,
  },
};

function inputs(over: Partial<ReadinessInputs> = {}): ReadinessInputs {
  return {
    merge: CLEAN,
    checks: {
      state: 'read',
      value: { items: [check('test', 'succeeded')], total: 1, complete: true },
    },
    rules: RULES,
    unresolvedThreads: 0,
    ...over,
  };
}

function checks(...items: PullRequestCheck[]): ReadinessInputs['checks'] {
  return {
    state: 'read',
    value: { items, total: items.length, complete: true },
  };
}

const kinds = (i: ReadinessInputs) =>
  evaluateReadiness(i).blockers.map((b) => [b.kind, b.resolvedBy]);

describe('evaluateReadiness', () => {
  it('is ready when the provider allows completion and nothing it said disagrees', () => {
    expect(evaluateReadiness(inputs())).toEqual({
      state: 'ready',
      blockers: [],
      advisories: [],
      unknowns: [],
    });
  });

  it('waits for review when checks pass but a review is required', () => {
    const r = evaluateReadiness(
      inputs({
        merge: {
          ...CLEAN,
          reviews: 'required',
          blocked: true,
          native: 'BLOCKED',
        },
      })
    );
    expect(r.state).toBe('blocked');
    expect(r.blockers).toEqual([
      { kind: 'reviews', text: 'Waiting for review', resolvedBy: 'reviewers' },
    ]);
  });

  it('names conflicts on an approved pull request', () => {
    expect(
      kinds(
        inputs({
          merge: {
            ...CLEAN,
            conflicts: 'conflicting',
            blocked: true,
            native: 'DIRTY',
          },
        })
      )
    ).toEqual([['conflicts', 'author']]);
  });

  it('keeps unenforced conversations advisory, and blocks on enforced ones', () => {
    const advisory = evaluateReadiness(inputs({ unresolvedThreads: 2 }));
    expect(advisory.state).toBe('ready');
    expect(advisory.advisories.map((a) => a.text)).toEqual([
      '2 unresolved conversations',
    ]);

    const enforced = evaluateReadiness(
      inputs({
        unresolvedThreads: 1,
        merge: { ...CLEAN, blocked: true, native: 'BLOCKED' },
        rules: {
          state: 'read',
          value: { requiredChecks: [], conversationResolution: true },
        },
      })
    );
    expect(enforced.blockers.map((b) => b.kind)).toEqual(['conversations']);
  });

  it('takes GitHub’s clear over the list’s older count of threads', () => {
    // The author resolved the last thread; the list has not read again.
    const r = evaluateReadiness(
      inputs({
        unresolvedThreads: 1,
        rules: {
          state: 'read',
          value: { requiredChecks: [], conversationResolution: true },
        },
      })
    );
    expect(r).toMatchObject({ state: 'ready', blockers: [], unknowns: [] });
    expect(r.advisories.map((a) => a.text)).toEqual([
      '1 unresolved conversation',
    ]);
  });

  it('asks about conversations only where they could be in the way', () => {
    // No rule asks for resolution: an unread count is nothing to know.
    expect(
      evaluateReadiness(inputs({ unresolvedThreads: null })).unknowns
    ).toEqual([]);
    // A rule does, but GitHub says it is clear: the count is moot.
    const ruled: ReadOutcome<BranchRules> = {
      state: 'read',
      value: { requiredChecks: [], conversationResolution: true },
    };
    expect(
      evaluateReadiness(inputs({ unresolvedThreads: null, rules: ruled }))
    ).toMatchObject({ state: 'ready', unknowns: [] });
    expect(
      evaluateReadiness(
        inputs({
          unresolvedThreads: null,
          rules: ruled,
          merge: { ...CLEAN, blocked: true, native: 'BLOCKED' },
        })
      ).unknowns
    ).toEqual(['Unresolved conversations']);
    // Unread rules, but GitHub says it is clear: whether they must be
    // resolved is moot.
    const rules = { state: 'failed', kind: 'auth', reason: 'denied' } as const;
    const r = evaluateReadiness(inputs({ rules, unresolvedThreads: 1 }));
    expect(r.unknowns).toEqual(['Branch rules']);
    expect(r.advisories.map((a) => a.kind)).toEqual(['conversations']);
  });

  it('blocks a draft by its own lifecycle, as quiet as any clear pull request', () => {
    const draft = {
      ...CLEAN,
      lifecycle: { state: 'open', isDraft: true, native: 'OPEN' },
      reviews: 'unknown',
    } as const;
    expect(evaluateReadiness(inputs({ merge: draft }))).toEqual({
      state: 'blocked',
      blockers: [{ kind: 'draft', text: 'Draft', resolvedBy: 'author' }],
      advisories: [],
      unknowns: [],
    });
    // GitHub reports a draft by its other state: BLOCKED is another
    // rule, not the draft.
    expect(
      kinds(inputs({ merge: { ...draft, blocked: true, native: 'BLOCKED' } }))
    ).toEqual([
      ['draft', 'author'],
      ['rules', 'maintainers'],
    ]);
  });

  it('keeps the provider’s verdict when the rules cannot be read, and says they were not', () => {
    const rules = { state: 'failed', kind: 'auth', reason: 'denied' } as const;
    const clear = evaluateReadiness(inputs({ rules }));
    expect(clear.state).toBe('ready');
    expect(clear.unknowns).toEqual(['Branch rules']);

    // Unread rules cannot say whether conversations must be resolved.
    const blocked = evaluateReadiness(
      inputs({
        rules,
        unresolvedThreads: 1,
        merge: { ...CLEAN, blocked: true, native: 'BLOCKED' },
      })
    );
    expect(blocked.state).toBe('blocked');
    expect(blocked.unknowns).toEqual([
      'Whether conversations must be resolved',
      'Branch rules',
    ]);
  });

  it('does not call it ready when the provider’s details contradict its verdict', () => {
    const r = evaluateReadiness(
      inputs({ checks: checks(check('test', 'failed')) })
    );
    expect(r.state).toBe('unknown');
    expect(r.blockers.map((b) => b.text)).toEqual([
      '1 required check failing: test',
    ]);
    expect(r.unknowns).toEqual([
      'Whether completion is allowed: the provider says so, its details do not',
    ]);
  });

  it('takes no outcome it does not know for a pass or a failure', () => {
    const r = evaluateReadiness(
      inputs({
        merge: { ...CLEAN, blocked: true, native: 'BLOCKED' },
        checks: checks(check('test', 'unknown')),
      })
    );
    expect(r.blockers.map((b) => b.kind)).toEqual(['rules']);
    expect(r.unknowns).toEqual(['The outcome of test']);
  });

  it('keeps a failed optional check visible without blocking', () => {
    const r = evaluateReadiness(
      inputs({
        checks: checks(
          check('test', 'succeeded'),
          check('docs', 'failed', 'optional')
        ),
      })
    );
    expect(r.state).toBe('ready');
    expect(r.advisories.map((a) => a.text)).toEqual([
      '1 check failing, not required: docs',
    ]);
  });

  it('blocks on failing and on waiting required checks, each with who clears it', () => {
    expect(
      kinds(
        inputs({
          merge: { ...CLEAN, blocked: true, native: 'BLOCKED' },
          checks: checks(
            check('test', 'failed'),
            check('lint', 'expected'),
            check('build', 'running'),
            check('deploy', 'waiting'),
            check('e2e', 'cancelled')
          ),
        })
      )
    ).toEqual([
      ['checks', 'author'],
      ['checks', 'checks'],
    ]);
    expect(
      evaluateReadiness(
        inputs({
          merge: { ...CLEAN, blocked: true, native: 'BLOCKED' },
          checks: checks(
            check('test', 'failed'),
            check('lint', 'expected'),
            check('build', 'running'),
            check('deploy', 'waiting'),
            check('e2e', 'cancelled'),
            check('docs', 'queued')
          ),
        })
      ).blockers.map((b) => b.text)
    ).toEqual([
      '2 required checks failing: test, e2e',
      'Waiting for 4 required checks: lint, build, deploy, docs',
    ]);
  });

  it('says what it cannot tell about requirements, where the provider blocks', () => {
    const unsure = inputs({
      checks: checks(check('test', 'succeeded', 'unknown')),
      merge: { ...CLEAN, reviews: 'unknown' },
    });
    // Clear by the provider's word: whether either was required is moot.
    expect(evaluateReadiness(unsure)).toMatchObject({
      state: 'ready',
      unknowns: [],
    });
    expect(
      evaluateReadiness({
        ...unsure,
        merge: { ...unsure.merge, blocked: true, native: 'BLOCKED' },
      }).unknowns
    ).toEqual(['Whether every check is required', 'The review requirement']);
  });

  it('speaks of a policy as one, not as a check', () => {
    const policy = (
      name: string,
      outcome: PullRequestCheck['outcome'],
      requirement: PullRequestCheck['requirement'] = 'required'
    ): PullRequestCheck => ({
      ...check(name, outcome, requirement),
      kind: 'policy',
    });
    const r = evaluateReadiness(
      inputs({
        merge: { ...CLEAN, blocked: true, native: 'succeeded' },
        checks: checks(
          check('test', 'succeeded'),
          policy('Work item linking', 'failed'),
          policy('Merge strategy', 'queued'),
          policy('Changelog entry', 'failed', 'optional')
        ),
      })
    );
    expect(r.blockers).toEqual([
      {
        kind: 'policies',
        text: '1 required policy not met: Work item linking',
        resolvedBy: 'author',
      },
      {
        kind: 'policies',
        text: 'Waiting for 1 required policy: Merge strategy',
        resolvedBy: 'checks',
      },
    ]);
    expect(r.advisories.map((a) => a.text)).toEqual([
      '1 policy not met, not required: Changelog entry',
    ]);
  });

  it('names a required check nobody has started, and who must start it', () => {
    const r = evaluateReadiness(
      inputs({
        merge: { ...CLEAN, blocked: true, native: 'succeeded' },
        checks: checks(
          { ...check('nightly', 'queued'), manual: true },
          check('ci', 'queued')
        ),
      })
    );
    expect(r.blockers).toEqual([
      {
        kind: 'checks',
        text: 'Waiting for 1 required check: ci',
        resolvedBy: 'checks',
      },
      {
        kind: 'checks',
        text: 'Someone must start 1 required check: nightly',
        resolvedBy: 'author',
      },
    ]);
  });

  it('takes the provider’s own verdict on conversations over the count', () => {
    const unresolved = evaluateReadiness(
      inputs({
        merge: { ...CLEAN, blocked: true, conversations: 'unresolved' },
        unresolvedThreads: null,
      })
    );
    expect(unresolved.blockers).toEqual([
      {
        kind: 'conversations',
        text: 'Unresolved conversations',
        resolvedBy: 'author',
      },
    ]);
    expect(unresolved.unknowns).toEqual([]);
    // The provider counts them resolved: the count is to read, not in
    // the way, whatever the rule says.
    const resolved = evaluateReadiness(
      inputs({
        merge: { ...CLEAN, conversations: 'resolved' },
        unresolvedThreads: 2,
        rules: {
          state: 'read',
          value: { requiredChecks: [], conversationResolution: true },
        },
      })
    );
    expect(resolved).toMatchObject({ state: 'ready', blockers: [] });
    expect(resolved.advisories.map((a) => a.text)).toEqual([
      '2 unresolved conversations',
    ]);
    // Even under a block, a resolved verdict leaves the count to read.
    const blocked = evaluateReadiness(
      inputs({
        merge: { ...CLEAN, blocked: true, conversations: 'resolved' },
        unresolvedThreads: 2,
        rules: {
          state: 'read',
          value: { requiredChecks: [], conversationResolution: true },
        },
      })
    );
    expect(blocked.blockers.map((b) => b.kind)).toEqual(['rules']);
    expect(blocked.advisories.map((a) => a.kind)).toEqual(['conversations']);
  });

  it('names a rule it cannot see when the provider blocks and nothing read says why', () => {
    expect(
      kinds(inputs({ merge: { ...CLEAN, blocked: true, native: 'BLOCKED' } }))
    ).toEqual([['rules', 'maintainers']]);
  });

  it('is not ready while the provider has not worked out mergeability', () => {
    const r = evaluateReadiness(
      inputs({
        merge: {
          ...CLEAN,
          conflicts: 'unknown',
          blocked: null,
          native: 'UNKNOWN',
        },
      })
    );
    expect(r.state).toBe('unknown');
    expect(r.unknowns).toEqual([
      'Whether it conflicts with its target',
      'Whether the provider will allow completion',
    ]);
  });

  it('keeps the provider’s verdict on a partial check list, and says it is partial', () => {
    const r = evaluateReadiness(
      inputs({
        checks: {
          state: 'read',
          value: {
            items: [check('test', 'succeeded')],
            total: null,
            complete: false,
          },
        },
      })
    );
    expect(r).toMatchObject({ state: 'ready', unknowns: ['Every check'] });
  });

  it('lists every blocker together', () => {
    // GitHub reports a conflicting draft as DIRTY and says draft only
    // through isDraft; the provider's read counts that as blocked.
    const r = evaluateReadiness(
      inputs({
        merge: {
          ...CLEAN,
          lifecycle: { state: 'open', isDraft: true, native: 'OPEN' },
          conflicts: 'conflicting',
          behind: true,
          blocked: true,
          reviews: 'changes-requested',
          native: 'DIRTY',
        },
        checks: checks(check('test', 'failed')),
        unresolvedThreads: 3,
        rules: {
          state: 'read',
          value: { requiredChecks: [], conversationResolution: true },
        },
      })
    );
    expect(r.blockers.map((b) => b.kind)).toEqual([
      'draft',
      'conflicts',
      'behind',
      'checks',
      'reviews',
      'conversations',
    ]);
  });

  it('says a closed or merged pull request is that, and nothing else', () => {
    for (const state of ['closed', 'merged'] as const) {
      const r = evaluateReadiness(
        inputs({
          merge: {
            ...CLEAN,
            lifecycle: { state, isDraft: false, native: state },
          },
        })
      );
      expect(r).toEqual({ state, blockers: [], advisories: [], unknowns: [] });
    }
  });
});
