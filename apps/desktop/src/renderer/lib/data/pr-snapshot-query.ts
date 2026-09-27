import { useQuery } from '@tanstack/react-query';
import { describePullRequest, samePullRequest } from '@n10/vcs-core/pr-details';
import type {
  PullRequestRef,
  PullRequestSnapshot,
  RepoInfo,
} from '../../../host/contract.js';
import { keys } from './query-keys.js';

/**
 * The selected pull request, read by identity. Split from `queries.ts`
 * so the identity rules it keeps sit in one place.
 */

/**
 * The ref naming pull request `prId` in the open repository, or null
 * while the repository has no provider to qualify it with.
 */
export function pullRequestRefFor(
  repo: RepoInfo,
  prId: number
): PullRequestRef | null {
  return repo.repository && prId > 0
    ? { ...repo.repository, number: prId }
    : null;
}

/**
 * One pull request by identity, read as the account the renderer knows.
 *
 * What keeps repo A's #42 apart from repo B's is the key: it names the
 * provider, host, repository, the repository's id where known, the
 * number and the account, and the repository-scoped cache is dropped on
 * a switch. The host refuses a request for a repository or an account
 * that is no longer the open one, before and after its reads. The echo
 * check here is the last line: an answer about a different pull request,
 * or read as a different account, is an error, never data in this entry.
 */
export async function loadPullRequestSnapshot(
  ref: PullRequestRef,
  viewer: string | null
): Promise<PullRequestSnapshot> {
  const answer = await window.n10.getPullRequestSnapshot({ ref, viewer });
  if (!samePullRequest(answer.ref, ref)) {
    throw new Error(
      `Expected an answer about ${describePullRequest(
        ref
      )}, got one about ${describePullRequest(answer.ref)}`
    );
  }
  if (answer.viewer?.toLowerCase() !== viewer?.toLowerCase()) {
    throw new Error(
      `Expected an answer read as ${viewer ?? 'no account'}, got one read as ${
        answer.viewer ?? 'no account'
      }`
    );
  }
  return answer;
}

/** Placeholder while there is no ref; the query is disabled then. */
const NO_REF: PullRequestRef = {
  provider: '',
  host: '',
  repository: '',
  number: 0,
};

export function usePullRequestSnapshot(
  cwd: string,
  ref: PullRequestRef | null,
  viewer: string | null
) {
  return useQuery({
    queryKey: keys.prSnapshot(cwd, ref ?? NO_REF, viewer),
    queryFn: () => loadPullRequestSnapshot(ref!, viewer),
    enabled: ref != null,
    staleTime: 60_000,
  });
}
