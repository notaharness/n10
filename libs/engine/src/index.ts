// @n10/engine — the program both shells run.
//
// State, scheduling, caching and the events that announce them, over
// @n10/core's operations. Node only; no React, Ink or Electron. A
// shell creates the services it needs and renders what they report.
export * from './lib/pull-requests/pull-request-list.js';
export * from './lib/pull-requests/pull-request-snapshot.js';
export * from './lib/pull-requests/pull-request-scope.js';
export * from './lib/config/config-service.js';
export * from './lib/repositories/repository-service.js';
export * from './lib/sync/remote-sync.js';
export * from './lib/sync/sync-snapshot.js';
export {
  createWorktreeService,
  type WorktreeService,
  type WorktreeSnapshot,
} from './lib/worktrees/worktree-service.js';
export type {
  WorktreeWatchers,
  WorktreeTarget,
} from './lib/worktrees/worktree-commands.js';

export {
  createReviewService,
  type ReviewService,
} from './lib/reviews/review-service.js';
export {
  readResourceValue,
  type ReadResource,
  type ReadSnapshot,
} from './lib/reviews/read-resource.js';
export type {
  DiffRequest,
  DiffFiles,
  DiffRefs,
} from './lib/reviews/diff-reads.js';

export type {
  ReplyToReviewThread,
  ResolveReviewThread,
} from './lib/reviews/review-commands.js';
export type { PostAgentCommentsRequest } from './lib/reviews/agent-publication.js';

export {
  createSessionService,
  type SessionService,
  type SessionSnapshot,
  type SessionWatchPorts,
} from './lib/sessions/session-service.js';
export type {
  SessionLaunch,
  SessionLaunchPorts,
} from './lib/sessions/session-commands.js';
export { createTerminalService } from './lib/sessions/terminal-service.js';
export type {
  TerminalLaunch,
  TerminalPorts,
} from './lib/sessions/terminal-service.js';
export type { TerminalFacts } from './lib/sessions/terminal-facts.js';

export { createBabysitterService } from './lib/babysitters/babysitter-service.js';
export type {
  BabysitterEvent,
  BabysitterPorts,
} from './lib/babysitters/babysitter-service.js';
