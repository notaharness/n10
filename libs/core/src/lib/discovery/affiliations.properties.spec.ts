import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { registryNameOf, type TaggedSession } from '../session-identity.js';
import { affiliations } from './affiliations.js';

const PEER = 'abcdefabcdefabcdefabcdefabcdefab';
const TARGETS = ['claude:a', 'codex:b', 'claude:c'];

/** A listing of up to eight sessions with distinct names; any may carry
 *  a target (each at most once) or report to a target, a session's
 *  name, or something nobody answers to, beam-qualified or not. */
const listing = fc
  .array(
    fc.record({
      worktree: fc.boolean(),
      remote: fc.boolean(),
      target: fc.option(fc.constantFrom(...TARGETS), { nil: undefined }),
      reports: fc.option(
        fc.oneof(
          fc.constantFrom(...TARGETS, 'codex:nobody'),
          fc.nat(7).map((n) => `tmux:s${n}`)
        ),
        { nil: undefined }
      ),
      qualified: fc.boolean(),
    }),
    { maxLength: 8 }
  )
  .map((specs) => {
    const targets = new Set<string>();
    return specs.map((spec, i) => {
      const target =
        spec.target && !targets.has(spec.target) ? spec.target : undefined;
      if (target) targets.add(target);
      return session(i, spec, target);
    });
  });

interface Spec {
  worktree: boolean;
  remote: boolean;
  reports?: string;
  qualified: boolean;
}

function session(i: number, spec: Spec, target?: string): TaggedSession {
  const name = `s${i}`;
  const path = spec.worktree ? `/repo/wt/${name}` : `/dirs/${name}`;
  const orchestrator =
    spec.reports && spec.qualified
      ? `beam:${PEER}/${spec.reports}`
      : spec.reports;
  return {
    name,
    created: i,
    paneDead: false,
    path,
    spawner: 'orchestra',
    repo: spec.worktree ? '/repo' : path,
    type: spec.worktree ? 'worktree' : 'shell',
    branch: spec.worktree ? name : '',
    worktreePath: spec.worktree ? path : '',
    machine: spec.remote ? PEER : 'local',
    identityTags: {},
    ...(target ? { target } : {}),
    ...(orchestrator ? { orchestrator } : {}),
  };
}

const placeOf = (dir: string) => dir;

describe('affiliations (properties)', () => {
  it('gives every listed session exactly one affiliation', () => {
    fc.assert(
      fc.property(listing, (sessions) => {
        const { sessions: of } = affiliations(sessions, placeOf);
        expect([...of.keys()].sort()).toEqual(
          sessions.map(registryNameOf).sort()
        );
      })
    );
  });

  it('puts every session that reports to another in a parent group', () => {
    fc.assert(
      fc.property(listing, (sessions) => {
        const { sessions: of } = affiliations(sessions, placeOf);
        const self = (s: TaggedSession) =>
          s.orchestrator?.endsWith(`tmux:${s.name}`) && s.machine === 'local';
        const reporting = sessions.filter(
          (s) => (s.orchestrator && !self(s)) || s.target
        );
        expect(reporting.map((s) => of.get(registryNameOf(s))?.kind)).toEqual(
          reporting.map(() => 'parent')
        );
      })
    );
  });

  it('heads a group only from its home, and every member agrees on it', () => {
    fc.assert(
      fc.property(listing, (sessions) => {
        const { sessions: of } = affiliations(sessions, placeOf);
        const parents = [...of.values()].flatMap((a) =>
          a.kind === 'parent' ? [a] : []
        );
        const homeOf = new Map(parents.map((a) => [a.key, a.home?.key]));
        expect(parents.map((a) => a.home?.key)).toEqual(
          parents.map((a) => homeOf.get(a.key))
        );
        const headed = parents.flatMap((a) => (a.home ? [a] : []));
        expect(headed.map((a) => of.get(a.home!.key)?.key)).toEqual(
          headed.map((a) => a.key)
        );
        expect(parents.filter((a) => a.follows === a.key)).toEqual([]);
      })
    );
  });

  it('does not depend on the beam qualifier', () => {
    fc.assert(
      fc.property(listing, (sessions) => {
        const bare = sessions.map((s) =>
          s.orchestrator
            ? {
                ...s,
                orchestrator: s.orchestrator.replace(/^beam:[^/]+\//, ''),
              }
            : s
        );
        expect(affiliations(bare, placeOf)).toEqual(
          affiliations(sessions, placeOf)
        );
      })
    );
  });

  it('does not depend on listing order', () => {
    fc.assert(
      fc.property(
        listing.chain((sessions) =>
          fc.tuple(
            fc.constant(sessions),
            fc.shuffledSubarray(sessions, {
              minLength: sessions.length,
              maxLength: sessions.length,
            })
          )
        ),
        ([sessions, shuffled]) => {
          expect(affiliations(shuffled, placeOf).sessions).toEqual(
            affiliations(sessions, placeOf).sessions
          );
        }
      )
    );
  });
});
