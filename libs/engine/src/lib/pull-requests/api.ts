/** Public domain surface; neighboring domains import this entry. */
export { createPullRequestList } from './pull-request-list.js';
export type {
  PullRequestList,
  PullRequestListOptions,
} from './pull-request-list.js';
export {
  EMPTY_PULL_REQUEST_LIST,
  pullRequestPollIntervalMs,
} from './pull-request-snapshot.js';
export type { PullRequestListSnapshot } from './pull-request-snapshot.js';
export { providerResolver } from './pull-request-scope.js';
export type {
  ProviderResolution,
  ResolveProvider,
} from './pull-request-scope.js';
