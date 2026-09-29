import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ElectronApplication } from '@playwright/test';

/**
 * An Azure DevOps scenario as a test declares it, and the config that
 * points the app at the fake serving it (`fixtures/fake-ado.cjs`).
 *
 * The counterpart of `fake-gh.ts`. The Azure provider reaches Azure
 * through `fetch` with the host in every URL, so the fake is a preload
 * in the app's main process that answers `dev.azure.com` and
 * `vssps.dev.azure.com` itself. The scenario says what a test means,
 * not how it is served, so another transport can serve it unchanged.
 */

/** A reviewer row. `vote` is Azure's: 10 approved, 5 approved with
 *  suggestions, 0 none, -5 waiting for author, -10 rejected. */
export interface FakeAdoReviewer {
  name: string;
  vote?: 10 | 5 | 0 | -5 | -10;
  /** A team (group) reviewer rather than a person. */
  isContainer?: boolean;
  isRequired?: boolean;
  hasDeclined?: boolean;
  /** Defaults to `<name>@example.com` for a person, and to Azure's
   *  `vstfs:///…\<name>` path for a team. */
  uniqueName?: string;
}

/** A Required reviewers policy's evaluation on the pull request. */
export interface FakeAdoPolicy {
  name: 'Required reviewers';
  status: 'approved' | 'rejected' | 'running' | 'queued' | 'notApplicable';
  isBlocking?: boolean;
  /** The reviewers it names, by name. */
  reviewers: string[];
  /** The policy's own name; Azure shows the type's where unset. */
  displayName?: string;
  approvals?: number;
  /** The file filters it applies to. */
  paths?: string[];
}

export interface FakeAdoPr {
  id: number;
  title: string;
  /** A branch that exists in the test repo: slash-free, as
   *  `git-repo.ts` seeds. */
  sourceBranch: string;
  targetBranch?: string;
  /** Display name. Defaults to the scenario's user — *your* PR. */
  author?: string;
  description?: string;
  reviewers?: FakeAdoReviewer[];
  policies?: FakeAdoPolicy[];
}

export interface FakeAzureDevOps {
  org?: string;
  project?: string;
  repo?: string;
  pat?: string;
  /** Whose PAT it is — `/connectiondata`'s authenticated user. */
  user: { displayName: string; uniqueName: string };
  prs: FakeAdoPr[];
}

export const FAKE_ADO_PAT = 'fake-ado-pat';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The main-process preload that answers Azure DevOps's API; the
 *  fixture passes it to Electron as `-r`. */
export const FAKE_ADO_PRELOAD = join(HERE, '..', 'fixtures', 'fake-ado.cjs');

/** A stable GUID for a name, formatted the way Azure formats ids. */
export function guid(name: string): string {
  const h = createHash('sha1').update(name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(
    17,
    20
  )}-${h.slice(20, 32)}`;
}

function coordinates(s: FakeAzureDevOps) {
  return {
    org: s.org ?? 'n10-org',
    project: s.project ?? 'n10-project',
    repo: s.repo ?? 'fixture',
  };
}

/** `IdentityRef`: an email for a person, a project path for a team,
 *  whose display name Azure prefixes with the project. */
function identity(
  project: string,
  name: string,
  opts: { uniqueName?: string; isContainer?: boolean } = {}
) {
  const uniqueName =
    opts.uniqueName ??
    (opts.isContainer
      ? `vstfs:///Classification/TeamProject/${guid(project)}\\${name}`
      : `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`);
  return {
    id: guid(name),
    displayName: opts.isContainer ? `[${project}]\\${name}` : name,
    uniqueName,
    ...(opts.isContainer ? { isContainer: true } : {}),
  };
}

/** A stable 40-hex commit id for a label. */
const commitId = (label: string) =>
  createHash('sha1').update(label).digest('hex');

function pullRequest(s: FakeAzureDevOps, pr: FakeAdoPr) {
  const { project, repo } = coordinates(s);
  const author = pr.author ?? s.user.displayName;
  return {
    repository: {
      id: guid(repo),
      name: repo,
      project: { id: guid(project), name: project },
    },
    pullRequestId: pr.id,
    codeReviewId: pr.id,
    status: 'active',
    createdBy: identity(project, author, {
      uniqueName: pr.author ? undefined : s.user.uniqueName,
    }),
    creationDate: '2026-09-22T09:30:00.000Z',
    title: pr.title,
    description: pr.description ?? '',
    sourceRefName: `refs/heads/${pr.sourceBranch}`,
    targetRefName: `refs/heads/${pr.targetBranch ?? 'main'}`,
    mergeStatus: 'succeeded',
    isDraft: false,
    lastMergeSourceCommit: { commitId: commitId(`source-${pr.id}`) },
    lastMergeTargetCommit: { commitId: commitId(`target-${pr.id}`) },
    reviewers: (pr.reviewers ?? []).map((r) => ({
      ...identity(project, r.name, r),
      vote: r.vote ?? 0,
      hasDeclined: r.hasDeclined ?? false,
      isRequired: r.isRequired ?? false,
      isFlagged: false,
    })),
  };
}

