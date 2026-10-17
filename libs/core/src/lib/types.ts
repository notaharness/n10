import type { PullRequestInfo } from '@n10/vcs-core';
import type { BabysitStatus } from './babysit/babysit-model.js';

export type Focus = 'sidebar' | 'terminal';

export type PaneMode =
  | 'terminal'
  | 'pr-detail'
  | 'diff'
  | 'diff-file'
  | 'comments'
  | 'confirm'
  | 'plan-checkout';

export type ReviewCategory = 'needs-review' | 'waiting' | 'approved';

export type SidebarItem =
  | {
      kind: 'session';
      session: AgentSession;
      pr?: PullRequestInfo;
      /** The viewer authored `pr`. Only then does the row file under the
       *  pull request sections: a checkout of someone else's pull
       *  request that no review section lists is a worktree row. */
      authored?: boolean;
      branch?: string;
      isMerged: boolean;
      conflictCount?: number;
      /** Set while the pull request is being babysat. */
      babysit?: BabysitStatus;
    }
  | {
      kind: 'orphan-pr';
      pr: PullRequestInfo;
      running?: boolean;
      /** PTY session name when the PR's branch has a worktree session. */
      sessionName?: string;
      babysit?: BabysitStatus;
    }
  | {
      kind: 'review-pr';
      pr: PullRequestInfo;
      category: ReviewCategory;
      running?: boolean;
      /** PTY session name when the PR's branch has a worktree session. */
      sessionName?: string;
      babysit?: BabysitStatus;
    };

/** Extract the PR from any sidebar item kind. */
export function getPrFromItem(item: SidebarItem): PullRequestInfo | undefined {
  return item.pr;
}

/** Stable identity key for a sidebar item. Survives list reorders. */
export function getItemKey(item: SidebarItem): string {
  if (item.kind === 'session') return `session:${item.session.name}`;
  if (item.kind === 'orphan-pr') return `orphan:${item.pr.id}`;
  return `review:${item.pr.id}`;
}

/** Whether this sidebar item represents an active (running) agent session. */
export function isItemActive(item: SidebarItem): boolean {
  if (item.kind === 'session') return item.session.running;
  return item.running === true;
}

export interface AgentSession {
  name: string;
  label?: string;
  running: boolean;
  /** Mirrors `WorktreeInfo.state` — set when the worktree is mid-rebase. */
  state?: 'rebasing';
  /** The branch checked out in the worktree now; `''` on a detached
   *  HEAD. */
  branch?: string;
  /** The worktree's checkout directory — its identity, which a branch
   *  switch inside it does not change. */
  path?: string;
  /** The branch the agent session in this worktree was created for,
   *  set only when the worktree has since switched to another one. */
  sessionBranch?: string;
  /** The checkout is gone — removed, by n10 or not, while its agent
   *  ran — and the agent still runs. The row lasts as long as the agent
   *  does, so it can be seen and stopped (`strandedSessionRows`). */
  worktreeRemoved?: true;
}

export type { DiffFile, FileCategory } from '@n10/diff';
export type {
  ReviewComment,
  ReviewCommentsFile,
  CommentSeverity,
} from '@n10/review-comments';
