import {
  parseSnapshotRequest,
  PullRequestIdentityError,
  readPullRequestSnapshot,
  type PullRequestSnapshot,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { lookupPullRequest, resolveProvider } from './pull-requests.js';
import { activeRepoIs, configuredRepository, requireRepo } from './repo.js';
import { configuredViewer } from './viewer.js';

/**
 * One pull request, read by identity for the renderer.
 *
 * The request arrives from a renderer that displays remote content, so
 * it is parsed as untrusted before anything is looked up. Core owns the
 * sequence — the identity checks, the list row and the provider's
 * detail — and this supplies the open repository's facts:
 * its provider, the account it reads as, and the shared list cache, so
 * the snapshot never costs the list a fetch of its own.
 */
export async function getPullRequestSnapshot(
  request: unknown
): Promise<PullRequestSnapshot> {
  const req = parseSnapshotRequest(request);
  const cwd = requireRepo();
  const { config, provider, configured } = resolveProvider(cwd);
  const { vendorAuth: auth, vendorProject: project } = config;
  const readDetail = configured
    ? provider?.fetchPullRequestDetail?.bind(provider)
    : undefined;
  return readPullRequestSnapshot(req, {
    // Read afresh on every check: the open repository, its config and
    // the account can all change while the reads are in flight.
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
    detail: readDetail && ((prId) => readDetail(auth, project, prId)),
  });
}
