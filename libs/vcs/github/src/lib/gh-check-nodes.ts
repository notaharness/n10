import type { CheckOutcome, PullRequestCheck } from '@n10/vcs-core';

/**
 * GitHub's check runs and commit statuses, in the shared vocabulary.
 * A check run's identity is its app, its check suite and its name: two
 * apps, two workflows, or one workflow run twice on the head (a push
 * and a pull request) report one name as separate checks.
 */

export interface CheckRunNode {
  __typename: 'CheckRun';
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
  isRequired: boolean | null;
  checkSuite: {
    /** One run of one workflow or app on this head. */
    databaseId: number | null;
    app: { slug: string; databaseId: number } | null;
    workflowRun: {
      runAttempt: number | null;
      /** What started it: `pull_request`, `push`, … */
      event: string | null;
      workflow: { name: string } | null;
    } | null;
  } | null;
}

export interface StatusNode {
  __typename: 'StatusContext';
  context: string;
  state: string;
  targetUrl: string | null;
  createdAt: string | null;
  creator: { login: string } | null;
  isRequired: boolean | null;
}

export type ContextNode = CheckRunNode | StatusNode;

/** A completed run's conclusion. */
const CHECK_RUN_OUTCOME: Record<string, CheckOutcome> = {
  SUCCESS: 'succeeded',
  FAILURE: 'failed',
  TIMED_OUT: 'failed',
  STARTUP_FAILURE: 'failed',
  ACTION_REQUIRED: 'failed',
  CANCELLED: 'cancelled',
  STALE: 'cancelled',
  NEUTRAL: 'neutral',
  SKIPPED: 'skipped',
};

/** A run that has not completed. `PENDING` and `REQUESTED` wait for a
 *  runner, as `QUEUED` does; `WAITING` waits on a deployment rule. */
const CHECK_RUN_STATUS: Record<string, CheckOutcome> = {
  QUEUED: 'queued',
  REQUESTED: 'queued',
  PENDING: 'queued',
  WAITING: 'waiting',
  IN_PROGRESS: 'running',
};

/** A commit status's state. A pending status is under way, as far as
 *  anyone can tell. */
const STATUS_OUTCOME: Record<string, CheckOutcome> = {
  SUCCESS: 'succeeded',
  FAILURE: 'failed',
  ERROR: 'failed',
  PENDING: 'running',
  EXPECTED: 'expected',
};

/** What a GitHub Actions event ran on: a `pull_request` run checks
 *  out the merge of the head into the base. */
const RAN_ON: Record<string, PullRequestCheck['ranOn']> = {
  pull_request: 'merge',
  push: 'revision',
};

function requirement(
  isRequired: boolean | null
): PullRequestCheck['requirement'] {
  if (isRequired == null) return 'unknown';
  return isRequired ? 'required' : 'optional';
}

function runOutcome(node: CheckRunNode): CheckOutcome {
  if (node.status !== 'COMPLETED') {
    return CHECK_RUN_STATUS[node.status] ?? 'unknown';
  }
  // An outcome GitHub adds later is neither a pass nor a failure.
  return CHECK_RUN_OUTCOME[node.conclusion ?? ''] ?? 'unknown';
}

/** The app, workflow and attempt a check run belongs to. */
function suiteOf(node: CheckRunNode) {
  const app = node.checkSuite?.app;
  const run = node.checkSuite?.workflowRun;
  return {
    appId: app?.databaseId ?? null,
    slug: app?.slug ?? null,
    ...runOf(run),
  };
}

function runOf(
  run: NonNullable<CheckRunNode['checkSuite']>['workflowRun'] | undefined
) {
  return {
    group: run?.workflow?.name ?? null,
    attempt: run?.runAttempt ?? null,
    ranOn: RAN_ON[run?.event ?? ''] ?? null,
  };
}

export function checkRun(node: CheckRunNode, head: string): PullRequestCheck {
  const { appId, slug, group, attempt, ranOn } = suiteOf(node);
  return {
    key: `check:${appId ?? '-'}:${node.checkSuite?.databaseId ?? '-'}:${
      node.name
    }`,
    name: node.name,
    group,
    source: slug,
    outcome: runOutcome(node),
    native: node.conclusion ?? node.status,
    requirement: requirement(node.isRequired),
    revision: head,
    ranOn,
    startedAt: node.startedAt,
    completedAt: node.completedAt,
    attempt,
    url: node.detailsUrl,
  };
}

export function status(node: StatusNode, head: string): PullRequestCheck {
  const outcome = STATUS_OUTCOME[node.state] ?? 'unknown';
  const settled = outcome === 'succeeded' || outcome === 'failed';
  return {
    key: `status:${node.context}`,
    name: node.context,
    group: null,
    source: node.creator?.login ?? null,
    outcome,
    native: node.state,
    requirement: requirement(node.isRequired),
    revision: head,
    ranOn: null,
    startedAt: null,
    completedAt: settled ? node.createdAt : null,
    attempt: null,
    url: node.targetUrl,
  };
}

/** A required check, with the app that must report it if one is
 *  named. */
export interface Required {
  name: string;
  appId: number | null;
}

/** A required check nothing on the head has reported. */
export function expected(req: Required): PullRequestCheck {
  return {
    key: `expected:${req.appId ?? '-'}:${req.name}`,
    name: req.name,
    group: null,
    source: null,
    outcome: 'expected',
    native: null,
    requirement: 'required',
    revision: null,
    ranOn: null,
    startedAt: null,
    completedAt: null,
    attempt: null,
    url: null,
  };
}

export function reported(
  nodes: readonly ContextNode[],
  req: Required
): boolean {
  return nodes.some((n) =>
    n.__typename === 'CheckRun'
      ? n.name === req.name &&
        (req.appId == null || n.checkSuite?.app?.databaseId === req.appId)
      : n.context === req.name
  );
}
