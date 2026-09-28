/**
 * An Azure DevOps scenario as a test declares it, and the config that
 * points the app at the fake serving it (`fixtures/fake-ado.ts`).
 *
 * The counterpart of `fake-gh.ts`. The GitHub provider reaches GitHub
 * through `gh`, so a fake on PATH is the whole seam; the Azure provider
 * uses `fetch`, so the seam is `N10_ADO_ORIGIN`, which sends every
 * request (`dev.azure.com` and `vssps.dev.azure.com` alike) to a
 * loopback HTTP server started in the Playwright worker. The provider
 * and the draft poster are otherwise the production code, PAT header
 * and all.
 */

/** A reviewer row. `vote` is Azure's: 10 approved, 5 approved with
 *  suggestions, 0 none, -5 waiting for author, -10 rejected. */
export interface FakeAdoReviewer {
  name: string;
  vote?: 10 | 5 | 0 | -5 | -10;
  /** A team (group) reviewer rather than a person. */
  isContainer?: boolean;
  /** Team names this person's vote was cast for. Azure lists the team's
   *  row with the same vote, so declare the team's `vote` too. */
  votedFor?: string[];
  isRequired?: boolean;
  hasDeclined?: boolean;
  /** Defaults to `<name>@example.com` for a person, and to Azure's
   *  `vstfs:///…\<name>` path for a team. */
  uniqueName?: string;
}

/** A comment thread. Leave `path` off for a general comment. */
export interface FakeAdoThread {
  id?: number;
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  status?: 'active' | 'fixed' | 'wontFix' | 'closed' | 'byDesign' | 'pending';
  /** A system thread (a vote update), which n10 filters out. */
  system?: boolean;
  comments: { author: string; body: string; publishedDate?: string }[];
}

/** A policy evaluation on the pull request, as the policy API reports
 *  it. n10 does not read these yet; they are served for the slices
 *  that will. */
export interface FakeAdoPolicy {
  name: 'Minimum number of reviewers' | 'Build' | 'Comment requirements';
  status: 'approved' | 'rejected' | 'running' | 'queued' | 'notApplicable';
  isBlocking?: boolean;
}

export interface FakeAdoPr {
  id: number;
  title: string;
  /** A branch that exists in the test repo, for a real diff. */
  sourceBranch: string;
  targetBranch?: string;
  /** Display name. Defaults to the scenario's user — *your* PR. */
  author?: string;
  status?: 'active' | 'completed' | 'abandoned';
  isDraft?: boolean;
  description?: string;
  reviewers?: FakeAdoReviewer[];
  threads?: FakeAdoThread[];
  /** How many pushes the pull request has had. Defaults to 1. */
  iterations?: number;
  policies?: FakeAdoPolicy[];
}

export interface FakeAzureDevOps {
  org?: string;
  project?: string;
  repo?: string;
  pat?: string;
  /** Whose PAT it is — `/connectiondata`'s authenticated user. */
  user: { displayName: string; uniqueName: string };
  /** Team names the user belongs to (`teams?$mine=true`). */
  myTeams?: string[];
  prs: FakeAdoPr[];
}

export const FAKE_ADO_PAT = 'fake-ado-pat';

/**
 * The per-project config that points the app at the fake.
 * `vendorProject` must be present or the host auto-detects from the git
 * remote and overwrites it; `email` is who `matchesUser` takes you for.
 */
export function fakeAdoProjectConfig(
  scenario: FakeAzureDevOps
): Record<string, unknown> {
  return {
    vendor: 'azure-devops',
    vendorProject: {
      org: scenario.org ?? 'n10-org',
      project: scenario.project ?? 'n10-project',
      repo: scenario.repo ?? 'fixture',
    },
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
