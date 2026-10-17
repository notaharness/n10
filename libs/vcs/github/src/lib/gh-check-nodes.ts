import type {
  CheckOutcome,
  PullRequestCheck,
  RequiredCheck,
} from '@n10/vcs-core';

/**
 * GitHub's check runs and commit statuses, in the shared vocabulary.
 * A check run's identity is its own id: two apps, two workflows, one
 * workflow run for two events, or two jobs of one name in one run are
 * separate checks. A re-run is a new check run, and the rollup keeps
 * only the newest.
 */

export interface CheckRunNode {
  __typename: 'CheckRun';
  /** This check run, and no other. */
  databaseId: number | null;
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

/** The commit GitHub hands an Actions run, by its event: a
 *  `pull_request` run's context is the test merge of the head into the
 *  base, a `push` run's the pushed commit. */
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
    key:
      node.databaseId != null
        ? `check:${node.databaseId}`
        : `check:${appId ?? '-'}:${node.checkSuite?.databaseId ?? '-'}:${
            node.name
          }`,
    requires: null,
    kind: 'check',
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
    requires: null,
    kind: 'check',
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

/** A requirement in the shared terms, with its app named where a
 *  check on the head shows which app that is. */
export function requiredCheck(
  req: Required,
  nodes: readonly ContextNode[]
): RequiredCheck {
  if (req.appId == null) return { name: req.name, app: null };
  const reporter = nodes.find(
    (n): n is CheckRunNode =>
      n.__typename === 'CheckRun' && n.checkSuite?.app?.databaseId === req.appId
  );
  return {
    name: req.name,
    app: {
      id: String(req.appId),
      slug: reporter?.checkSuite?.app?.slug ?? null,
    },
  };
}

/** A required check nothing on the head has reported. */
export function expected(
  req: Required,
  nodes: readonly ContextNode[]
): PullRequestCheck {
  return {
    key: `expected:${req.appId ?? '-'}:${req.name}`,
    requires: requiredCheck(req, nodes),
    kind: 'check',
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
