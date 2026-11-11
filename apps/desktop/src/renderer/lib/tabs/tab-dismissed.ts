import {
  dismissKeyOf,
  isSessionKeyOf,
  sessionKey,
  terminalDismissKey,
} from './tab-identity.js';
import type { ForeignSessionEntry } from './tab-foreign.js';
import type { TerminalEntry } from './tab-terminals.js';
import type { ItemEntry } from './tabs-model.js';
import type { Strip } from './workspace.js';

/**
 * `dismissed`: the sessions whose tab was closed while they still ran.
 *
 * Every running agent has a tab unless it is dismissed. A close records
 * the sessions of the tabs it took away; a sync forgets each one a
 * listing no longer has alive, and each one that has a tab again, so
 * the record is never longer than the sessions running, and an agent
 * started again later gets its tab. The same rule keeps a closed
 * terminal or foreign agent closed while its listing catches up with
 * the kill. A terminal is dismissed with its creation time when its tab
 * knew it, so a later session under the same name is not.
 */

/** `after` with the session of every tab `before` had and it lost
 *  dismissed. */
export function dismissClosed(before: Strip, after: Strip): Strip {
  if (after.tabs === before.tabs) return after;
  const open = new Set(after.tabs.map((t) => t.id));
  const dismissed = new Set(after.dismissed);
  for (const tab of before.tabs) {
    const key = open.has(tab.id) ? null : dismissKeyOf(tab);
    if (key) dismissed.add(key);
  }
  return dismissed.size === after.dismissed.length
    ? after
    : { ...after, dismissed: [...dismissed] };
}

/** Give these sessions their tabs back on the next sync. */
export function undismiss(state: Strip, keys: readonly string[]): Strip {
  const drop = new Set(keys);
  const dismissed = state.dismissed.filter((k) => !drop.has(k));
  return dismissed.length === state.dismissed.length
    ? state
    : { ...state, dismissed };
}

interface Listings {
  repo: string;
  entries?: readonly ItemEntry[];
  terminals?: readonly TerminalEntry[];
  foreign?: readonly ForeignSessionEntry[];
}

/** A terminal key is alive while the listing has its name — the same
 *  session, when the key carries a creation time the listing can
 *  check. */
function terminalAlive(
  key: string,
  listing: readonly TerminalEntry[] | undefined
): boolean | undefined {
  return listing?.some(
    (e) =>
      key === terminalDismissKey(e.name) ||
      key === terminalDismissKey(e.name, e.created) ||
      (e.created === undefined && key.endsWith(`:${e.name}`))
  );
}

function liveSets(l: Listings) {
  const set = <T>(
    list: readonly T[] | undefined,
    key: (t: T) => string | null
  ) => list && new Set(list.flatMap((t) => key(t) ?? []));
  return {
    repo: l.repo,
    items: set(l.entries, (e) =>
      e.running && e.sessionName ? sessionKey(l.repo, e.sessionName) : null
    ),
    terminals: l.terminals,
    foreign: set(l.foreign, (f) => sessionKey(f.repo, f.sessionName)),
  };
}

/** Whether `key` is still alive by the listing that speaks for it:
 *  `undefined` when that listing has not answered, which says nothing. */
function alive(
  key: string,
  live: ReturnType<typeof liveSets>
): boolean | undefined {
  if (key.startsWith('terminal')) return terminalAlive(key, live.terminals);
  if (isSessionKeyOf(key, live.repo)) return live.items?.has(key);
  return live.foreign?.has(key);
}

/**
 * Forget every dismissed session a listing in this sync has stopped
 * reporting alive — the repository's own sidebar for its sessions, the
 * terminal listing for terminals, the foreign listing for other
 * repositories' — and every one that has a tab again (opened from the
 * sidebar or the palette). A listing that has not answered yet keeps
 * its keys.
 */
export function pruneDismissed(state: Strip, listings: Listings): Strip {
  if (state.dismissed.length === 0) return state;
  const live = liveSets(listings);
  const open = new Set(state.tabs.map(dismissKeyOf));
  const dismissed = state.dismissed.filter(
    (k) => !open.has(k) && alive(k, live) !== false
  );
  return dismissed.length === state.dismissed.length
    ? state
    : { ...state, dismissed };
}
