import type { MentionCandidate, PullRequestRef } from '@n10/vcs-core';
import {
  assertSameContext,
  parseSnapshotRequest,
  type SnapshotRequest,
  type SnapshotSources,
} from './pr-snapshot.js';

/** Longer than any name or login a reviewer types after `@`. */
const MAX_QUERY = 100;

export interface MentionSearchRequest extends SnapshotRequest {
  query: string;
}

/**
 * The people a comment on this pull request can mention, found by the
 * provider's own search. Refused, like every read by identity, for any
 * repository or account other than the one asked about.
 */
export interface MentionSearch {
  ref: PullRequestRef;
  query: string;
  candidates: MentionCandidate[];
}

export interface MentionSources
  extends Pick<SnapshotSources, 'repository' | 'viewer'> {
  /** Absent when the provider cannot search people. */
  search?: (query: string) => Promise<MentionCandidate[]>;
}

export function parseMentionSearchRequest(
  value: unknown
): MentionSearchRequest {
  const req = parseSnapshotRequest(value);
  const { query } = value as Record<string, unknown>;
  if (typeof query !== 'string' || query.length > MAX_QUERY) {
    throw new TypeError('Invalid mention query');
  }
  return { ...req, query };
}

export async function searchMentions(
  req: MentionSearchRequest,
  src: MentionSources
): Promise<MentionSearch> {
  const viewer = assertSameContext(req, src);
  if (!src.search) {
    throw new Error("This provider can't search for people to mention");
  }
  const candidates = await src.search(req.query);
  assertSameContext({ ...req, viewer }, src);
  return { ref: req.ref, query: req.query, candidates };
}
