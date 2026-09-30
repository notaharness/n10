import {
  parseSnapshotRequest,
  readPullRequestSnapshot,
  type PullRequestSnapshot,
} from '@n10/core';
import { resolveProvider } from './program.js';
import { identitySources } from './pr-identity.js';
import { requireRepo } from './repo.js';

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
    ...identitySources(cwd),
    detail: readDetail && ((prId) => readDetail(auth, project, prId)),
  });
}
