import type { N10HostApi } from '../../../host/contract.js';
import { VIEWER } from '../data/identity.js';
import { later } from './hub.js';
import type { DemoState } from './state.js';

/**
 * Pull request reads by identity, answered from the demo's list rows.
 * The demo has no provider behind it, so it reads no detail and no
 * checks: the snapshot says so, as a provider without that read would,
 * and the checks read fails with the reason.
 */

type PullRequestHost = Pick<
  N10HostApi,
  'getPullRequestSnapshot' | 'getPullRequestChecks'
>;

const NO_DETAIL = 'The web demo does not read pull request detail';
const NO_CHECKS = 'The web demo does not read checks and policies';

export function createPullRequestHost(state: DemoState): PullRequestHost {
  return {
    getPullRequestSnapshot: ({ ref }) => {
      const pr = state.repo().pr(ref.number);
      const head = pr?.headSha;
      return later({
        ref,
        viewer: VIEWER,
        fetchedAt: Date.now(),
        summary: pr ? { kind: 'found', pr } : { kind: 'gone' },
        detail: { state: 'unsupported', reason: NO_DETAIL },
        head:
          head && /^[0-9a-f]{40}$/.test(head)
            ? { oid: head, from: 'list' }
            : null,
        target: null,
      });
    },
    getPullRequestChecks: () => Promise.reject(new Error(NO_CHECKS)),
  };
}
