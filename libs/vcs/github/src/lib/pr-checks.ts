import {
  isOid,
  readFailure,
  VcsError,
  type BranchRules,
  type ListRead,
  type MergeState,
  type PullRequestCheck,
  type PullRequestChecks,
  type PullRequestLifecycle,
  type ReadOutcome,
} from '@n10/vcs-core';
import { branchRules, type GitHubBranchRules } from './gh-branch-rules.js';
import type { ClassicReviewRule } from './gh-review-rule.js';
import {
  checkRun,
  expected,
  reported,
  requiredCheck,
  status,
  type ContextNode,
} from './gh-check-nodes.js';
import { restOf, type Page } from './gh-pages.js';
import { ghGraphQL } from './gh-graphql.js';

/**
 * What stands between a GitHub pull request and merging: every check
 * run and status on its head, with GitHub's own `isRequired`; the base
 * branch's required checks from its classic protection and its rule
 * sets, so a required check nothing has reported is listed as expected;
 * and GitHub's reading of mergeability and reviews. Read for one pull
 * request at a time, on demand.
 */

const CONTEXTS = `
          contexts(first: 100, after: $contextsCursor) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes {
              __typename
              ... on CheckRun {
                databaseId name status conclusion startedAt completedAt detailsUrl
                isRequired(pullRequestNumber: $number)
                checkSuite {
                  databaseId
                  app { slug databaseId }
                  workflowRun { runAttempt event workflow { name } }
                }
              }
              ... on StatusContext {
                context state targetUrl createdAt
                creator { login }
                isRequired(pullRequestNumber: $number)
              }
            }
          }`;

const ROLLUP = `
        commits(last: 1) {
          nodes { commit { oid statusCheckRollup {${CONTEXTS}
          } } }
        }`;

/** The merge state and classic protection's conversation rule — which
 *  `refUpdateRule` shows the rules enforced on this account — with the
 *  first page of checks. */
const CHECKS_QUERY = `
  query PullRequestChecks($owner: String!, $repo: String!, $number: Int!, $contextsCursor: String) {
    repository(owner: $owner, name: $repo) {
      databaseId
      pullRequest(number: $number) {
        number state isDraft baseRefName
        mergeable mergeStateStatus reviewDecision
        baseRef { refUpdateRule {
          requiresConversationResolution
          requiredApprovingReviewCount requiresCodeOwnerReviews
        } }${ROLLUP}
      }
    }
  }
`;

/** A later page of checks, with the head it belongs to. */
const CONTEXTS_PAGE_QUERY = `
  query PullRequestCheckContexts($owner: String!, $repo: String!, $number: Int!, $contextsCursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {${ROLLUP}
      }
    }
  }
`;

interface ChecksNode {
  number: number;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  mergeable: string;
  mergeStateStatus: string | null;
  reviewDecision: string | null;
  baseRef: {
    refUpdateRule:
      | ({ requiresConversationResolution: boolean } & ClassicReviewRule)
      | null;
  } | null;
  commits: {
    nodes: {
      commit: {
        oid: string;
        statusCheckRollup: { contexts: Page<ContextNode> } | null;
      };
    }[];
  };
}

interface ChecksResponse {
  data: {
    repository: { databaseId?: number; pullRequest: ChecksNode | null } | null;
  };
}

interface PageResponse {
  data: {
    repository: {
      pullRequest: { commits: ChecksNode['commits'] } | null;
    } | null;
  };
}

const LIFECYCLE: Record<string, PullRequestLifecycle['state']> = {
  OPEN: 'open',
  CLOSED: 'closed',
  MERGED: 'merged',
};

const REVIEWS: Record<string, MergeState['reviews']> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes-requested',
  REVIEW_REQUIRED: 'required',
};

const CONFLICTS: Record<string, MergeState['conflicts']> = {
  MERGEABLE: 'none',
  CONFLICTING: 'conflicting',
};

/**
 * What `mergeStateStatus` says about being behind and being blocked:
 * GitHub's own verdict. `UNSTABLE` merges with a failing check that is
 * not required; `DIRTY` has conflicts. A state that hides the other
 * question answers it with null, and `UNKNOWN` answers neither. GitHub
 * has deprecated `DRAFT` for `isDraft` and reports a draft by its other
 * state; an old `DRAFT` answers neither question.
 */
const MERGE_STATE: Record<string, [boolean | null, boolean | null]> = {
  CLEAN: [false, false],
  HAS_HOOKS: [false, false],
  UNSTABLE: [false, false],
  BEHIND: [true, true],
  BLOCKED: [null, true],
  DIRTY: [null, true],
  DRAFT: [null, null],
};

