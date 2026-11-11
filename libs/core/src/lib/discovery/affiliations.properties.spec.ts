import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { registryNameOf, type TaggedSession } from '../session-identity.js';
import { affiliations } from './affiliations.js';

const PEER = 'abcdefabcdefabcdefabcdefabcdefab';
/** This machine's own peerId. */
const SELF = '0123456789abcdef0123456789abcdef';
const TARGETS = ['claude:a', 'codex:b', 'claude:c'];

/** A listing of up to eight sessions with distinct names; any may carry
 *  a target (each at most once) or report to a target, a session's
 *  name, or something nobody answers to, unqualified or qualified with
 *  its own machine or the other. */
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
      qualifier: fc.constantFrom('none', 'own', 'other'),
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

type Qualifier = 'none' | 'own' | 'other';

interface Spec {
  worktree: boolean;
  remote: boolean;
  reports?: string;
  qualifier: Qualifier;
}

/** The peerId a qualifier names, seen from a machine. */
const peerOf = (remote: boolean, qualifier: Qualifier) =>
  remote === (qualifier === 'own') ? PEER : SELF;

function session(i: number, spec: Spec, target?: string): TaggedSession {
  const name = `s${i}`;
  const path = spec.worktree ? `/repo/wt/${name}` : `/dirs/${name}`;
  const orchestrator =
    spec.reports && spec.qualifier !== 'none'
      ? `beam:${peerOf(spec.remote, spec.qualifier)}/${spec.reports}`
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
const derive = (sessions: readonly TaggedSession[]) =>
  affiliations(sessions, placeOf, { self: SELF });
const ownPeer = (s: TaggedSession) => (s.machine === 'local' ? SELF : PEER);
/** Whether a session reports, by `tmux:`, to itself. */
const reportsToSelf = (s: TaggedSession) =>
  s.orchestrator === `tmux:${s.name}` ||
  s.orchestrator === `beam:${ownPeer(s)}/tmux:${s.name}`;

describe('affiliations (properties)', () => {
  it('gives every listed session exactly one affiliation', () => {
    fc.assert(
      fc.property(listing, (sessions) => {
        const { sessions: of } = derive(sessions);
        expect([...of.keys()].sort()).toEqual(
          sessions.map(registryNameOf).sort()
        );
      })
    );
  });

  it('puts every session that reports to another in a parent group', () => {
    fc.assert(
      fc.property(listing, (sessions) => {
        const { sessions: of } = derive(sessions);
        const reporting = sessions.filter(
          (s) => (s.orchestrator && !reportsToSelf(s)) || s.target
        );
        expect(reporting.map((s) => of.get(registryNameOf(s))?.kind)).toEqual(
          reporting.map(() => 'parent')
        );
      })
    );
  });

  it('heads a group only from its home, and gives every member the same one', () => {
    fc.assert(
      fc.property(listing, (sessions) => {
        const { sessions: of } = derive(sessions);
        const parents = [...of.values()].flatMap((a) =>
          a.kind === 'parent' ? [a] : []
        );
        const byKey = new Map(parents.map((a) => [a.key, a]));
        expect(parents).toEqual(parents.map((a) => byKey.get(a.key)));
        const headed = parents.flatMap((a) => (a.home ? [a] : []));
        expect(headed.map((a) => of.get(a.home!.key)?.key)).toEqual(
          headed.map((a) => a.key)
        );
        expect(parents.filter((a) => a.follows === a.key)).toEqual([]);
      })
    );
  });

  it('reads a qualifier naming the reporter’s own machine as none', () => {
    fc.assert(
      fc.property(listing, (sessions) => {
        const bare = sessions.map((s) =>
          s.orchestrator
            ? {
                ...s,
                orchestrator: s.orchestrator.replace(`beam:${ownPeer(s)}/`, ''),
              }
            : s
        );
        expect(derive(bare)).toEqual(derive(sessions));
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
          expect(derive(shuffled).sessions).toEqual(derive(sessions).sessions);
        }
      )
    );
  });
});
