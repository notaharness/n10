import type {
  PullRequestComments,
  RemoteCommentThread,
  ReviewVerdict,
} from '@n10/vcs-core';
import type { PullRequestList } from '../pull-requests/pull-request-list.js';
import {
  createReviewContext,
  requirePullRequestNumber,
  type ReviewContextOptions,
} from './review-context.js';
import type { createProviderReads } from './provider-reads.js';
import { readResourceValue } from './read-resource.js';

export type ReviewCommandOptions = ReviewContextOptions & {
  pullRequests: ReviewContextOptions['pullRequests'] &
    Pick<PullRequestList, 'read'>;
};
export interface ReplyToReviewThread {
  prId: number;
  threadId: string;
  body: string;
}
export interface ResolveReviewThread {
  prId: number;
  threadId: string;
  resolved: boolean;
}
const VERDICTS: readonly ReviewVerdict[] = [
  'approve',
  'approve-with-suggestions',
  'wait-for-author',
  'reject',
];

function updateThread(
  data: PullRequestComments,
  id: string,
  update: (thread: RemoteCommentThread) => RemoteCommentThread
): PullRequestComments {
  const map = (threads: RemoteCommentThread[]) =>
    threads.map((thread) => (thread.id === id ? update(thread) : thread));
  return {
    threads: map(data.threads),
    generalComments: map(data.generalComments),
  };
}

/** Commands capture credentials and resolve thread identity before issuing a write. */
export function createReviewCommands(
  options: ReviewCommandOptions,
  reads: ReturnType<typeof createProviderReads>
) {
  const context = createReviewContext(options);
  function configured() {
    const snapshot = context.current();
    if (!snapshot.vcsConfigured || !snapshot.provider)
      throw new Error('No review provider is configured');
    return { snapshot, provider: snapshot.provider, ...snapshot.config };
  }
  async function thread(prId: number, id: string) {
    requirePullRequestNumber(prId);
    if (typeof id !== 'string' || !id) throw new TypeError('Invalid thread');
    const resource = reads.comments(prId);
    const data = await readResourceValue(resource);
    const value = [...data.threads, ...data.generalComments].find(
      (item) => item.id === id
    );
    if (!value) throw new Error('The comment thread no longer exists');
    return { resource, base: resource.getSnapshot(), value };
  }
  return {
    viewer() {
      const identifier = context.current().viewer;
      return identifier ? { identifier } : null;
    },
    async reply(req: ReplyToReviewThread) {
      if (typeof req.body !== 'string' || !req.body.trim())
        throw new TypeError('A reply needs a body');
      const { snapshot, provider, vendorAuth, vendorProject } = configured();
      if (!provider.replyToThread)
        throw new Error("Replies aren't available for this repository");
      const target = await thread(req.prId, req.threadId);
      context.assertUnchanged(snapshot);
      const reply = await provider.replyToThread(
        vendorAuth,
        vendorProject,
        req.prId,
        target.value,
        req.body
      );
      if (
        !target.resource.patch(target.base, (data) =>
          updateThread(data, req.threadId, (item) => ({
            ...item,
            comments: [...item.comments, reply],
          }))
        )
      )
        target.resource.invalidate();
      reads.invalidateRelated();
      return reply;
    },
    async resolve(req: ResolveReviewThread) {
      if (typeof req.resolved !== 'boolean')
        throw new TypeError('Invalid thread resolution');
      const { snapshot, provider, vendorAuth, vendorProject } = configured();
      if (!provider.setThreadResolved)
        throw new Error(
          "Resolving comments isn't available for this repository"
        );
      const target = await thread(req.prId, req.threadId);
      if (!target.value.canResolve) return false;
      context.assertUnchanged(snapshot);
      await provider.setThreadResolved(
        vendorAuth,
        vendorProject,
        req.prId,
        target.value,
        req.resolved
      );
      if (
        !target.resource.patch(target.base, (data) =>
          updateThread(data, req.threadId, (item) => ({
            ...item,
            isResolved: req.resolved,
          }))
        )
      )
        target.resource.invalidate();
      reads.invalidateRelated();
      await options.pullRequests.read(options.config.repo, { force: true });
      return true;
    },
    async verdict(prId: number, verdict: ReviewVerdict) {
      requirePullRequestNumber(prId);
      if (!VERDICTS.includes(verdict))
        throw new TypeError('Invalid review verdict');
      const { provider, vendorAuth, vendorProject } = configured();
      if (!provider.submitReviewVerdict)
        throw new Error(
          "Review decisions aren't available for this repository"
        );
      await provider.submitReviewVerdict(
        vendorAuth,
        vendorProject,
        prId,
        verdict
      );
      reads.invalidateRelated();
      await options.pullRequests.read(options.config.repo, { force: true });
    },
  };
}
