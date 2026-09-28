import type { NamedReviewers, ReviewRule } from '@n10/vcs-core';
import { isActive, POLICY, typeOf, type RawEvaluation } from './pr-policies.js';

/**
 * What an Azure DevOps pull request's reviewer policies ask of its
 * reviews: a minimum number of approvals, and reviewers a policy adds by
 * name. A policy Azure evaluated as not applicable, its paths matching
 * no change here, asks nothing of this pull request, but is kept among
 * the named: it may be what added a reviewer.
 */

const applies = (e: RawEvaluation) => e.status !== 'notApplicable';

const isBlocking = (e: RawEvaluation) => e.configuration?.isBlocking === true;

/** A required-reviewers policy's reviewers: required where it blocks,
 *  added as optional where it does not. */
function named(e: RawEvaluation): NamedReviewers[] {
  const settings = e.configuration?.settings;
  const ids = settings?.requiredReviewerIds ?? [];
  if (ids.length === 0) return [];
  return [
    {
      ids,
      kind: 'identity',
      approvals: settings?.minimumApproverCount ?? null,
      paths: settings?.filenamePatterns ?? [],
      applies: applies(e),
      blocking: isBlocking(e),
    },
  ];
}

export function reviewRuleOf(
  evaluations: readonly RawEvaluation[]
): ReviewRule {
  const active = evaluations.filter(isActive);
  const minimums = active.filter(
    (e) => typeOf(e) === POLICY.minimumReviewers && isBlocking(e) && applies(e)
  );
  const counts = minimums.map(
    (e) => e.configuration?.settings?.minimumApproverCount ?? 0
  );
  return {
    approvals: Math.max(0, ...counts),
    // Azure has no code owners; its path-limited reviewer policies are
    // named reviewers.
    codeOwners: false,
    named: active
      .filter((e) => typeOf(e) === POLICY.requiredReviewers)
      .flatMap(named),
    // Azure's own verdict on its minimum: met once each is approved.
    approvalsMet:
      minimums.length > 0
        ? minimums.every((e) => e.status === 'approved')
        : null,
  };
}
