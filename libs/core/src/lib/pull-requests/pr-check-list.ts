import type { PullRequestCheck, PullRequestChecks } from '@n10/vcs-core';

/**
 * A pull request's checks and policies as a list to read: each with
 * where it stands for completion, whether it reported on an older
 * revision than the head, and in the order that matters, what blocks
 * first. Every classification is made here; a frontend draws it.
 */

/**
 * - `blocking`: required, and failed or cancelled.
 * - `waiting`: required, and not reported or still going.
 * - `unknown`: an outcome the provider named that n10 does not know.
 * - `advisory`: failed, and not required, or not known to be.
 * - `passed`: succeeded.
 * - `neutral`: skipped, neutral, or an optional one still going.
 */
export type CheckStanding =
  | 'blocking'
  | 'waiting'
  | 'unknown'
  | 'advisory'
  | 'passed'
  | 'neutral';

export interface CheckRow {
  check: PullRequestCheck;
  standing: CheckStanding;
  /** It reported on another revision than the head: an old result,
   *  which says nothing about the head, pass or fail. */
  stale: boolean;
}

export interface CheckList {
  rows: CheckRow[];
  /** Rows at each standing. */
  count: Record<CheckStanding, number>;
  /** Rows that reported on an older revision, whatever their standing:
   *  a pass among them is not the head's. */
  stale: number;
  /** What the provider counts; null where it does not say. */
  total: number | null;
  complete: boolean;
}

const ORDER: readonly CheckStanding[] = [
  'blocking',
  'waiting',
  'unknown',
  'advisory',
  'passed',
  'neutral',
];

const REQUIREMENT_ORDER: readonly PullRequestCheck['requirement'][] = [
  'required',
  'unknown',
  'optional',
];

const FAILED = new Set(['failed', 'cancelled']);
const GOING = new Set(['queued', 'running', 'waiting', 'expected']);

function standingOf(c: PullRequestCheck): CheckStanding {
  const required = c.requirement === 'required';
  if (c.outcome === 'unknown') return 'unknown';
  if (FAILED.has(c.outcome)) return required ? 'blocking' : 'advisory';
  if (GOING.has(c.outcome)) return required ? 'waiting' : 'neutral';
  return c.outcome === 'succeeded' ? 'passed' : 'neutral';
}

function compare(a: CheckRow, b: CheckRow): number {
  return (
    ORDER.indexOf(a.standing) - ORDER.indexOf(b.standing) ||
    REQUIREMENT_ORDER.indexOf(a.check.requirement) -
      REQUIREMENT_ORDER.indexOf(b.check.requirement) ||
    a.check.name.localeCompare(b.check.name) ||
    a.check.key.localeCompare(b.check.key)
  );
}

/** The list, or null where the checks could not be read at all. */
export function checkList(checks: PullRequestChecks): CheckList | null {
  if (checks.checks.state !== 'read') return null;
  const { items, total, complete } = checks.checks.value;
  const rows = items
    .map((check) => ({
      check,
      standing: standingOf(check),
      stale: check.revision != null && check.revision !== checks.head,
    }))
    .sort(compare);
  const count = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<
    CheckStanding,
    number
  >;
  for (const row of rows) count[row.standing] += 1;
  const stale = rows.filter((r) => r.stale).length;
  return { rows, count, stale, total, complete };
}
