import {
  asksForReview,
  type BranchRules,
  type DetailReviewer,
  type ListRead,
  type NamedReviewers,
  type PullRequestDetail,
  type PullRequestInfo,
  type ReadOutcome,
  type ReviewDecision,
  type ReviewRule,
} from '@n10/vcs-core';

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

/** Why a reviewer is on the list: a policy or rule names them, they own
 *  code the pull request changes, or someone marked them required by
 *  hand. */
export type RequirementReason = 'policy' | 'code-owner' | 'manual';

export interface ReviewerStanding {
  kind: DetailReviewer['kind'];
  identifier: string;
  displayName: string;
  decision: ReviewDecision;
  requested: boolean;
  requirement: ReviewerRequirement;
  /** Null where the provider does not say, or they were simply asked. */
  reason: RequirementReason | null;
}

export interface ReviewRequirements {
  /** Everyone the detail read names, each with their standing. */
  reviewers: ReadOutcome<ListRead<ReviewerStanding>>;
  /** What the rules ask of reviews, one requirement a line; empty where
   *  they ask nothing, null where they could not be read. */
  rule: string[] | null;
}

function requirementOf(required: boolean | null): ReviewerRequirement {
  if (required == null) return 'unknown';
  return required ? 'required' : 'optional';
}

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The rule that names this reviewer by id, where one does. */
function namedBy(
  reviewer: DetailReviewer,
  rule: ReviewRule | null
): NamedReviewers | undefined {
  const id = reviewer.id;
  if (id == null || !rule) return undefined;
  return rule.named.find((n) => n.ids.some((i) => sameId(i, id)));
}

function reasonOf(
  reviewer: DetailReviewer,
  rule: ReviewRule | null
): RequirementReason | null {
  if (reviewer.reason) return reviewer.reason;
  if (namedBy(reviewer, rule)) return 'policy';
  // Required, and named by no rule that was read: marked by hand.
  return reviewer.required === true && rule ? 'manual' : null;
}

export function standingOf(
  reviewer: DetailReviewer,
  rule: ReviewRule | null
): ReviewerStanding {
  return {
    kind: reviewer.kind,
    identifier: reviewer.identifier,
    displayName: reviewer.displayName,
    decision: reviewer.decision,
    requested: reviewer.requested,
    requirement: requirementOf(reviewer.required),
    reason: reasonOf(reviewer, rule),
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
  const names = n.ids.map(
    (id) => reviewers.find((r) => r.id != null && sameId(r.id, id))?.displayName
  );
  if (names.every((name): name is string => name != null)) return listed(names);
  const what = n.kind === 'team' ? 'required team' : 'required reviewer';
  return n.ids.length === 1 ? `a ${what}` : count(n.ids.length, what);
}

function namedLine(
  n: NamedReviewers,
  reviewers: readonly DetailReviewer[]
): string {
  const who = whoOf(n, reviewers);
  const line =
    n.approvals == null
      ? `${who} must approve`
      : `${count(n.approvals, 'approval')} from ${who}`;
  return n.paths.length > 0 ? `${line} (${n.paths.join(', ')})` : line;
}

/** The rule in words: a number of approvals, code owners, and each
 *  reviewer a rule names, where it blocks completion. */
export function ruleLines(
  rule: ReviewRule,
  reviewers: readonly DetailReviewer[]
): string[] {
  const lines: string[] = [];
  if (rule.approvals > 0) {
    lines.push(`${count(rule.approvals, 'approval')} required`);
  }
  if (rule.codeOwners) lines.push('Code owners must approve');
  for (const n of rule.named) {
    if (n.blocking) lines.push(namedLine(n, reviewers));
  }
  return lines;
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
  const named = read.state === 'read' ? read.value.items : [];
  return {
    reviewers:
      read.state === 'read'
        ? {
            state: 'read',
            value: {
              ...read.value,
              items: read.value.items.map((r) => standingOf(r, rule)),
            },
          }
        : read,
    rule: rule ? ruleLines(rule, named) : null,
  };
}

/** Their approval would count: they are required, or a rule counts
 *  anyone's. Where neither is known, the provider's asking stands. */
function counts(reviewer: DetailReviewer, rule: ReviewRule | null): boolean {
  if (reviewer.required !== false) return true;
  return rule == null || rule.approvals > 0;
}

/**
 * The provider asks the viewer for a review that would count. A draft
 * asks no one yet, and an approval asked for again already counts. The
 * detail read decides where it names the viewer, since it knows whether
 * their approval is required; the list row decides where it does not.
 */
export function asksViewer(
  row: PullRequestInfo | null,
  viewer: string | null,
  detail: ReadOutcome<PullRequestDetail>,
  rules: ReadOutcome<BranchRules> | null
): boolean {
  if (!row || row.isDraft || viewer == null) return false;
  const own = find(detailReviewers(detail), viewer);
  if (own) {
    const rule = rules?.state === 'read' ? rules.value.reviews : null;
    return stillAsked(own) && counts(own, rule);
  }
  const entry = row.reviewers?.find((r) => sameId(r.identifier, viewer));
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
