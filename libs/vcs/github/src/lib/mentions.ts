import type { MentionCandidate, RepositoryRef } from '@n10/vcs-core';

/**
 * Who can be mentioned on a GitHub repository, from the GraphQL API's
 * own `mentionableUsers` search. A mention is the login.
 */

export const MENTIONABLE_USERS_QUERY = `query MentionableUsers($owner: String!, $repo: String!, $q: String!) {
  repository(owner: $owner, name: $repo) {
    mentionableUsers(query: $q, first: 8) { nodes { login name } }
  }
}`;

type GraphQL = (
  query: string,
  variables: Record<string, string>
) => Promise<unknown>;

interface Answer {
  data?: {
    repository?: {
      mentionableUsers?: {
        nodes?: ({ login?: string; name?: string | null } | null)[];
      };
    } | null;
  };
}

export async function searchGitHubMentions(
  graphql: GraphQL,
  repository: RepositoryRef,
  query: string
): Promise<MentionCandidate[]> {
  const [owner, repo] = repository.repository.split('/');
  if (!owner || !repo) throw new Error('GitHub project not configured');
  const answer = (await graphql(MENTIONABLE_USERS_QUERY, {
    owner,
    repo,
    q: query,
  })) as Answer;
  const nodes = answer.data?.repository?.mentionableUsers?.nodes ?? [];
  return nodes.flatMap((n) =>
    n?.login
      ? [
          {
            token: `@${n.login}`,
            displayName: n.name || n.login,
            handle: n.login,
          },
        ]
      : []
  );
}
