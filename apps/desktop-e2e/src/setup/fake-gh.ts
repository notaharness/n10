import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * A pull request as a test declares it. Only `number`, `title` and
 * `headRefName` are needed; everything else has a sane default.
 *
 * `headRefName` should be a branch that exists in the test repo, so the
 * diff the workspace loads is a real one computed by git.
 */
export interface FakePr {
  number: number;
  title: string;
  headRefName: string;
  baseRefName?: string;
  /** The head GitHub reports. Defaults to `headRefName`'s tip in the
   *  test repository; set it to a commit the repository lacks to play
   *  a push this clone has not fetched. */
  headRefOid?: string;
  /** Defaults to the scenario's username, which makes it *your* PR and
   *  puts it under "Pull Requests" rather than a review bucket. */
  author?: string;
  isDraft?: boolean;
  /** Body shown on the Overview pane. */
  body?: string;
  rollup?: 'SUCCESS' | 'FAILURE' | 'PENDING';
  /** Submitted reviews: the list reads the verdicts, the conversation
   *  reads the summaries too. */
  reviews?: {
    id?: string;
    author: string;
    state: string;
    /** The commit a review filed through n10 was made on. */
    commit?: string;
    body?: string;
    commentCount?: number;
    submittedAt?: string;
  }[];
  /** Logins asked to review, or a person or team asked as a code
   *  owner. The list row names people only. */
  reviewRequests?: (
    | string
    | { login: string; codeOwner?: boolean }
    | {
        team: string;
        name?: string;
        codeOwner?: boolean;
        /** The team's database id, which rule sets name it by. */
        id?: number;
      }
  )[];
  threads?: FakeThread[];
  generalComments?: { author: string; body: string; createdAt?: string }[];
  /** What its revision history reports: commits and force-pushes,
   *  oldest first, and the reviews the signed-in user (or, with
   *  `mine: false`, someone else) submitted. Left out, the history is
   *  the head alone and no review. */
  history?: {
    events?: (
      | { commit: string; at?: string }
      | { forcePush: { before: string | null; after: string }; at?: string }
    )[];
    reviews?: { commit: string; at?: string; mine?: boolean }[];
  };
  /** Timeline entries, as GraphQL `PullRequestTimelineItems` nodes. */
  events?: Record<string, unknown>[];
  /** Reads that answer with GitHub's 502 until cleared with
   *  `updateFakeGh`: the description, the threads query, the selected
   *  pull request's detail, its checks, the conversation queries, and
   *  the revision history. */
  failing?: {
    body?: boolean;
    threads?: boolean;
    detail?: boolean;
    checks?: boolean;
    conversation?: boolean;
    history?: boolean;
  };
  /** Check runs and statuses on the head, for the checks read. */
  checks?: FakeCheck[];
  /** GitHub's reading of the pull request, for the checks read. */
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus?: string;
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  /** The detail read's lifecycle; open unless said. */
  state?: 'OPEN' | 'CLOSED' | 'MERGED';
  /** The head repository as `owner/repo` when it is a fork, or null
   *  for a fork that was deleted. Defaults to the scenario's own. */
  fork?: string | null;
  /** Whether the signed-in account may edit it; defaults to true. */
  canUpdate?: boolean;
}

/**
 * A check on the head. `state` is a check run's conclusion
 * (`SUCCESS`, `FAILURE`, …) or, for one still going, its status
 * (`QUEUED`, `IN_PROGRESS`); with `status: true` it is a commit status
 * and `state` is the status's (`SUCCESS`, `PENDING`, …).
 */
export interface FakeCheck {
  name: string;
  state: string;
  /** GitHub's `isRequired`, which is never null; false unless said. */
  required?: boolean;
  status?: boolean;
  workflow?: string;
  /** The Actions event; `pull_request` unless said. */
  event?: string;
  app?: string;
  appId?: number;
}

/** An inline review thread, anchored to a file and line in the diff. */
export interface FakeThread {
  id?: string;
  path: string;
  /** Left off, with no `originalLine` either, for a file-level thread. */
  line?: number;
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  /** Set with `line: null` semantics by leaving `line` off — see the
   *  outdated-thread case in the TUI suite. */
  originalLine?: number;
  isResolved?: boolean;
  /** Who resolved it, for the conversation read. */
  resolvedBy?: string;
  isOutdated?: boolean;
  side?: 'LEFT' | 'RIGHT';
  /** The diff excerpt GitHub keeps with the thread's first comment. */
  diffHunk?: string;
  /** Whether GitHub lets the viewer reply, and resolve or reopen, as
   *  on a locked conversation; both default to true. */
  canReply?: boolean;
  canResolve?: boolean;
  comments: { author: string; body: string; createdAt?: string }[];
}

