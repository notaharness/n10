import type { PullRequestReviewer } from '@n10/vcs-core/types';
import { providerName } from '../provider-name.js';
import type {
  ReviewerStanding,
  ReviewRequirements,
  StandingRule,
} from '../../../host/contract.js';

/**
 * The Overview's reviewer list in words. Who is required, and why, is
 * core's to decide (`reviewRequirements`); this only says it, and says
 * where the provider does not.
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

/** Required or optional, and why, in a few words; null where there is
 *  nothing to say beyond their having been asked. A rule that names
 *  them is worth a line even where their requirement is unknown. */
export function standingLabel(
  s: Pick<ReviewerStanding, 'requirement' | 'reason' | 'rules'>
): string | null {
  if (s.reason === 'code-owner') {
    return s.requirement === 'required' ? 'Required code owner' : 'Code owner';
  }
  if (s.requirement === 'unknown') {
    return s.rules.length > 0 ? 'Named by a rule' : null;
  }
  const base = s.requirement === 'required' ? 'Required' : 'Optional';
  if (s.reason === 'policy') return `${base}, by policy`;
  return base;
}

/** The rows, and a note on what the reads could not say. */
export function reviewerRows(
  listed: readonly PullRequestReviewer[],
  requirements: ReviewRequirements | null,
  provider: string | null
): { rows: ReviewerRow[]; notes: string[] } {
  const read = requirements?.reviewers;
  if (read?.state !== 'read') {
    const rows = listed.map((r) => ({ ...r, standing: null, rules: [] }));
    const notes =
      read?.state === 'failed'
        ? ["The reviewers' details could not be read."]
        : [];
    return { rows, notes };
  }
  const { items, complete, total } = read.value;
  const notes: string[] = [];
  if (items.some((s) => s.requirement === 'unknown')) {
    const name = providerName(provider);
    notes.push(
      `${name.charAt(0).toUpperCase()}${name.slice(
        1
      )} doesn't mark reviewers required.`
    );
  }
  if (!complete) {
    notes.push(
      total == null
        ? 'Not every reviewer could be read.'
        : `${items.length} of ${total} reviewers shown.`
    );
  }
  return {
    rows: items.map((s) => ({
      identifier: s.identifier,
      displayName: s.displayName,
      decision: s.decision,
      standing: standingLabel(s),
      rules: s.rules,
    })),
    notes,
  };
}
