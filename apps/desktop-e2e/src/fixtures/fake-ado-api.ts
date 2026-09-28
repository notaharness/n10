import type {
  FakeAdoPolicy,
  FakeAdoPr,
  FakeAzureDevOps,
} from '../setup/fake-ado.js';
import {
  commitId,
  guid,
  identity,
  repoUrl,
  type Coordinates,
} from './fake-ado-shapes.js';

/**
 * The response bodies n10 does not read yet — repositories, iterations
 * and policy evaluations — kept apart from the ones it does, which live
 * in `fake-ado-shapes.ts`. Served so the PR slices that start reading
 * them have something realistic to read.
 */

/** `GitRepository`. */
export function repository(c: Coordinates): Record<string, unknown> {
  return {
    id: guid(c.repo),
    name: c.repo,
    url: repoUrl(c),
    project: {
      id: guid(c.project),
      name: c.project,
      url: `${c.origin}/${c.org}/_apis/projects/${guid(c.project)}`,
      state: 'wellFormed',
      revision: 1,
      visibility: 'private',
    },
    defaultBranch: 'refs/heads/main',
    size: 1024,
    remoteUrl: `${c.origin}/${c.org}/${c.project}/_git/${c.repo}`,
    sshUrl: `git@ssh.dev.azure.com:v3/${c.org}/${c.project}/${c.repo}`,
    webUrl: `${c.origin}/${c.org}/${c.project}/_git/${c.repo}`,
    isDisabled: false,
    isInMaintenance: false,
  };
}

/** `GitPullRequestIteration[]`: one per push, the first a `create`. */
export function iterations(
  c: Coordinates,
  scenario: FakeAzureDevOps,
  pr: FakeAdoPr
): Record<string, unknown>[] {
  const author = identity(c, pr.author ?? scenario.user.displayName, {
    uniqueName: pr.author ? undefined : scenario.user.uniqueName,
  });
  const target = { commitId: commitId(`target-${pr.id}`) };
  return Array.from({ length: pr.iterations ?? 1 }, (_, i) => {
    const n = i + 1;
    const date = `2026-09-2${Math.min(n, 9)}T10:00:00.000Z`;
    return {
      id: n,
      description: n === 1 ? pr.title : `Push ${n}`,
      author,
      createdDate: date,
      updatedDate: date,
      sourceRefCommit: { commitId: commitId(`source-${pr.id}-${n}`) },
      targetRefCommit: target,
      commonRefCommit: target,
      hasMoreCommits: false,
      reason: n === 1 ? 'create' : 'push',
      push: { pushId: pr.id * 100 + n },
    };
  });
}

/** Policy type ids are fixed across every Azure organization. */
const POLICY_TYPES: Record<
  FakeAdoPolicy['name'],
  { id: string; settings: Record<string, unknown> }
> = {
  'Minimum number of reviewers': {
    id: 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd',
    settings: { minimumApproverCount: 2, creatorVoteCounts: false },
  },
  Build: {
    id: '0609b952-1397-4640-95ec-e00a01b2c241',
    settings: { buildDefinitionId: 442, queueOnSourceUpdateOnly: true },
  },
  'Comment requirements': {
    id: 'c6a1889d-b943-4856-b76f-9e46bb6b0df2',
    settings: {},
  },
};

/**
 * `PolicyEvaluationRecord[]` for the pull request named by the
 * `artifactId` query, `vstfs:///CodeReview/CodeReviewId/{project}/{pr}`.
 */
export function policyEvaluations(
  c: Coordinates,
  scenario: FakeAzureDevOps,
  query: URLSearchParams
): Record<string, unknown>[] {
  const artifactId = query.get('artifactId') ?? '';
  const prId = Number(artifactId.split('/').pop());
  const pr = scenario.prs.find((p) => p.id === prId);
  return (pr?.policies ?? []).map((policy, i) => {
    const type = POLICY_TYPES[policy.name];
    const configId = i + 1;
    const url = `${c.origin}/${c.org}/${guid(
      c.project
    )}/_apis/policy/configurations/${configId}`;
    return {
      configuration: {
        createdBy: identity(c, 'Project Administrator'),
        createdDate: '2026-01-01T00:00:00.000Z',
        isEnabled: true,
        isBlocking: policy.isBlocking ?? true,
        isDeleted: false,
        settings: {
          ...type.settings,
          scope: [
            {
              refName: 'refs/heads/main',
              matchKind: 'Exact',
              repositoryId: guid(c.repo),
            },
          ],
        },
        _links: { self: { href: url } },
        revision: 1,
        id: configId,
        url,
        type: {
          id: type.id,
          url: `${c.origin}/${c.org}/${guid(c.project)}/_apis/policy/types/${
            type.id
          }`,
          displayName: policy.name,
        },
      },
      artifactId,
      evaluationId: guid(`${prId}-${policy.name}`),
      startedDate: '2026-09-21T09:00:00.000Z',
      ...(policy.status === 'running' || policy.status === 'queued'
        ? {}
        : { completedDate: '2026-09-21T09:05:00.000Z' }),
      status: policy.status,
    };
  });
}
