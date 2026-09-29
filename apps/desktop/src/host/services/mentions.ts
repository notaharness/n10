import {
  parseMentionSearchRequest,
  searchMentions,
  type MentionSearch,
} from '@n10/core';
import { openContext } from './open-context.js';
import { resolveProvider } from './pull-requests.js';
import { requireRepo } from './repo.js';

/**
 * People a comment on the pull request on screen can mention, through
 * the configured provider's own search. The request is parsed as
 * untrusted and core refuses it for any other repository or account.
 */
export async function searchMentionCandidates(
  request: unknown
): Promise<MentionSearch> {
  const req = parseMentionSearchRequest(request);
  const cwd = requireRepo();
  const { config, provider, configured } = resolveProvider(cwd);
  const { vendorAuth: auth, vendorProject: project } = config;
  const search = configured
    ? provider?.searchMentionCandidates?.bind(provider)
    : undefined;
  return searchMentions(req, {
    ...openContext(cwd),
    search: search && ((query) => search(auth, project, query)),
  });
}
