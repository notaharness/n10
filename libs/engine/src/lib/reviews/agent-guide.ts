import { agentCommentRepository } from '@n10/core';
import { readGuide, type GuidedReview } from '@n10/review-comments';
import { createReadResource, type ReadResource } from './read-resource.js';
import { requirePullRequestNumber } from './review-context.js';

/** What a guide read answers: the pull request's guide, if it has one. */
export interface AgentGuideRead {
  guide: GuidedReview | null;
}

/**
 * The review agent's guided review of each pull request, read from
 * beside its findings: the same store, keyed by the common Git
 * directory, so every checkout of the repository sees one guide.
 */
export function createAgentGuide(repo: string) {
  let repository: string | undefined;
  const store = () => (repository ??= agentCommentRepository(repo));
  const resources = new Map<number, ReadResource<AgentGuideRead>>();
  return {
    resource(prId: number): ReadResource<AgentGuideRead> {
      requirePullRequestNumber(prId);
      let value = resources.get(prId);
      if (!value) {
        value = createReadResource(
          async () => ({ guide: readGuide(store(), prId) }),
          250
        );
        resources.set(prId, value);
      }
      return value;
    },
  };
}
