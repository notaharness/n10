/**
 * Pull request reads addressed by identity: which pull request, read as
 * whom, and which commits its provider reports.
 *
 * Split from `contract.ts` because it is one subject. The types are
 * `@n10/core`'s and `@n10/vcs-core`'s own — the host passes the core
 * snapshot through unchanged — so the renderer and the TUI read the
 * same shape.
 */

export type {
  DiscardDraftRequest,
  DraftsRequest,
  DraftTarget,
  MentionSearch,
  MentionSearchRequest,
  SubmitReviewRequest,
  SubmittedReview,
  Publication,
  PullRequestConversationRead,
  PullRequestSnapshot,
  ReviewDraft,
  ReviewDiffText,
  ReviewDrafts,
  SaveDraftRequest,
  AspectState,
  CheckList,
  CheckRow,
  CheckStanding,
  PullRequestChecksAnswer,
  PullRequestReadiness,
  ReadinessAspect,
  ReadinessItem,
  Resolver,
  SnapshotRequest,
} from '@n10/core';
export type {
  Capability,
  MentionCandidate,
  ConversationActor,
  ConversationComment,
  ConversationEvent,
  ConversationEventKind,
  ConversationThread,
  Coverage,
  LineRange,
  PullRequestConversation,
  ReviewState,
  ReviewSummary,
  ThreadAnchor,
  ThreadStatus,
  Oid,
  PullRequestCheck,
  PullRequestChecks,
  RequiredCheck,
  PullRequestDetail,
  PullRequestLifecycle,
  PullRequestRef,
  ReadOutcome,
  RepositoryRef,
} from '@n10/vcs-core';
