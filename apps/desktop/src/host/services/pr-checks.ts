import {
  parseSnapshotRequest,
  readPullRequestChecks,
  type PullRequestChecksAnswer,
} from '@n10/core';
import { resolveProvider } from './program.js';
import { identitySources } from './pr-identity.js';
import { requireRepo } from './repo.js';

/**
 * What stands between one pull request and completion, read by identity
 * for the renderer, the same way as its snapshot: the request is parsed
 * as untrusted, and core checks the repository and account around the
 * provider's read.
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
  const readDetail = configured
    ? provider?.fetchPullRequestDetail?.bind(provider)
    : undefined;
  return readPullRequestChecks(req, {
    ...identitySources(cwd),
    checks: readChecks && ((prId) => readChecks(auth, project, prId)),
    detail: readDetail && ((prId) => readDetail(auth, project, prId)),
  });
}
