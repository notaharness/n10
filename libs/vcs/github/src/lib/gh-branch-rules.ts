import { VcsError, type ReviewRule } from '@n10/vcs-core';
import { ghRest } from './gh-graphql.js';
import type { Required } from './gh-check-nodes.js';
import {
  reviewRuleOf,
  type ClassicReviewRule,
  type PullRequestRuleParameters,
} from './gh-review-rule.js';

/**
 * The base branch's rules: classic protection's required checks, which
 * GitHub shows anyone who can read the repository, and the rule sets
 * that apply to it. Classic protection's conversation rule comes from
 * the checks query (`refUpdateRule`); a rule set can add it.
 */

interface ProtectionAnswer {
  protection?: {
    required_status_checks?: {
      enforcement_level?: string;
      checks?: { context: string; app_id: number | null }[];
    };
  };
}

interface RuleAnswer {
  type: string;
  parameters?: PullRequestRuleParameters & {
    required_status_checks?: {
      context: string;
      integration_id?: number | null;
    }[];
    required_review_thread_resolution?: boolean;
  };
}

/** What the base branch's rules require. */
export interface GitHubBranchRules {
  required: Required[];
  resolution: boolean;
  reviews: ReviewRule;
}

/** Rule sets asked for in one page; a full page may not be all. */
const RULES_PAGE = 100;

/** Classic protection's required checks. */
function classic(answer: ProtectionAnswer): Required[] {
  const checks = answer.protection?.required_status_checks;
  if (checks?.enforcement_level === 'off') return [];
  return (checks?.checks ?? []).map((c) => ({
    name: c.context,
    appId: c.app_id ?? null,
  }));
}

/** One requirement once, however many rules state it. A requirement
 *  with no app and one naming an app are two. */
function distinct(required: readonly Required[]): Required[] {
  const seen = new Set<string>();
  return required.filter((r) => {
    const key = `${r.appId ?? '-'}:${r.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function branchRules(
  owner: string,
  repo: string,
  branch: string,
  /** What classic protection enforces on this account. */
  enforced: { resolution: boolean; reviews: ClassicReviewRule | null }
): Promise<GitHubBranchRules> {
  const name = encodeURIComponent(branch);
  const [branchAnswer, rules] = await Promise.all([
    ghRest(`repos/${owner}/${repo}/branches/${name}`),
    ghRest(
      `repos/${owner}/${repo}/rules/branches/${name}?per_page=${RULES_PAGE}`
    ),
  ]);
  if ((rules as RuleAnswer[]).length >= RULES_PAGE) {
    throw new VcsError(
      'unexpected-response',
      `${branch} has more rules than n10 reads in one page`
    );
  }
  const required = classic(branchAnswer as ProtectionAnswer);
  let resolution = enforced.resolution;
  const reviews: PullRequestRuleParameters[] = [];
  for (const rule of rules as RuleAnswer[]) {
    const params = rule.parameters;
    for (const c of params?.required_status_checks ?? []) {
      required.push({ name: c.context, appId: c.integration_id ?? null });
    }
    if (params?.required_review_thread_resolution) resolution = true;
    if (rule.type === 'pull_request' && params) reviews.push(params);
  }
  return {
    required: distinct(required),
    resolution,
    reviews: reviewRuleOf(enforced.reviews, reviews),
  };
}
