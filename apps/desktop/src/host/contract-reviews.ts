/**
 * Review requests: what the renderer sends the host to reply to a
 * thread, resolve one, launch or brief a review agent, and post the
 * agent's drafts.
 *
 * Split from `contract.ts` because it is one subject, and because that
 * file is a catalogue already.
 */

import type { SessionIncarnation } from '@n10/core';
import type {
  AgentId,
  PullRequestInfo,
  RemoteCommentThread,
} from '@n10/vcs-core';

export interface ReplyRequest {
  prId: number;
  thread: RemoteCommentThread;
  body: string;
}

export interface ResolveRequest {
  prId: number;
  thread: RemoteCommentThread;
  resolved: boolean;
}

/** Start a fresh AI review of a PR in its worktree session. */
export interface ReviewLaunchRequest {
  agentId?: AgentId;
  expected?: SessionIncarnation;
  pr: PullRequestInfo;
  /** Extra user instruction appended to the review task prompt. */
  instruction?: string;
  /** Ask the reviewer for a guided review too (`buildReviewLaunchRequest`'s
   *  `guide`); false, its prompt says nothing of one. Required: the
   *  launch dialog decides, never a default in the host. */
  guide: boolean;
  cols?: number;
  rows?: number;
  /** A beam peerId to launch on, or omitted for local (decisions.md
   *  D2). Only meaningful for a fresh worktree — an existing one is
   *  already qualified to whatever machine it was created on. */
  machine?: string;
  /** Set only alongside `machine`: correlates this launch's
   *  `onLaunchStep` events. Ignored for a local launch. */
  launchId?: string;
}

export type {
  PlanCheckoutRequest,
  PlanCheckoutResult,
} from '@n10/engine/contract';

export interface PostDraftsRequest {
  prId: number;
  /** Subset to post; every draft when omitted. */
  ids?: string[];
  /** Required for GitHub (review API). */
  headSha?: string;
  event?: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
}

/** An image embedded in a comment, fetched host-side with provider auth. */
export interface CommentImagePayload {
  dataUrl: string;
  contentType: string;
  bytes: number;
}
