import type {
  Checkpoint,
  N10HostApi,
  PullRequestRef,
} from '../../../host/contract.js';
import { VIEWER } from '../data/identity.js';
import {
  demoEvents,
  demoLastReview,
  demoLastVisit,
  demoPushes,
} from './demo-history.js';
import { later } from './hub.js';
import type { DemoState } from './state.js';

/**
 * Pull request history and visits as the host keeps them, over the
 * demo's own rows (`demo-history.ts`). A visit's "last visit" is fixed
 * when the visit first reads it, and recording one needs that read, as
 * in the app; the page's visits last until it reloads.
 */

type HistoryHost = Pick<
  N10HostApi,
  'getPullRequestHistory' | 'recordPullRequestVisit' | 'resolvePrRevisionRange'
>;

const keyOf = (ref: PullRequestRef) => `${ref.repository}#${ref.number}`;

export function createHistoryHost(state: DemoState): HistoryHost {
  /** The latest visit per pull request, and which visit recorded it. */
  const visits = new Map<string, Checkpoint & { visitId: string }>();
  /** Each visit's baseline: the visit before it began. */
  const baselines = new Map<string, Checkpoint | null>();
  const baselineOf = (key: string, visitId: string, seed: () => Checkpoint) => {
    const id = `${visitId}:${key}`;
    if (!baselines.has(id)) {
      const last = visits.get(key);
      baselines.set(id, last && last.visitId !== visitId ? last : seed());
    }
    return baselines.get(id) ?? null;
  };
  return {
    getPullRequestHistory: ({ ref, visitId }) => {
      const pr = state.repo().pr(ref.number);
      if (!pr) {
        return Promise.reject(new Error(`#${ref.number} is not in the demo`));
      }
      const lastReview = demoLastReview(pr);
      return later(
        {
          ref,
          viewer: VIEWER,
          revisions: {
            state: 'read',
            value: {
              ref,
              events: demoEvents(pr),
              complete: true,
              viewer: VIEWER,
              lastReview,
              reviewsComplete: true,
            },
          },
          lastReview: { state: 'read', value: lastReview },
          lastVisit: {
            state: 'read',
            value: baselineOf(keyOf(ref), visitId, () => demoLastVisit(pr)),
          },
        },
        150
      );
    },
    recordPullRequestVisit: ({ ref, visitId, visit }) => {
      const key = keyOf(ref);
      if (!baselines.has(`${visitId}:${key}`)) {
        return Promise.reject(new Error('Read the history before recording'));
      }
      visits.set(key, { ...visit, at: Date.now(), visitId });
      return later(undefined);
    },
    resolvePrRevisionRange: ({ repo, from, to }) => {
      if (repo !== state.repo().cwd) {
        return later({
          ok: false,
          error: { code: 'repo-changed', message: `${repo} is not open` },
        });
      }
      // Among a demo pull request's pushes, a later one builds on an
      // earlier one.
      const order = state
        .repo()
        .pullRequests()
        .flatMap((pr) => demoPushes(pr).map((p) => p.oid));
      const linear = order.indexOf(from) <= order.indexOf(to);
      return later({
        ok: true,
        range: {
          fromOid: from,
          toOid: to,
          linear,
          base: { state: 'unchanged' },
        },
      });
    },
  };
}