function mergeState(node: ChecksNode): MergeState {
  const state = LIFECYCLE[node.state];
  if (!state) {
    throw new VcsError(
      'unexpected-response',
      `GitHub reported pull request #${node.number} as ${node.state}, which n10 does not know`
    );
  }
  const [behind, blocked] = MERGE_STATE[node.mergeStateStatus ?? ''] ?? [
    null,
    null,
  ];
  return {
    lifecycle: { state, isDraft: node.isDraft, native: node.state },
    conflicts: CONFLICTS[node.mergeable] ?? 'unknown',
    behind,
    // What GitHub enforces beside the draft: the draft is the
    // lifecycle's to say.
    blocked,
    // GitHub leaves the decision out where a rule set requires review
    // as well as where nothing does, so its absence says neither.
    reviews: REVIEWS[node.reviewDecision ?? ''] ?? 'unknown',
    // GitHub gives no verdict on threads, only the rule.
    conversations: null,
    native: node.mergeStateStatus,
  };
}

/** What classic protection enforces on this account: no rule enforced
 *  on it is no classic rule for it. */
function enforcedOf(node: ChecksNode) {
  const rule = node.baseRef?.refUpdateRule ?? null;
  return {
    resolution: rule?.requiresConversationResolution ?? false,
    reviews: rule,
  };
}

/** The pull request's own repository, with the id GitHub answered. */
function refOf(
  res: ChecksResponse,
  owner: string,
  repo: string,
  number: number
): PullRequestChecks['ref'] {
  const id = res.data.repository?.databaseId;
  return {
    provider: 'github',
    host: 'github.com',
    repository: `${owner}/${repo}`,
    ...(id != null ? { id: String(id) } : {}),
    number,
  };
}

const NO_CHECKS: Page<ContextNode> = {
  totalCount: 0,
  pageInfo: { hasNextPage: false, endCursor: null },
  nodes: [],
};

export async function fetchPullRequestChecksGitHub(
  owner: string,
  repo: string,
  number: number
): Promise<PullRequestChecks> {
  const vars = { owner, repo, number };
  const res = (await ghGraphQL(CHECKS_QUERY, vars)) as ChecksResponse;
  const node = res.data.repository?.pullRequest;
  const commit = node?.commits.nodes[0]?.commit;
  if (!node || !commit || !isOid(commit.oid)) {
    throw new VcsError(
      'not-found',
      `GitHub could not find ${owner}/${repo}#${number}, or its head commit`
    );
  }
  const head = commit.oid;
  const first = commit.statusCheckRollup?.contexts ?? NO_CHECKS;
  const [contexts, rules] = await Promise.all([
    restOf(first, async (cursor) => {
      const page = (await ghGraphQL(CONTEXTS_PAGE_QUERY, {
        ...vars,
        contextsCursor: cursor,
      })) as PageResponse;
      const rollup =
        page.data.repository?.pullRequest?.commits.nodes[0]?.commit;
      // A push between pages: the rest would be another revision's.
      if (rollup?.oid !== head || !rollup.statusCheckRollup) {
        throw new VcsError(
          'unexpected-response',
          `${owner}/${repo}#${number} moved while its checks were read`
        );
      }
      return rollup.statusCheckRollup.contexts;
    }).then((value) => ({ state: 'read' as const, value }), readFailure),
    branchRules(owner, repo, node.baseRefName, enforcedOf(node)).then(
      (value) => ({ state: 'read' as const, value }),
      readFailure
    ),
  ]);
  return {
    ref: refOf(res, owner, repo, number),
    head,
    checks: checksOf(contexts, rules, head, first.totalCount),
    rules: rulesOf(rules, contexts),
    merge: mergeState(node),
  };
}

type Contexts = ReadOutcome<{ nodes: ContextNode[]; complete: boolean }>;
type Rules = ReadOutcome<GitHubBranchRules>;

function checksOf(
  contexts: Contexts,
  rules: Rules,
  head: string,
  /** GitHub's own count of the head's checks. */
  reportedTotal: number
): ReadOutcome<ListRead<PullRequestCheck>> {
  if (contexts.state !== 'read') return contexts;
  const { nodes, complete } = contexts.value;
  const items = nodes.map((n) =>
    n.__typename === 'CheckRun' ? checkRun(n, head) : status(n, head)
  );
  // Only a complete read can say a required check is missing.
  if (complete && rules.state === 'read') {
    for (const req of rules.value.required) {
      if (!reported(nodes, req)) items.push(expected(req, nodes));
    }
  }
  return {
    state: 'read',
    value: complete
      ? { items, total: items.length, complete: true }
      : { items, total: reportedTotal, complete: false },
  };
}

/** The rules, with each required check's app named where a check on
 *  the head shows which app that is. */
function rulesOf(rules: Rules, contexts: Contexts): ReadOutcome<BranchRules> {
  if (rules.state !== 'read') return rules;
  const nodes = contexts.state === 'read' ? contexts.value.nodes : [];
  return {
    state: 'read',
    value: {
      requiredChecks: rules.value.required.map((r) => requiredCheck(r, nodes)),
      conversationResolution: rules.value.resolution,
      reviews: rules.value.reviews,
    },
  };
}
