import type { N10HostApi } from '../../../host/contract.js';
import { VIEWER } from '../data/identity.js';
import { later } from './hub.js';
import type { DemoState } from './state.js';

/**
 * Pull request reads by identity, answered from the demo's list rows.
 * The demo has no provider behind it, so it reads no detail: each
 * answer says so, as a provider without that read would.
 */

type PullRequestHost = Pick<N10HostApi, 'getPullRequestSnapshot'>;

const NO_DETAIL = 'The web demo does not read pull request detail';

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
  };
}
