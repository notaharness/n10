import type { NamedReviewers, ReviewRule } from '@n10/vcs-core';

/**
 * What the base branch's rules ask of reviews on GitHub: classic
 * protection as `refUpdateRule` shows it to this account, and the
 * `pull_request` rules of every rule set that applies. The strictest of
 * each wins, as GitHub applies them all.
 */

/** A `pull_request` rule's review parameters, as the rules API gives
 *  them. */
export interface PullRequestRuleParameters {
  required_approving_review_count?: number;
  require_code_owner_review?: boolean;
  /** Teams that must approve changes to the paths given. */
  required_reviewers?: {
    file_patterns?: string[];
    minimum_approvals?: number;
    reviewer?: { id?: number; type?: string };
  }[];
}

/** Classic protection's review requirement, enforced on this account. */
export interface ClassicReviewRule {
  requiredApprovingReviewCount: number | null;
  requiresCodeOwnerReviews: boolean;
}

function named(
  req: NonNullable<PullRequestRuleParameters['required_reviewers']>[number]
): NamedReviewers[] {
  const id = req.reviewer?.id;
  if (id == null) return [];
  return [
    {
      // The rules read gives the rule set's id, not its name.
      name: null,
      ids: [String(id)],
      kind: 'team',
      approvals: req.minimum_approvals ?? null,
      paths: req.file_patterns ?? [],
      // GitHub does not say whether the paths match this change.
      applies: null,
      // A minimum of 0 adds the team without requiring its approval.
      blocking: (req.minimum_approvals ?? 1) > 0,
    },
  ];
}

export function reviewRuleOf(
  classic: ClassicReviewRule | null,
  rules: readonly PullRequestRuleParameters[]
): ReviewRule {
  const counts = rules.map((r) => r.required_approving_review_count ?? 0);
  return {
    approvals: Math.max(
      0,
      classic?.requiredApprovingReviewCount ?? 0,
      ...counts
    ),
    codeOwners:
      (classic?.requiresCodeOwnerReviews ?? false) ||
      rules.some((r) => r.require_code_owner_review === true),
    named: rules.flatMap((r) => (r.required_reviewers ?? []).flatMap(named)),
    // GitHub's reviewDecision says whether the review requirement is
    // met as a whole, not this count.
    approvalsMet: null,
  };
}