export interface FakeGitHub {
  owner?: string;
  repo?: string;
  /** The signed-in user. PRs they authored are "yours". */
  username?: string;
  prs: FakePr[];
  /** Head branches of the signed-in user's merged pull requests: what
   *  the merged-branch sweep finds. */
  merged?: string[];
  /** Who `mentionableUsers` finds: a login or name containing the
   *  query, ignoring case, first eight. */
  mentionable?: { login: string; name?: string }[];
  /** Rule sets on every base branch: required checks (by name, from
   *  GitHub Actions) and whether conversations must be resolved.
   *  `failing` answers both rules reads with a 502. */
  rules?: {
    required?: string[];
    conversationResolution?: boolean;
    /** A rule set's review rule: approvals, code owners, and teams by
     *  id, each with the paths it covers. */
    approvals?: number;
    codeOwners?: boolean;
    requiredTeams?: { id: number; paths?: string[]; approvals?: number }[];
    /** Classic protection's review rule, as enforced on this account. */
    classic?: { approvals?: number; codeOwners?: boolean };
    failing?: boolean;
  };
  /**
   * Make every `gh` call take this long, standing in for the round trip
   * to GitHub. Left off for the e2e suite (which wants speed); the perf
   * suite sets it, because a provider that answers in a millisecond
   * hides what the app does with the window while it waits.
   */
  latencyMs?: number;
  /** Review operations whose write is kept but whose answer is lost,
   *  once each (fake-gh-review.mjs). */
  loseAnswers?: string[];
  /** Written by the fake: how many of each review write reached it. */
  reviewWrites?: Record<string, number>;
}

/**
 * Install a fake `gh` for one test.
 *
 * Returns the environment additions the app must be launched with: a
 * PATH prefix holding an executable named `gh` (appEnv adds the base PATH),
 * and the scenario it should answer from. The GitHub provider shells
 * out to `gh` for every remote call, so this is the whole seam — no
 * production code knows it is under test.
 */
/** Where `installFakeGh` writes the scenario the fake answers from. */
export function fakeGhScenarioPath(homeDir: string): string {
  return join(homeDir, 'fake-gh.json');
}

/**
 * Change what GitHub says, mid-test.
 *
 * Every `gh` invocation re-reads the scenario file, so editing it is
 * how a test makes the world move underneath the app — a reviewer
 * answering a thread while somebody else has it open, say. The app has
 * no way to notice on its own: `useThreads` caches, so whatever it
 * shows next is the result of it deciding to go and look.
 */
export function updateFakeGh(
  homeDir: string,
  mutate: (scenario: FakeGitHub) => void
): void {
  const path = fakeGhScenarioPath(homeDir);
  const scenario = JSON.parse(readFileSync(path, 'utf8')) as FakeGitHub;
  mutate(scenario);
  writeFileSync(path, JSON.stringify(scenario, null, 2), 'utf8');
}

export function installFakeGh(
  homeDir: string,
  scenario: FakeGitHub
): { PATH: string; N10_FAKE_GH: string; N10_FAKE_GH_LATENCY_MS?: string } {
  const binDir = join(homeDir, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  const gh = join(binDir, 'gh');
  copyFileSync(join(HERE, '..', 'fixtures', 'fake-gh.mjs'), gh);
  chmodSync(gh, 0o755);
  // The review half, which `gh` imports from beside itself.
  copyFileSync(
    join(HERE, '..', 'fixtures', 'fake-gh-review.mjs'),
    join(binDir, 'fake-gh-review.mjs')
  );

  const scenarioPath = fakeGhScenarioPath(homeDir);
  writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2), 'utf8');

  return {
    PATH: binDir,
    N10_FAKE_GH: scenarioPath,
    ...(scenario.latencyMs
      ? { N10_FAKE_GH_LATENCY_MS: String(scenario.latencyMs) }
      : {}),
  };
}

/**
 * The per-project config that points the app at the fake. `vendorProject`
 * must be present or the host auto-detects from the git remote and
 * overwrites it.
 */
export function fakeGhProjectConfig(
  scenario: FakeGitHub
): Record<string, unknown> {
  return {
    vendor: 'github',
    vendorProject: {
      owner: scenario.owner ?? 'n10',
      repo: scenario.repo ?? 'fixture',
      username: scenario.username ?? 'n10-tester',
    },
  };
}
