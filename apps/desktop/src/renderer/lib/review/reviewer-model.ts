import type { PullRequestReviewer } from '@n10/vcs-core/types';
import type {
  ReviewerStanding,
  ReviewRequirements,
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
}

/** Required or optional, and why, in a few words; null where there is
 *  nothing to say beyond their having been asked. */
export function standingLabel(
  s: Pick<ReviewerStanding, 'requirement' | 'reason'>
): string | null {
  if (s.reason === 'code-owner') {
    return s.requirement === 'required' ? 'Required code owner' : 'Code owner';
  }
  if (s.requirement === 'unknown') return null;
  const base = s.requirement === 'required' ? 'Required' : 'Optional';
  if (s.reason === 'policy') return `${base}, by policy`;
  if (s.reason === 'manual') return `${base}, added by hand`;
  return base;
}

const PROVIDER_NAME: Record<string, string> = {
  github: 'GitHub',
  'azure-devops': 'Azure DevOps',
};

/** The rows, and a note on what the reads could not say. */
export function reviewerRows(
  listed: readonly PullRequestReviewer[],
  requirements: ReviewRequirements | null,
  provider: string | null
): { rows: ReviewerRow[]; notes: string[] } {
  const read = requirements?.reviewers;
  if (read?.state !== 'read') {
    const rows = listed.map((r) => ({ ...r, standing: null }));
    const notes =
      read?.state === 'failed' ? ['Who is required could not be read.'] : [];
    return { rows, notes };
  }
  const { items, complete, total } = read.value;
  const notes: string[] = [];
  if (items.some((s) => s.requirement === 'unknown')) {
    const name = (provider && PROVIDER_NAME[provider]) ?? 'The provider';
    notes.push(`${name} doesn't mark reviewers required.`);
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
    })),
    notes,
  };
}
