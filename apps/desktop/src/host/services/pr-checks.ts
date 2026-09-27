import {
  parseSnapshotRequest,
  PullRequestIdentityError,
  readPullRequestChecks,
  type PullRequestChecksAnswer,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { lookupPullRequest, resolveProvider } from './pull-requests.js';
import { activeRepoIs, configuredRepository, requireRepo } from './repo.js';
import { configuredViewer } from './viewer.js';

/**
 * What stands between one pull request and completion, read by identity
 * for the renderer, the same way as its snapshot: the request is parsed
 * as untrusted, and core checks the repository and account around the
 * provider's read. The list cache supplies the unresolved conversations.
 */
export async function getPullRequestChecks(
  request: unknown
): Promise<PullRequestChecksAnswer> {
  const req = parseSnapshotRequest(request);
  const cwd = requireRepo();
  const { config, provider, configured } = resolveProvider(cwd);
  const { vendorAuth: auth, vendorProject: project } = config;
  const readChecks = configured
    ? provider?.fetchPullRequestChecks?.bind(provider)
    : undefined;
  return readPullRequestChecks(req, {
    repository: () => {
      if (!activeRepoIs(cwd)) {
        throw new PullRequestIdentityError(
          `${cwd} is no longer the repository open in n10`
        );
      }
      return configuredRepository(readConfig(cwd));
    },
    viewer: () => configuredViewer(readConfig(cwd)),
    lookup: (prId) => lookupPullRequest(cwd, prId),
    checks: readChecks && ((prId) => readChecks(auth, project, prId)),
  });
}
