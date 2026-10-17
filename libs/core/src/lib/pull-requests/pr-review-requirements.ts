import type {
  BranchRules,
  DetailReviewer,
  ListRead,
  NamedReviewers,
  PullRequestDetail,
  PullRequestInfo,
  ReadOutcome,
  ReviewDecision,
  ReviewRule,
} from '@n10/vcs-core';
// The browser-safe subpath: `@n10/core/readiness` exports this module.
import { asksForReview, viewerEntry } from '@n10/vcs-core/types';

/**
 * Who must review a pull request, and why, in the providers' own terms.
 *
 * Azure DevOps marks each reviewer required or optional, and its reviewer
 * policies say which of them a policy added. GitHub marks no one: its
 * rules ask for a number of approvals and for code owners, and a request
 * says only whether it went to someone as a code owner. So a GitHub
 * reviewer's requirement is unknown, never guessed from their being
 * asked.
 */

export type ReviewerRequirement = 'required' | 'optional' | 'unknown';

/** Why a reviewer is on the list, where the provider states it: a
 *  policy that applies names them, or they own code the pull request
 *  changes. */
export type RequirementReason = 'policy' | 'code-owner';

/** A rule that names a reviewer, or asks for their review as a code
 *  owner, as the provider states it: what it is called, what it asks,
 *  where, and whether it applies here. */
export interface StandingRule {
  /** The provider's name for it, or what it is where it names none. */
  name: string;
  /** What it asks, in words: "1 approval required". */
  asks: string;
  /** The paths it is limited to; empty for any change. */
  paths: string[];
  /** False where the provider evaluated it as not applying to these
   *  changes; null where it does not say. */
  applies: boolean | null;
}

export interface ReviewerStanding {
  kind: DetailReviewer['kind'];
  identifier: string;
  displayName: string;
  decision: ReviewDecision;
  requested: boolean;
  requirement: ReviewerRequirement;
  /** Null where the provider does not say, or they were simply asked. */
  reason: RequirementReason | null;
  /** Every rule read that names them, whether or not it is why they
   *  are listed: each says so itself. Empty where none does. */
  rules: StandingRule[];
}

export interface ReviewRequirements {
  /** Everyone the detail read names, each with their standing. */
  reviewers: ReadOutcome<ListRead<ReviewerStanding>>;
}

function requirementOf(required: boolean | null): ReviewerRequirement {
  if (required == null) return 'unknown';
  return required ? 'required' : 'optional';
}

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The id the rules name this reviewer by. */
const ruleIdOf = (r: DetailReviewer) => r.ruleId ?? r.id;

/** Every rule that names this reviewer by id. */
function naming(
  reviewer: DetailReviewer,
  rule: ReviewRule | null
): NamedReviewers[] {
  const id = ruleIdOf(reviewer);
  if (id == null || !rule) return [];
  return rule.named.filter((n) => n.ids.some((i) => sameId(i, id)));
}

/** The policy that lists this reviewer as they are, by the provider's
 *  own evaluation: it applies to these changes, names them by id, and
 *  adds them as they are listed, a blocking one as required and
 *  another as optional. */
function namedBy(
  reviewer: DetailReviewer,
  rule: ReviewRule | null
): NamedReviewers | undefined {
  return naming(reviewer, rule).find(
    (n) =>
      n.applies === true &&
      (reviewer.required == null || n.blocking === reviewer.required)
  );
}

/**
 * Only a reason the provider states. A policy that no longer applies
 * may or may not be what added someone, and a required reviewer no
 * policy names may have been added by hand or by a policy since
 * disabled: Azure's reviewer history says which, and until that is
 * read no reason is given.
 */
function reasonOf(
  reviewer: DetailReviewer,
  rule: ReviewRule | null
): RequirementReason | null {
  if (reviewer.reason) return reviewer.reason;
  return namedBy(reviewer, rule) ? 'policy' : null;
}

