import type { PullRequestInfo, PullRequestReviewer } from '@n10/vcs-core';
import {
  isOid,
  type DetailReviewer,
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
  'getPullRequestSnapshot' | 'getPullRequestChecks'
>;

const NO_CHECKS = 'The web demo does not read checks and policies';

/** GitHub's word for each verdict the demo's rows hold. */
const NATIVE: Partial<Record<PullRequestReviewer['decision'], string>> = {
  approved: 'APPROVED',
  'changes-requested': 'CHANGES_REQUESTED',
};

/** A row's reviewer as GitHub's detail read names them: asked where
 *  they have not reviewed, and their verdict on the head. */
function detailReviewer(
  r: PullRequestReviewer,
  head: string | undefined
): DetailReviewer {
  const native = NATIVE[r.decision] ?? null;
  return {
    kind: 'user',
    identifier: r.identifier,
    id: `U_demo_${r.identifier}`,
    displayName: r.displayName,
    decision: r.decision,
    native,
    requested: r.requested ?? r.decision === 'no-response',
    // GitHub has no flag apart from a request.
    attention: null,
    required: null,
    reason: null,
    onBehalfOf: [],
    reviewedHead: native && isOid(head) ? head : null,
  };
}

/** The pull request as a detail read names it: the repository it and
 *  its branch belong to, the commits the row reports, and everyone
 *  asked to review. The demo's viewer may edit their own pull requests,
 *  and the teammate lets them edit theirs. */
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
    reviewers: {
      state: 'read',
      value: {
        items: (pr.reviewers ?? []).map((r) => detailReviewer(r, pr.headSha)),
        total: pr.reviewers?.length ?? 0,
        complete: true,
      },
    },
    iteration: {
      state: 'unsupported',
      reason: 'GitHub names a revision by its head commit alone',
    },
    capabilities: { update: { state: 'supported' } },
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
    getPullRequestChecks: () => Promise.reject(new Error(NO_CHECKS)),
  };
}
