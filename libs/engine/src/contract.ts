/** Browser-safe data contract: no Node runtime imports. */
export type * from './lib/machines/machine-types.js';
export type * from './lib/plans/plan-types.js';

/** Structural clients injected by the shell; importing types runs no Node code. */
export type {
  ConfigService,
  ConfigSnapshot,
  PullRequestList,
  RemoteSync,
  WorktreeService,
  ReviewService,
  SessionService,
  DiffRequest,
  DiffRefs,
  ReadResource,
  ReadSnapshot,
  SyncNotice,
} from './index.js';
