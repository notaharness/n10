import type { PullRequestReviewer } from '@n10/vcs-core/types';
import type {
  ReviewerStanding,
  ReviewRequirements,
  StandingRule,
} from '../../../host/contract.js';

/**
 * The Overview's reviewer list in words and groups. Who is required,
 * and why, is core's to decide (`reviewRequirements`); this only says
 * it, and never reads a requirement the provider did not state.
 */

/** One reviewer as the list shows them: from the detail read with their
 *  standing, or from the list row without one. */
export interface ReviewerRow {
  identifier: string;
  displayName: string;
  decision: PullRequestReviewer['decision'];
  standing: string | null;
  /** The rules that name them, for the standing's hover. */
  rules: StandingRule[];
}

/** The required reviewers, the optional ones under their heading, or
 *  everyone in one list where the provider does not say which is which. */
export interface ReviewerGroup {
  kind: 'required' | 'optional' | 'all';
  title: string | null;
  rows: ReviewerRow[];
}

type Standing = Pick<ReviewerStanding, 'requirement' | 'reason' | 'rules'>;

/** Why they were asked, where the provider says; a rule that names them
 *  is worth a line even where it does not say why. */
function why(s: Standing): string | null {
  if (s.reason === 'code-owner') return 'Code owner';
  if (s.reason === 'policy') return 'By policy';
  return s.rules.length > 0 ? 'Named in a rule' : null;
}

/** What a row adds to its group, in a few words; null where nothing.
 *  Grouped, the heading says required or optional. In one list, a
 *  required reviewer says so; nothing else is required. */
export function standingLabel(s: Standing, grouped: boolean): string | null {
  const reason = why(s);
  if (s.requirement !== 'required' || grouped) return reason;
  if (s.reason === 'code-owner') return 'Required code owner';
  return s.reason === 'policy' ? 'Required, by policy' : 'Required';
}

/** Required first, then the optional under a heading, where the
 *  provider states both. A requirement it does not state is never read
 *  as either, so a list with one stays whole. */
function grouped(items: readonly ReviewerStanding[]): ReviewerGroup[] {
  const row = (s: ReviewerStanding, split: boolean): ReviewerRow => ({
    identifier: s.identifier,
    displayName: s.displayName,
    decision: s.decision,
    standing: standingLabel(s, split),
    rules: s.rules,
  });
  const required = items.filter((s) => s.requirement === 'required');
  const optional = items.filter((s) => s.requirement === 'optional');
  const stated = required.length + optional.length === items.length;
  if (stated && required.length > 0 && optional.length > 0) {
    return [
      {
        kind: 'required',
        title: null,
        rows: required.map((s) => row(s, true)),
      },
      {
        kind: 'optional',
        title: 'Optional',
        rows: optional.map((s) => row(s, true)),
      },
    ];
  }
  const rest = items.filter((s) => s.requirement !== 'required');
  return [
    {
      kind: 'all',
      title: null,
      rows: [...required, ...rest].map((s) => row(s, false)),
    },
  ];
}

/** The groups, and a note on what the reads could not say. */
export function reviewerRows(
  listed: readonly PullRequestReviewer[],
  requirements: ReviewRequirements | null
): { groups: ReviewerGroup[]; notes: string[] } {
  const read = requirements?.reviewers;
  if (read?.state !== 'read') {
    const rows = listed.map((r) => ({ ...r, standing: null, rules: [] }));
    const notes =
      read?.state === 'failed'
        ? ["Couldn't load which reviewers are required."]
        : [];
    return { groups: [{ kind: 'all', title: null, rows }], notes };
  }
  const { items, complete, total } = read.value;
  const notes: string[] = [];
  if (!complete) {
    notes.push(
      total == null
        ? "Some reviewers didn't load."
        : `${items.length} of ${total} reviewers shown.`
    );
  }
  return { groups: grouped(items), notes };
}
