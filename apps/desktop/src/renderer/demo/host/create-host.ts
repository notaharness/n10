import type { N10HostApi } from '../../../host/contract.js';
import { PROGRAMS } from '../programs/index.js';
import { createFleetHost } from './fleet-host.js';
import { createPullRequestHost } from './pull-request-host.js';
import { createDraftsHost } from './review-drafts-host.js';
import { createMentionsHost } from './mentions-host.js';
import { createReviewHost } from './review-host.js';
import { createSessionHost } from './session-host.js';
import { SessionHub } from './sessions.js';
import { createShellHost } from './shell-host.js';
import { DemoState } from './state.js';
import { createWorktreeHost } from './worktree-host.js';

/**
 * The whole bridge, answered in the page. Typed against the contract,
 * so a method added to `N10HostApi` fails to compile here until the
 * demo answers it too.
 */
export function createDemoHost(): N10HostApi {
  const state = new DemoState();
  const hub = new SessionHub();
  PROGRAMS.boot(hub);
  return {
    ...createShellHost(state),
    ...createWorktreeHost(state, hub),
    ...createReviewHost(state),
    ...createPullRequestHost(state),
    ...createDraftsHost(),
    ...createMentionsHost(),
    ...createSessionHost(state, hub),
    ...createFleetHost(),
  };
}
