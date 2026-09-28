import type { PullRequestInfo } from '@n10/vcs-core';
import {
  isOid,
  type PullRequestDetail,
  type PullRequestRef,
} from '@n10/vcs-core/pr-details';
import type { N10HostApi } from '../../../host/contract.js';
import { VIEWER } from '../data/identity.js';
import { later } from './hub.js';
import type { DemoState } from './state.js';

/**
 * Pull request reads by identity, answered from the demo's own rows as
 * a provider's detail read would describe them.
 */

type PullRequestHost = Pick<
  N10HostApi,
  'getPullRequestSnapshot' | 'getPullRequestConversation'
>;

/** The pull request as a detail read names it: the repository it and
 *  its branch belong to, and the commits the row reports. */
export function demoDetail(
  pr: PullRequestInfo,
  ref: PullRequestRef
): PullRequestDetail {
  const repository = {
    provider: ref.provider,
    host: ref.host,
    repository: ref.repository,
  };
  return {
    ref,
    title: pr.title,
    url: pr.url,
    author: {
      identifier: pr.createdByIdentifier,
      displayName: pr.createdByDisplayName,
    },
    lifecycle: { state: 'open', isDraft: pr.isDraft ?? false, native: 'OPEN' },
    source: {
      branch: pr.sourceBranch,
      repository,
      head: isOid(pr.headSha) ? pr.headSha : '0'.repeat(40),
    },
    target: { branch: pr.targetBranch, head: null },
    createdAt: null,
    updatedAt: null,
  };
}

export function createPullRequestHost(state: DemoState): PullRequestHost {
  return {
    getPullRequestSnapshot: ({ ref }) => {
      const pr = state.repo().pr(ref.number);
      return later({
        ref,
        viewer: VIEWER,
        fetchedAt: Date.now(),
        summary: pr ? { kind: 'found', pr } : { kind: 'gone' },
        detail: pr
          ? { state: 'read', value: demoDetail(pr, ref) }
          : {
              state: 'failed',
              kind: 'not-found',
              reason: `#${ref.number} is not in the demo`,
            },
        head:
          pr && isOid(pr.headSha) ? { oid: pr.headSha, from: 'detail' } : null,
        target: null,
      });
    },
    // The demo has rows, not conversations: it says so rather than
    // showing an empty one.
    getPullRequestConversation: ({ ref }) =>
      later({
        ref,
        viewer: VIEWER,
        fetchedAt: Date.now(),
        conversation: {
          state: 'unsupported',
          reason: 'The demo has no conversation to read',
        },
      }),
  };
}
