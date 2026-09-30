import {
  parseSnapshotRequest,
  readPullRequestConversation,
  type PullRequestConversationRead,
} from '@n10/core';
import { openContext } from './open-context.js';
import { resolveProvider } from './program.js';
import { requireRepo } from './repo.js';

/**
 * One pull request's whole conversation, read by identity for the
 * renderer: threads with every reply, conversation comments, submitted
 * reviews and events.
 *
 * The request is parsed as untrusted before anything is read, and core
 * refuses it for any repository or account other than the open one,
 * before the read and after it. Read on demand for the pull request on
 * screen, never for sidebar rows.
 */
export async function getPullRequestConversation(
  request: unknown
): Promise<PullRequestConversationRead> {
  const req = parseSnapshotRequest(request);
  const cwd = requireRepo();
  const { config, provider, configured } = resolveProvider(cwd);
  const { vendorAuth: auth, vendorProject: project } = config;
  const read = configured
    ? provider?.fetchPullRequestConversation?.bind(provider)
    : undefined;
  return readPullRequestConversation(req, {
    ...openContext(cwd),
    conversation: read && ((prId) => read(auth, project, prId)),
  });
}
