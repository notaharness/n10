import {
  CI_LOG_TAIL_LINES,
  type CiLog,
  type CiLogRef,
  type CiOverview,
  type VcsProvider,
} from '@n10/vcs-core';
import type {
  ProviderResolution,
  PullRequestLookup,
} from './pull-request-cache.js';

/**
 * Read a pull request's CI through whichever provider the repository is
 * configured for. The head commit comes from the cached pull request
 * list, so opening the CI page costs no extra list read
 * (docs/design/ci-overview.md §1).
 */

export interface CiReadDeps {
  resolveProvider: (cwd: string) => ProviderResolution;
  lookupPullRequest: (cwd: string, prId: number) => Promise<PullRequestLookup>;
}

function configuredProvider(
  cwd: string,
  deps: CiReadDeps
): { provider: VcsProvider; resolution: ProviderResolution } {
  const resolution = deps.resolveProvider(cwd);
  if (!resolution.provider || !resolution.configured) {
    throw new Error(
      'No pull request provider is configured for this repository'
    );
  }
  return { provider: resolution.provider, resolution };
}

export async function readCiOverview(
  cwd: string,
  prId: number,
  deps: CiReadDeps
): Promise<CiOverview> {
  const { provider, resolution } = configuredProvider(cwd, deps);
  if (!provider.fetchCiOverview) {
    throw new Error(`n10 does not read CI from ${provider.displayName} yet`);
  }
  const found = await deps.lookupPullRequest(cwd, prId);
  if (found.kind === 'gone') {
    throw new Error(`Pull request #${prId} is no longer open`);
  }
  if (found.kind === 'unknown') throw new Error(found.reason);
  const { vendorAuth, vendorProject } = resolution.config;
  return provider.fetchCiOverview(vendorAuth, vendorProject, {
    id: prId,
    headSha: found.pr.headSha,
  });
}

/** The tail of one log. `ref` must name the configured provider: a
 *  reference from another would be read with the wrong credentials. */
export async function readCiLog(
  cwd: string,
  ref: CiLogRef,
  deps: CiReadDeps
): Promise<CiLog> {
  const { provider, resolution } = configuredProvider(cwd, deps);
  if (ref.provider !== provider.id || !provider.fetchCiLog) {
    throw new Error(`That log is not from ${provider.displayName}`);
  }
  const { vendorAuth, vendorProject } = resolution.config;
  return provider.fetchCiLog(vendorAuth, vendorProject, ref, CI_LOG_TAIL_LINES);
}
