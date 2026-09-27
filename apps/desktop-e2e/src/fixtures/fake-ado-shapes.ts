import { createHash } from 'node:crypto';
import type {
  FakeAdoPr,
  FakeAdoReviewer,
  FakeAdoThread,
  FakeAzureDevOps,
} from '../setup/fake-ado.js';

/**
 * Azure DevOps response bodies, built from a scenario.
 *
 * Constructed from the REST API 7.1 reference, not recorded: no
 * pull request, reviewer or thread response has been captured from a
 * real organization (`libs/vcs/azure-devops/src/lib/__fixtures__/`
 * holds statuses and builds). Every documented field is here,
 * including the ones n10 does not read yet, so a provider change that
 * starts reading one finds it where Azure would put it. Ids are
 * deterministic — derived from names — so a test can predict them.
 */

/** A stable GUID for a name, formatted the way Azure formats ids. */
export function guid(name: string): string {
  const h = createHash('sha1').update(name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(
    17,
    20
  )}-${h.slice(20, 32)}`;
}

/** A stable 40-hex commit id for a label. */
export function commitId(label: string): string {
  return createHash('sha1').update(label).digest('hex');
}

export interface Coordinates {
  origin: string;
  org: string;
  project: string;
  repo: string;
}

export function coordinates(
  origin: string,
  scenario: FakeAzureDevOps
): Coordinates {
  return {
    origin,
    org: scenario.org ?? 'n10-org',
    project: scenario.project ?? 'n10-project',
    repo: scenario.repo ?? 'fixture',
  };
}

export function repoUrl(c: Coordinates): string {
  return `${c.origin}/${c.org}/${c.project}/_apis/git/repositories/${guid(
    c.repo
  )}`;
}

/** `IdentityRef`. `uniqueName` is an email for a person, and a
 *  `vstfs:///Classification/TeamProject/…\Team` path for a team. */
export function identity(
  c: Coordinates,
  name: string,
  opts: { uniqueName?: string; isContainer?: boolean } = {}
): Record<string, unknown> {
  const id = guid(name);
  const uniqueName =
    opts.uniqueName ??
    (opts.isContainer
      ? `vstfs:///Classification/TeamProject/${guid(c.project)}\\${name}`
      : `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`);
  return {
    displayName: opts.isContainer ? `[${c.project}]\\${name}` : name,
    url: `${c.origin}/${c.org}/_apis/Identities/${id}`,
    _links: {
      avatar: {
        href: `${c.origin}/${c.org}/_apis/GraphProfile/MemberAvatars/${id}`,
      },
    },
    id,
    uniqueName,
    imageUrl: `${c.origin}/${c.org}/_api/_common/identityImage?id=${id}`,
    ...(opts.isContainer ? { isContainer: true } : {}),
  };
}

/** `IdentityRefWithVote`. A teammate's vote for a team names the team
 *  in `votedFor`, and the team's own row carries the same vote. */
export function reviewer(
  c: Coordinates,
  pr: FakeAdoPr,
  r: FakeAdoReviewer
): Record<string, unknown> {
  const base = identity(c, r.name, r);
  const withVote = (ref: Record<string, unknown>, vote: number) => ({
    reviewerUrl: `${repoUrl(c)}/pullRequests/${pr.id}/reviewers/${ref.id}`,
    vote,
    hasDeclined: r.hasDeclined ?? false,
    isRequired: r.isRequired ?? false,
    isFlagged: false,
    ...ref,
  });
  const votedFor = (r.votedFor ?? []).map((team) =>
    withVote(identity(c, team, { isContainer: true }), 0)
  );
  return {
    ...withVote(base, r.vote ?? 0),
    ...(votedFor.length > 0 ? { votedFor } : {}),
  };
}

function prAuthor(c: Coordinates, scenario: FakeAzureDevOps, pr: FakeAdoPr) {
  return pr.author
    ? identity(c, pr.author)
    : identity(c, scenario.user.displayName, {
        uniqueName: scenario.user.uniqueName,
      });
}

/** `GitPullRequest`, as both the list and the single read return it. */
export function pullRequest(
  c: Coordinates,
  scenario: FakeAzureDevOps,
  pr: FakeAdoPr
): Record<string, unknown> {
  const repoId = guid(c.repo);
  const commit = (id: string) => ({
    commitId: id,
    url: `${repoUrl(c)}/commits/${id}`,
  });
  return {
    repository: {
      id: repoId,
      name: c.repo,
      url: repoUrl(c),
      project: {
        id: guid(c.project),
        name: c.project,
        state: 'unchanged',
        visibility: 'unchanged',
        lastUpdateTime: '0001-01-01T00:00:00',
      },
    },
    pullRequestId: pr.id,
    codeReviewId: pr.id,
    status: pr.status ?? 'active',
    createdBy: prAuthor(c, scenario, pr),
    creationDate: '2026-09-20T10:15:00.000Z',
    title: pr.title,
    description: pr.description ?? '',
    sourceRefName: `refs/heads/${pr.sourceBranch}`,
    targetRefName: `refs/heads/${pr.targetBranch ?? 'main'}`,
    mergeStatus: 'succeeded',
    isDraft: pr.isDraft ?? false,
    mergeId: guid(`merge-${pr.id}`),
    lastMergeSourceCommit: commit(commitId(`source-${pr.id}`)),
    lastMergeTargetCommit: commit(commitId(`target-${pr.id}`)),
    lastMergeCommit: commit(commitId(`merge-${pr.id}`)),
    reviewers: (pr.reviewers ?? []).map((r) => reviewer(c, pr, r)),
    url: `${repoUrl(c)}/pullRequests/${pr.id}`,
    supportsIterations: true,
  };
}

/** `Comment`. `commentType` is a name on the way out, a number on the
 *  way in — Azure accepts both and answers with the name. */
export function comment(
  c: Coordinates,
  id: number,
  author: Record<string, unknown>,
  content: string,
  opts: { parentCommentId?: number; system?: boolean; date?: string } = {}
): Record<string, unknown> {
  const date = opts.date ?? '2026-09-21T09:00:00.000Z';
  return {
    id,
    parentCommentId: opts.parentCommentId ?? 0,
    author,
    content,
    publishedDate: date,
    lastUpdatedDate: date,
    lastContentUpdatedDate: date,
    commentType: opts.system ? 'system' : 'text',
    usersLiked: [],
  };
}

/** `GitPullRequestCommentThread`. A thread without a path is a general
 *  comment, which Azure sends with `threadContext: null`. */
export function thread(
  c: Coordinates,
  pr: FakeAdoPr,
  t: FakeAdoThread & { id: number }
): Record<string, unknown> {
  const anchor = t.line != null ? { line: t.line, offset: 1 } : undefined;
  const side = t.side === 'LEFT' ? 'left' : 'right';
  const threadContext = t.path
    ? {
        filePath: `/${t.path}`,
        ...(anchor
          ? { [`${side}FileStart`]: anchor, [`${side}FileEnd`]: anchor }
          : {}),
      }
    : null;
  const comments = t.comments.map((body, i) =>
    comment(c, i + 1, identity(c, body.author), body.body, {
      parentCommentId: i === 0 ? 0 : 1,
      system: t.system,
      date: body.publishedDate,
    })
  );
  return {
    pullRequestThreadContext: t.path
      ? {
          iterationContext: {
            firstComparingIteration: 1,
            secondComparingIteration: pr.iterations ?? 1,
          },
          changeTrackingId: 1,
        }
      : null,
    id: t.id,
    publishedDate: '2026-09-21T09:00:00.000Z',
    lastUpdatedDate: '2026-09-21T09:00:00.000Z',
    comments,
    status: t.status ?? 'active',
    threadContext,
    // Property values arrive wrapped with their .NET type.
    properties: t.system
      ? {
          CodeReviewThreadType: {
            $type: 'System.String',
            $value: 'VoteUpdate',
          },
        }
      : {},
    identities: null,
    isDeleted: false,
    _links: {
      self: {
        href: `${repoUrl(c)}/pullRequests/${pr.id}/threads/${t.id}`,
      },
    },
  };
}

/** `/_apis/connectiondata`: who the PAT belongs to. */
export function connectionData(
  c: Coordinates,
  scenario: FakeAzureDevOps
): Record<string, unknown> {
  return {
    authenticatedUser: {
      id: guid(scenario.user.displayName),
      descriptor: `aad.${guid(scenario.user.uniqueName)}`,
      providerDisplayName: scenario.user.displayName,
      isActive: true,
      properties: {
        Account: { $type: 'System.String', $value: scenario.user.uniqueName },
      },
    },
    instanceId: guid(c.org),
  };
}
