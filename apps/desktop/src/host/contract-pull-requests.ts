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
  PullRequestChecksAnswer,
  PullRequestReadiness,
  PullRequestSnapshot,
  ReadinessItem,
  SnapshotRequest,
} from '@n10/core';
export type {
  Capability,
  Oid,
  PullRequestCheck,
  PullRequestChecks,
  PullRequestDetail,
  PullRequestLifecycle,
  PullRequestRef,
  ReadOutcome,
  RepositoryRef,
} from '@n10/vcs-core';
