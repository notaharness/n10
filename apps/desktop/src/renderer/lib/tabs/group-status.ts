import { statusCounts, type TabStatus } from './tab-groups.js';

/** A status as a count reads (`2 new output`). */
const COUNT_WORDS: Record<TabStatus, string> = {
  blocked: 'blocked',
  error: 'error',
  'done-unseen': 'done',
  'new-output': 'new output',
  working: 'working',
  idle: 'idle',
};

/** A status as a roster row reads it. */
const ROW_WORDS: Record<TabStatus, string> = {
  blocked: 'Blocked',
  error: 'Error',
  'done-unseen': 'Done · Unseen',
  'new-output': 'New output',
  working: 'Working',
  idle: 'Idle',
};

export const tabCount = (n: number) => `${n} tab${n === 1 ? '' : 's'}`;

/** `1 blocked, 2 new output, 5 working, 1 idle`: every state present,
 *  worst first, joined by `separator`. */
export function statusSummary(
  statuses: readonly TabStatus[],
  separator = ', '
): string {
  return statusCounts(statuses)
    .map(({ status, count }) => `${count} ${COUNT_WORDS[status]}`)
    .join(separator);
}

/** A roster's header line: its states, or that none needs attention. */
export function rosterSummary(statuses: readonly TabStatus[]): string {
  return statuses.every((s) => s === 'idle')
    ? 'No attention needed'
    : statusSummary(statuses, ' · ');
}

/** What a group's count says to a screen reader: `9 tabs. 1 blocked,
 *  …` */
export function groupSummary(statuses: readonly TabStatus[]): string {
  const summary = statusSummary(statuses);
  return summary
    ? `${tabCount(statuses.length)}. ${summary}.`
    : tabCount(statuses.length);
}

/** A roster row's status: its state, else what the tab's activity says
 *  short of a state (an agent that ended, a tab not yet looked at). */
export function rowStatus(
  status: TabStatus,
  facts: { exited: boolean; unseen: boolean }
): string {
  if (status !== 'idle') return ROW_WORDS[status];
  if (facts.exited) return 'Ended';
  if (facts.unseen) return 'Not yet opened';
  return ROW_WORDS.idle;
}
