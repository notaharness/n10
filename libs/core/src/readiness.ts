/**
 * Readiness, the check list and the review requirements, as a
 * browser-safe entry point.
 *
 * All are pure functions of a provider's reads: the host runs them in
 * `readPullRequestChecks`, and the web demo, which has no host, runs the
 * same ones over its own provider facts, so the words it shows are the
 * ones n10 would. Like `./plan`, nothing reachable from here may touch a
 * `node:` builtin: imports of `@n10/vcs-core` stay `import type`, and
 * values come from its browser-safe `./types` subpath.
 */

export {
  evaluateReadiness,
  type PullRequestReadiness,
  type ReadinessInputs,
  type ReadinessItem,
  type Resolver,
} from './lib/pull-requests/pr-readiness.js';

export {
  checkList,
  type CheckList,
  type CheckRow,
  type CheckStanding,
} from './lib/pull-requests/pr-check-list.js';

export {
  asksViewer,
  reviewRequirements,
  type RequirementReason,
  type ReviewerRequirement,
  type ReviewerStanding,
  type ReviewRequirements,
} from './lib/pull-requests/pr-review-requirements.js';
