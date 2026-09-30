import {
  parseSnapshotRequest,
  readPullRequestSnapshot,
  readPullRequestChecks,
  readPullRequestConversation,
  assertSameContext,
} from '@n10/core';
import type {
  PullRequestSnapshot,
  PullRequestChecksAnswer,
  PullRequestConversationRead,
} from '@n10/core';
import type { PullRequestComments } from '@n10/vcs-core';
import { createResourceCache } from './resource-cache.js';
import {
  createReviewContext,
  requirePullRequestNumber,
} from './review-context.js';
import type { ReviewContextOptions } from './review-context.js';

const REVIEW_READ_TTL_MS = 30_000;
const EMPTY_COMMENTS: PullRequestComments = {
  threads: [],
  generalComments: [],
};

/** Provider reads share the same repo/account scope and read lanes in both shells. */
export function createProviderReads(options: ReviewContextOptions) {
  const context = createReviewContext(options);
  const comments = createResourceCache<PullRequestComments>(REVIEW_READ_TTL_MS);
  const descriptions = createResourceCache<string>(REVIEW_READ_TTL_MS);
  const snapshots = createResourceCache<PullRequestSnapshot>(
    REVIEW_READ_TTL_MS,
    32,
    ({ detail }) =>
      detail.state !== 'failed' &&
      (detail.state !== 'read' ||
        (detail.value.reviewers?.state !== 'failed' &&
          detail.value.iteration?.state !== 'failed'))
  );
  const checks = createResourceCache<PullRequestChecksAnswer>(
    REVIEW_READ_TTL_MS,
    32,
    ({ checks, requirements }) =>
      checks.state !== 'failed' &&
      requirements.reviewers.state !== 'failed' &&
      (checks.state !== 'read' ||
        (checks.value.checks.state !== 'failed' &&
          checks.value.rules.state !== 'failed'))
  );
  const conversations = createResourceCache<PullRequestConversationRead>(
    REVIEW_READ_TTL_MS,
    32,
    ({ conversation }) => conversation.state !== 'failed'
  );
  const caches = [comments, descriptions, snapshots, checks, conversations];
  function request(value: unknown) {
    const req = parseSnapshotRequest(value);
    const viewer = assertSameContext(req, context.sources);
    return { ...req, viewer };
  }
  return {
    comments(prId: number) {
      const id = requirePullRequestNumber(prId);
      return comments.get(String(id), async () => {
        const start = context.current();
        const { config, provider, vcsConfigured } = start;
        if (!provider || !vcsConfigured) return EMPTY_COMMENTS;
        if (!provider.fetchCommentThreads)
          throw new Error(`Provider ${provider.id} does not support comments`);
        const value = await provider.fetchCommentThreads(
          config.vendorAuth,
          config.vendorProject,
          id
        );
        context.assertUnchanged(start);
        return value;
      });
    },
    description(prId: number) {
      const id = requirePullRequestNumber(prId);
      return descriptions.get(String(id), async () => {
        const start = context.current();
        const { config, provider, vcsConfigured } = start;
        if (!vcsConfigured || !provider?.fetchPullRequestDescription) return '';
        const value = await provider.fetchPullRequestDescription(
          config.vendorAuth,
          config.vendorProject,
          id
        );
        context.assertUnchanged(start);
        return value;
      });
    },
    snapshot(value: unknown) {
      const req = request(value);
      return snapshots.get(JSON.stringify(req), () => {
        const { config, provider, vcsConfigured } = context.current();
        const read = vcsConfigured
          ? provider?.fetchPullRequestDetail?.bind(provider)
          : undefined;
        return readPullRequestSnapshot(req, {
          ...context.sources,
          detail:
            read && ((id) => read(config.vendorAuth, config.vendorProject, id)),
        });
      });
    },
    checks(value: unknown) {
      const req = request(value);
      return checks.get(JSON.stringify(req), () => {
        const { config, provider, vcsConfigured } = context.current();
        const read = vcsConfigured
          ? provider?.fetchPullRequestChecks?.bind(provider)
          : undefined;
        const detail = vcsConfigured
          ? provider?.fetchPullRequestDetail?.bind(provider)
          : undefined;
        return readPullRequestChecks(req, {
          ...context.sources,
          checks:
            read && ((id) => read(config.vendorAuth, config.vendorProject, id)),
          detail:
            detail &&
            ((id) => detail(config.vendorAuth, config.vendorProject, id)),
        });
      });
    },
    conversation(value: unknown) {
      const req = request(value);
      return conversations.get(JSON.stringify(req), () => {
        const { config, provider, vcsConfigured } = context.current();
        const read = vcsConfigured
          ? provider?.fetchPullRequestConversation?.bind(provider)
          : undefined;
        return readPullRequestConversation(req, {
          ...context.sources,
          conversation:
            read && ((id) => read(config.vendorAuth, config.vendorProject, id)),
        });
      });
    },
    invalidateRelated() {
      for (const cache of [snapshots, checks, conversations])
        cache.invalidate();
    },
    invalidate() {
      for (const cache of caches) cache.invalidate();
    },
    reset() {
      for (const cache of caches) cache.reset();
    },
    dispose() {
      for (const cache of caches) cache.dispose();
    },
  };
}
