import {
  dismissKeyOf,
  isSessionKeyOf,
  machineOfSession,
  sessionKey,
  sessionOfKey,
  terminalDismissKey,
  terminalOfKey,
} from './tab-identity.js';
import { LOCAL_ONLY } from './tab-terminals.js';
import type { SyncListings } from './tabs-model.js';
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

/** A terminal key is alive while the listing has its name — the same
 *  session, when the key carries a creation time the listing can
 *  check. A listing not complete for the session's machine says
 *  nothing. */
function terminalAlive(key: string, l: SyncListings): boolean | undefined {
  const listing = l.terminals;
  if (!listing) return undefined;
  const machine = machineOfSession(terminalOfKey(key));
  if (!(l.scanned ?? LOCAL_ONLY).includes(machine)) return undefined;
  return listing.some(
    (e) =>
      key === terminalDismissKey(e.name) ||
      key === terminalDismissKey(e.name, e.created) ||
      (e.created === undefined && key.endsWith(`:${e.name}`))
  );
}

/**
 * An agent's key is alive while tmux runs its session (`alive`) or a
 * listing reports it running — the sidebar a moment before tmux's
 * answer catches up, or the foreign listing. Only tmux's answer can say
 * it ended: the sidebar's `running` means this host attached it, which
 * a scan may not have done yet. A session on another machine is not in
 * tmux's answer here, so nothing says it ended.
 */
function agentAlive(
  key: string,
  l: SyncListings & { repo: string }
): boolean | undefined {
  const session = sessionOfKey(key);
  if (!l.alive || machineOfSession(session) !== 'local') return undefined;
  if (l.alive.includes(session)) return true;
  const own = isSessionKeyOf(key, l.repo);
  if (own && l.entries?.some((e) => e.running && e.sessionName === session))
    return true;
  return (
    l.foreign?.some((f) => sessionKey(f.repo, f.sessionName) === key) ?? false
  );
}

/** Whether `key` is still alive by the listings that speak for it:
 *  `undefined` when none has answered, which says nothing. */
function alive(
  key: string,
  l: SyncListings & { repo: string }
): boolean | undefined {
  return key.startsWith('terminal')
    ? terminalAlive(key, l)
    : agentAlive(key, l);
}

/**
 * Forget every dismissed session this sync's listings say has ended —
 * an agent tmux no longer runs and no listing reports running, a
 * terminal its machine's complete listing no longer has — and every one
 * that has a tab again (opened from the sidebar or the palette). A
 * listing that has not answered, or is not complete for the session's
 * machine, keeps its keys.
 */
export function pruneDismissed(
  state: Strip,
  listings: SyncListings & { repo: string }
): Strip {
  if (state.dismissed.length === 0) return state;
  const open = new Set(state.tabs.map(dismissKeyOf));
  const dismissed = state.dismissed.filter(
    (k) => !open.has(k) && alive(k, listings) !== false
  );
  return dismissed.length === state.dismissed.length
    ? state
    : { ...state, dismissed };
}
