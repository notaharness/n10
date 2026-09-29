import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A pull request on Azure DevOps, for `fixtures/fake-ado.mjs` to serve
 * the app offline. A test describes reviewers and policies in a few
 * words; this writes them out as the REST API returns them, so the
 * provider's own parsing is what the test drives.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** The main-process preload that answers Azure DevOps's API; the
 *  fixture passes it to Electron as `-r`. */
export const FAKE_ADO_PRELOAD = join(HERE, '..', 'fixtures', 'fake-ado.cjs');

export interface FakeAdoReviewer {
  /** The account or group's id; a policy names reviewers by it. */
  id: string;
  name: string;
  /** Azure's vote: 10 approved, 5 with suggestions, -5 waiting, -10
   *  rejected, 0 none. */
  vote?: number;
  required?: boolean;
  /** A group or team rather than a person. */
  group?: boolean;
}

/** A Required reviewers policy, as its evaluation reads. */
export interface FakeAdoPolicy {
  /** The policy's own display name; Azure's type name where unset. */
  name?: string;
  reviewers: string[];
  blocking?: boolean;
  approvals?: number;
  paths?: string[];
  status?: 'approved' | 'queued' | 'rejected' | 'notApplicable';
}

export interface FakeAdoPr {
  id: number;
  title: string;
  /** A branch in the test's repo: slash-free, as `git-repo.ts` seeds. */
  branch: string;
  author: { id: string; name: string; email: string };
  reviewers: FakeAdoReviewer[];
  policies?: FakeAdoPolicy[];
  description?: string;
}

export interface FakeAzure {
  org?: string;
  project?: string;
  repo?: string;
  viewer: { id: string; name: string; email: string };
  prs: FakeAdoPr[];
}

const REPO_ID = '5b0c8e8a-1f3e-4c4e-9d3a-2f6b7c8d9e01';
const PROJECT_ID = 'a9e2b3c4-5d6e-4f70-8a91-b2c3d4e5f601';
const HEAD = '3333333333333333333333333333333333333333';
const REQUIRED_REVIEWERS = 'fd2167ab-b0be-447a-8ec8-39368250530e';

function names(s: FakeAzure) {
  return {
    org: s.org ?? 'contoso',
    project: s.project ?? 'Fabrikam',
    repo: s.repo ?? 'fabrikam-app',
  };
}

function rawReviewer(r: FakeAdoReviewer) {
  return {
    id: r.id,
    displayName: r.name,
    uniqueName: r.group ? `[Fabrikam]\\${r.name}` : `${r.id}@contoso.example`,
    vote: r.vote ?? 0,
    hasDeclined: false,
    isRequired: r.required ?? false,
    isContainer: r.group ?? false,
    isFlagged: false,
  };
}

function rawPr(s: FakeAzure, pr: FakeAdoPr) {
  const { project, repo } = names(s);
  return {
    repository: {
      id: REPO_ID,
      name: repo,
      project: { id: PROJECT_ID, name: project },
    },
    pullRequestId: pr.id,
    codeReviewId: pr.id,
    status: 'active',
    createdBy: {
      id: pr.author.id,
      displayName: pr.author.name,
      uniqueName: pr.author.email,
    },
    creationDate: '2026-09-22T09:30:00.000Z',
    title: pr.title,
    description: pr.description ?? '',
    sourceRefName: `refs/heads/${pr.branch}`,
    targetRefName: 'refs/heads/main',
    mergeStatus: 'succeeded',
    isDraft: false,
    lastMergeSourceCommit: { commitId: HEAD },
    lastMergeTargetCommit: { commitId: 'b'.repeat(40) },
    reviewers: pr.reviewers.map(rawReviewer),
  };
}

function evaluation(pr: number, p: FakeAdoPolicy, n: number) {
  return {
    evaluationId: `00000000-0000-4000-9000-${String(pr * 100 + n).padStart(
      12,
      '0'
    )}`,
    artifactId: `vstfs:///CodeReview/CodeReviewId/${PROJECT_ID}/${pr}`,
    status: p.status ?? 'queued',
    context: null,
    configuration: {
      id: n + 1,
      isEnabled: true,
      isBlocking: p.blocking ?? true,
      type: { id: REQUIRED_REVIEWERS, displayName: 'Required reviewers' },
      settings: {
        requiredReviewerIds: p.reviewers,
        ...(p.approvals == null ? {} : { minimumApproverCount: p.approvals }),
        ...(p.paths ? { filenamePatterns: p.paths } : {}),
        ...(p.name ? { displayName: p.name } : {}),
        creatorVoteCounts: false,
        scope: [
          {
            refName: 'refs/heads/main',
            matchKind: 'Exact',
            repositoryId: REPO_ID,
          },
        ],
      },
    },
  };
}

/** The scenario as the shim reads it: Azure's own JSON. */
function raw(s: FakeAzure) {
  const { repo } = names(s);
  return {
    viewer: {
      id: s.viewer.id,
      providerDisplayName: s.viewer.name,
      properties: {
        Account: { $type: 'System.String', $value: s.viewer.email },
      },
    },
    repository: {
      id: REPO_ID,
      name: repo,
      defaultBranch: 'refs/heads/main',
      project: { id: PROJECT_ID },
    },
    prs: s.prs.map((pr) => rawPr(s, pr)),
    evaluations: Object.fromEntries(
      s.prs.map((pr) => [
        pr.id,
        (pr.policies ?? []).map((p, n) => evaluation(pr.id, p, n)),
      ])
    ),
    iterations: Object.fromEntries(
      s.prs.map((pr) => [
        pr.id,
        [{ id: 1, sourceRefCommit: { commitId: HEAD } }],
      ])
    ),
  };
}

/**
 * Write the scenario and return the environment that points the
 * preload at it. The preload reads the scenario on every request, so a
 * test may rewrite it with `installFakeAdo` again mid-run.
 */
export function installFakeAdo(
  homeDir: string,
  scenario: FakeAzure
): { N10_FAKE_ADO: string } {
  const path = join(homeDir, 'fake-ado.json');
  writeFileSync(path, JSON.stringify(raw(scenario), null, 2), 'utf8');
  return { N10_FAKE_ADO: path };
}

/** The project config that points the app at the fake, with
 *  `vendorProject` set so the git remote is not detected over it. */
export function fakeAdoProjectConfig(
  scenario: FakeAzure
): Record<string, unknown> {
  return { vendor: 'azure-devops', vendorProject: names(scenario) };
}

/** The global config's side: a token, never a real one, and the
 *  viewer's email, which is how Azure DevOps names them. */
export function fakeAdoGlobalConfig(
  scenario: FakeAzure
): Record<string, unknown> {
  return {
    email: scenario.viewer.email,
    vendorAuth: { 'azure-devops': { pat: 'fake-ado-token' } },
  };
}

/** The requests the fake had no answer for, as `METHOD url` lines. */
export function fakeAdoMisses(homeDir: string): string[] {
  const path = join(homeDir, 'fake-ado.json.misses');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}
