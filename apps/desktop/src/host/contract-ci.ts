/**
 * CI (preview): a pull request's pipelines, their stages, jobs and
 * steps, and the tail of a log. The shapes are `@n10/vcs-core`'s own;
 * see docs/design/ci-overview.md for what each provider fills.
 */

export type {
  CiJob,
  CiLog,
  CiLogRef,
  CiOverview,
  CiPipeline,
  CiStage,
  CiStatus,
  CiStep,
} from '@n10/vcs-core';