/** `PolicyEvaluationRecord` for a Required reviewers policy. */
function evaluation(s: FakeAzureDevOps, pr: FakeAdoPr, p: FakeAdoPolicy) {
  const { project, repo } = coordinates(s);
  return {
    evaluationId: guid(`evaluation-${pr.id}-${p.reviewers.join(',')}`),
    artifactId: `vstfs:///CodeReview/CodeReviewId/${guid(project)}/${pr.id}`,
    status: p.status,
    context: null,
    configuration: {
      isEnabled: true,
      isBlocking: p.isBlocking ?? true,
      type: { id: 'fd2167ab-b0be-447a-8ec8-39368250530e', displayName: p.name },
      settings: {
        requiredReviewerIds: p.reviewers.map(guid),
        ...(p.approvals == null ? {} : { minimumApproverCount: p.approvals }),
        ...(p.paths ? { filenamePatterns: p.paths } : {}),
        ...(p.displayName ? { displayName: p.displayName } : {}),
        creatorVoteCounts: false,
        scope: [
          {
            refName: 'refs/heads/main',
            matchKind: 'Exact',
            repositoryId: guid(repo),
          },
        ],
      },
    },
  };
}

/** The scenario as the preload reads it: Azure's own JSON. */
function served(s: FakeAzureDevOps) {
  const { project, repo } = coordinates(s);
  const byId = <T>(read: (pr: FakeAdoPr) => T) =>
    Object.fromEntries(s.prs.map((pr) => [pr.id, read(pr)]));
  return {
    viewer: {
      id: guid(s.user.displayName),
      providerDisplayName: s.user.displayName,
      properties: {
        Account: { $type: 'System.String', $value: s.user.uniqueName },
      },
    },
    repository: {
      id: guid(repo),
      name: repo,
      defaultBranch: 'refs/heads/main',
      project: { id: guid(project) },
    },
    prs: s.prs.map((pr) => pullRequest(s, pr)),
    evaluations: byId((pr) =>
      (pr.policies ?? []).map((p) => evaluation(s, pr, p))
    ),
    iterations: byId((pr) => {
      const target = { commitId: commitId(`target-${pr.id}`) };
      return [
        {
          id: 1,
          sourceRefCommit: { commitId: commitId(`source-${pr.id}-1`) },
          targetRefCommit: target,
          commonRefCommit: target,
        },
      ];
    }),
    // Written into the app's config by the preload itself, so a run
    // whose preload did not load has no token and asks Azure nothing.
    globalConfig: fakeAdoGlobalConfig(s),
  };
}

/**
 * Write the scenario and return the environment that points the
 * preload at it. The preload reads it on every request, so a test may
 * write it again mid-run; the token it writes into the config once, as
 * the app starts.
 */
export function installFakeAdo(
  homeDir: string,
  scenario: FakeAzureDevOps
): { N10_FAKE_ADO: string } {
  const path = join(homeDir, 'fake-ado.json');
  writeFileSync(path, JSON.stringify(served(scenario), null, 2), 'utf8');
  return { N10_FAKE_ADO: path };
}

/** Whether the preload is in the app's main process. */
export async function fakeAdoLoaded(
  app: ElectronApplication
): Promise<boolean> {
  const loaded = await app.evaluate(
    () => (globalThis as { __n10FakeAzure?: boolean }).__n10FakeAzure
  );
  return loaded === true;
}

/** The requests the fake had no answer for, as `METHOD url` lines. */
export function fakeAdoMisses(homeDir: string): string[] {
  const path = join(homeDir, 'fake-ado.json.misses');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}

/**
 * The per-project config that points the app at the fake.
 * `vendorProject` must be present or the host auto-detects from the Git
 * remote and overwrites it; `email` is who `matchesUser` takes you for.
 */
export function fakeAdoProjectConfig(
  scenario: FakeAzureDevOps
): Record<string, unknown> {
  return {
    vendor: 'azure-devops',
    vendorProject: coordinates(scenario),
    email: scenario.user.uniqueName,
  };
}

/** The global config half: the PAT lives under `vendorAuth`. */
export function fakeAdoGlobalConfig(
  scenario: FakeAzureDevOps
): Record<string, unknown> {
  return {
    vendorAuth: {
      'azure-devops': { pat: scenario.pat ?? FAKE_ADO_PAT },
    },
  };
}
