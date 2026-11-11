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
  idle: '',
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

/** A roster's header line: its states worst first, or nothing while
 *  every tab is idle. */
export function rosterSummary(statuses: readonly TabStatus[]): string {
  return statuses.every((s) => s === 'idle')
    ? ''
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
 *  short of a state (an agent that ended, a tab not yet looked at), else
 *  nothing for an idle tab. */
export function rowStatus(
  status: TabStatus,
  facts: { exited: boolean; unseen: boolean }
): string {
  if (status !== 'idle') return ROW_WORDS[status];
  if (facts.exited) return 'Ended';
  if (facts.unseen) return 'Not yet opened';
  return ROW_WORDS.idle;
}

/** What a chip shows of its tabs' activity: whether it blinks for new
 *  output and spins for work. */
export interface ChipSignal {
  flashing: boolean;
  working: boolean;
}

/** A tab's activity, as its session's snapshot has it. */
type Activity = { active: boolean; flashing: boolean } | undefined;

/**
 * The activity a chip carries. An orchestrator's chip carries its
 * home's own alone: its players are the orchestrator's to watch, and
 * blink and spin on their own rows. Any other group's chip carries
 * every member's. `activity` is the group's tabs', in its order; `home`
 * says whether the first is the orchestrator's (`TabGroup.head`), and
 * `parent` whether the group is an orchestrator's at all, home here or
 * not.
 */
export function chipSignal(
  activity: readonly Activity[],
  { parent, home }: { parent: boolean; home: boolean }
): ChipSignal {
  const own = parent ? (home ? activity.slice(0, 1) : []) : activity;
  return {
    flashing: own.some((a) => a?.flashing),
    working: own.some((a) => a?.active),
  };
}