export function standingOf(
  reviewer: DetailReviewer,
  rule: ReviewRule | null,
  everyone: readonly DetailReviewer[] = []
): ReviewerStanding {
  return {
    kind: reviewer.kind,
    identifier: reviewer.identifier,
    displayName: reviewer.displayName,
    decision: reviewer.decision,
    requested: reviewer.requested,
    requirement: requirementOf(reviewer.required),
    reason: reasonOf(reviewer, rule),
    rules: rulesOf(reviewer, rule, everyone),
  };
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Who a named rule asks for: by name where every one is listed, else
 *  by number. */
function whoOf(n: NamedReviewers, reviewers: readonly DetailReviewer[]) {
  const names = n.ids.map((id) => {
    const named = reviewers.find((r) => {
      const own = ruleIdOf(r);
      return own != null && sameId(own, id);
    });
    return named?.displayName;
  });
  if (names.every((name): name is string => name != null)) return listed(names);
  const what = n.kind === 'team' ? 'required team' : 'required reviewer';
  return count(n.ids.length, what);
}

/** What a named rule asks of those it names. */
function asksOf(
  n: NamedReviewers,
  reviewers: readonly DetailReviewer[]
): string {
  if (!n.blocking) return 'Adds them; their approval is optional';
  if (n.approvals == null) {
    return n.ids.length === 1 ? 'Must approve' : 'Each must approve';
  }
  const approvals = count(n.approvals, 'approval');
  return n.ids.length === 1
    ? `${approvals} required`
    : `${approvals} from ${whoOf(n, reviewers)}`;
}

/** The rules that name this reviewer, and the code-owner rule for a
 *  code owner, in the provider's terms. */
function rulesOf(
  reviewer: DetailReviewer,
  rule: ReviewRule | null,
  everyone: readonly DetailReviewer[]
): StandingRule[] {
  const named = naming(reviewer, rule).map((n) => ({
    // GitHub's rules read gives a ruleset's id, not its name.
    name: n.name ?? 'Ruleset',
    asks: asksOf(n, everyone),
    paths: n.paths,
    applies: n.applies,
  }));
  if (reviewer.reason !== 'code-owner' || !rule?.codeOwners) return named;
  return [
    ...named,
    {
      name: 'Code owner review',
      asks: 'A code owner of the changed files must approve',
      paths: [],
      applies: null,
    },
  ];
}

function detailReviewers(
  detail: ReadOutcome<PullRequestDetail>
): ReadOutcome<ListRead<DetailReviewer>> {
  return detail.state === 'read' ? detail.value.reviewers : detail;
}

export function reviewRequirements(
  detail: ReadOutcome<PullRequestDetail>,
  rules: ReadOutcome<BranchRules> | null
): ReviewRequirements {
  const rule = rules?.state === 'read' ? rules.value.reviews : null;
  const read = detailReviewers(detail);
  if (read.state !== 'read') return { reviewers: read };
  const everyone = read.value.items;
  return {
    reviewers: {
      state: 'read',
      value: {
        ...read.value,
        items: everyone.map((r) => standingOf(r, rule, everyone)),
      },
    },
  };
}

/**
 * Their approval would count: they are required, a rule counts anyone's
 * and is not yet met, or a required group still waits and they may be
 * in it (the detail read does not say who is). Where the rule is not
 * known, the provider's asking stands.
 */
function counts(
  reviewer: DetailReviewer,
  rule: ReviewRule | null,
  everyone: readonly DetailReviewer[]
): boolean {
  if (reviewer.required !== false || rule == null) return true;
  if (rule.approvals > 0 && rule.approvalsMet !== true) return true;
  return everyone.some(
    (r) => r.kind === 'team' && r.required === true && r.decision !== 'approved'
  );
}

/**
 * The provider asks the viewer for a review that would count. A draft
 * asks no one yet, and an approval asked for again already counts. The
 * detail read decides where it names the viewer, since it knows whether
 * their approval is required; the list row decides where it does not,
 * by the viewer's own entry or a pending group of theirs (`viewerEntry`).
 */
export function asksViewer(
  row: PullRequestInfo | null,
  viewer: string | null,
  detail: ReadOutcome<PullRequestDetail>,
  rules: ReadOutcome<BranchRules> | null
): boolean {
  if (!row || row.isDraft || viewer == null) return false;
  const read = detailReviewers(detail);
  const own = find(read, viewer);
  if (own && read.state === 'read') {
    const rule = rules?.state === 'read' ? rules.value.reviews : null;
    return stillAsked(own) && counts(own, rule, read.value.items);
  }
  const entry =
    row.reviewers &&
    viewerEntry(row.reviewers, (r) => sameId(r.identifier, viewer));
  return entry != null && stillAsked(entry);
}

function find(
  read: ReadOutcome<ListRead<DetailReviewer>>,
  viewer: string
): DetailReviewer | undefined {
  if (read.state !== 'read') return undefined;
  return read.value.items.find((r) => sameId(r.identifier, viewer));
}

const stillAsked = (r: Parameters<typeof asksForReview>[0]) =>
  r.decision !== 'approved' && asksForReview(r);
