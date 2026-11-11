import type { TerminalKind } from '../../../host/contract.js';
import { closeTab } from './tab-close.js';
import {
  terminalDismissKey,
  terminalTabId,
  type Tab,
  type TerminalTab,
} from './tab-identity.js';
import type { Strip } from './workspace.js';

/**
 * The terminal-tab passes of the reducer: opening one, and reconciling
 * the strip with the host's terminal listing.
 *
 * Kept beside `tab-sync.ts` rather than inside the reducer for the
 * same reason: these are the transitions specific to one tab kind, and
 * the reducer is the switch that dispatches to them.
 */

/** One terminal as the host lists it, as the tab model needs it. */
export interface TerminalEntry {
  name: string;
  kind: TerminalKind;
  cwd: string;
  displayPath: string;
  repo: string | null;
  /** The branch whose checkout it is in: that branch's tab lists it. */
  branch?: string;
  /** Its tmux session's creation time, once discovery has listed it. */
  created?: number;
  /** `'local'` or a beam peerId. */
  machine?: string;
}

/** Whether `dismissed` holds this listed terminal's session: by name
 *  alone, by name and creation time, or — when the listing does not know
 *  the time yet — any session of that name. */
export function isTerminalDismissed(
  dismissed: ReadonlySet<string>,
  entry: TerminalEntry
): boolean {
  if (dismissed.has(terminalDismissKey(entry.name))) return true;
  if (entry.created !== undefined)
    return dismissed.has(terminalDismissKey(entry.name, entry.created));
  const suffix = `:${entry.name}`;
  return [...dismissed].some(
    (k) => k.startsWith('terminal@') && k.endsWith(suffix)
  );
}

/** The machines whose listing is complete when a sync names none: this
 *  one, which a defined listing always speaks for. */
export const LOCAL_ONLY: readonly string[] = ['local'];

/** How many restored terminal tabs a listing gives up: their session is
 *  gone (`bindRestored`'s rule). For the one notice the user gets. */
export function restoredGone(
  tabs: readonly Tab[],
  entries: readonly TerminalEntry[],
  scanned: readonly string[] = LOCAL_ONLY
): number {
  const byName = new Map(entries.map((e) => [e.name, e]));
  return tabs.filter(
    (t) =>
      t.kind === 'terminal' &&
      t.restored &&
      restoredFate(t, byName.get(t.name), scanned) === 'gone'
  ).length;
}

/** A restored tab's session, by the listing: the one it was saved with
 *  (`bind`), gone, or not known yet (`wait`) — named without a creation
 *  time, or left out by a listing that is not complete for its machine
 *  yet (`scanned` lacks it: not scanned, or offline). */
function restoredFate(
  tab: TerminalTab,
  entry: TerminalEntry | undefined,
  scanned: readonly string[]
): 'bind' | 'wait' | 'gone' {
  if (!entry) return scanned.includes(tab.machine ?? 'local') ? 'gone' : 'wait';
  if (entry.created === undefined) return 'wait';
  return entry.created === tab.created ? 'bind' : 'gone';
}

function terminalTab(entry: TerminalEntry, listed: boolean): TerminalTab {
  return {
    id: terminalTabId(entry.name),
    kind: 'terminal',
    name: entry.name,
    terminalKind: entry.kind,
    cwd: entry.cwd,
    displayPath: entry.displayPath,
    repo: entry.repo,
    preview: false,
    listed,
    ...(entry.created !== undefined ? { created: entry.created } : {}),
    ...(entry.machine !== undefined ? { machine: entry.machine } : {}),
  };
}

/**
 * Activate the tab for a terminal, opening one if none is on it yet.
 *
 * A restored tab under the same name is not this terminal: the host
 * just started it, so whatever the saved tab was bound to is gone, and
 * the new terminal takes its place on the strip.
 */
export function openTerminal(state: Strip, entry: TerminalEntry): Strip {
  const id = terminalTabId(entry.name);
  const existing = state.tabs.find((t) => t.id === id);
  // Unlisted until a listing names it: the host answered the launch
  // before its listing caught up, and a sync landing in between must
  // not read the older listing as this terminal having ended.
  const fresh = terminalTab(entry, false);
  if (existing?.kind === 'terminal' && existing.restored) {
    const tabs = state.tabs.map((t) => (t.id === id ? fresh : t));
    return { ...state, tabs, activeId: id };
  }
  if (existing) return { ...state, activeId: id };
  return { ...state, tabs: [...state.tabs, fresh], activeId: id };
}

/**
 * Reconcile the strip with the host's terminal listing.
 *
 * Every terminal outside a branch's checkout has a tab unless it was
 * dismissed (`tab-dismissed.ts`) — the restore path after a restart,
 * and one found by the running scan. Opening never moves focus: a
 * restored terminal from another repository would otherwise switch the
 * workspace at startup. A tab that is already there has its stamp
 * refreshed, and an unchanged listing returns the same state object so
 * a quiet poll does not re-render the strip.
 *
 * A tab restored from the saved workspace is bound first
 * ({@link bindRestored}). The listing is also the only word on which
 * terminals still exist: a tab whose terminal it no longer names has
 * ended — the shell exited, the agent quit, tmux killed the session
 * from outside — and is closed by {@link dropEnded}, with focus moving
 * as a close in `repo` would.
 */
export function syncTerminals(
  state: Strip,
  repo: string,
  entries: TerminalEntry[],
  scanned: readonly string[] = LOCAL_ONLY
): Strip {
  const bound = bindRestored(state, repo, entries, scanned);
  return dropEnded(openListed(bound, entries), repo, entries);
}

/**
 * A restored tab binds only to the session it was saved with: the same
 * name *and* the same creation time, since names are reused. Bound, it
 * is a listed tab like any other. Otherwise the listing closes it — its
 * session is gone — and a later session under its name gets a tab of
 * its own from {@link openListed}. Two cases say neither, and the tab
 * waits: a listing that names it without a creation time yet, and one
 * that leaves it out before its machine's listing is complete — this
 * machine's before discovery's first scan, another's before it answers.
 */
function bindRestored(
  state: Strip,
  repo: string,
  entries: TerminalEntry[],
  scanned: readonly string[]
): Strip {
  const byName = new Map(entries.map((e) => [e.name, e]));
  let next = state;
  for (const tab of state.tabs) {
    if (tab.kind !== 'terminal' || !tab.restored) continue;
    const entry = byName.get(tab.name);
    const fate = restoredFate(tab, entry, scanned);
    if (fate === 'gone') next = closeTab(next, tab.id, repo);
    if (fate !== 'bind' || !entry) continue;
    const bound = restamp(withoutRestored(tab), entry);
    next = { ...next, tabs: next.tabs.map((t) => (t === tab ? bound : t)) };
  }
  return next;
}

function withoutRestored(tab: TerminalTab): TerminalTab {
  const bound = { ...tab };
  delete bound.restored;
  return bound;
}

/** The opening half: a tab per listed terminal that has none and was
 *  not dismissed. A terminal in a branch's checkout lives in that
 *  branch's tab, and is dismissed from the strip as it is listed, so it
 *  gets no tab later under a repository that does not know its branch. */
function openListed(state: Strip, entries: TerminalEntry[]): Strip {
  const dismissed = new Set(state.dismissed);
  const byId = new Map(
    state.tabs.flatMap((t): [string, TerminalTab][] =>
      t.kind === 'terminal' ? [[t.id, t]] : []
    )
  );
  let tabs: Tab[] = state.tabs;
  for (const entry of entries) {
    const id = terminalTabId(entry.name);
    const existing = byId.get(id);
    if (existing) {
      // A restored tab still waiting on its creation time is not this
      // listing's to stamp.
      const stamped = existing.restored ? existing : restamp(existing, entry);
      if (stamped !== existing)
        tabs = tabs.map((t) => (t.id === id ? stamped : t));
      continue;
    }
    if (entry.branch) {
      dismissed.add(terminalDismissKey(entry.name, entry.created));
      continue;
    }
    if (!isTerminalDismissed(dismissed, entry))
      tabs = [...tabs, terminalTab(entry, true)];
  }
  const grown = dismissed.size !== state.dismissed.length;
  if (tabs === state.tabs && !grown) return state;
  return { ...state, tabs, ...(grown ? { dismissed: [...dismissed] } : {}) };
}

/**
 * Close the tab of every terminal the listing no longer has.
 *
 * Through the same close as the user's, so the focus rules are the
 * user's too — the neighbour takes over, and never one from another
 * repository. Nothing is dismissed by it: the terminal has ended, and
 * if the host lists the name again it re-adopted a live session under
 * it (the user detached from inside tmux and discovery found it still
 * running), which deserves its tab back.
 */
function dropEnded(
  state: Strip,
  repo: string,
  entries: TerminalEntry[]
): Strip {
  const listed = new Set(entries.map((e) => terminalTabId(e.name)));
  let next = state;
  for (const tab of state.tabs) {
    if (tab.kind !== 'terminal' || !tab.listed || listed.has(tab.id)) continue;
    next = closeTab(next, tab.id, repo);
  }
  return next;
}

/** The listing's view of a terminal, onto its tab — the same tab when
 *  nothing moved. The directory itself never changes; what can is its
 *  repository (a `.git` appearing) and how home is written, and the
 *  creation time arrives once discovery lists it. Being named by a
 *  listing at all is the other thing a tab learns here. */
function restamp(tab: TerminalTab, entry: TerminalEntry): TerminalTab {
  const next: TerminalTab = {
    ...tab,
    cwd: entry.cwd,
    displayPath: entry.displayPath,
    repo: entry.repo,
    listed: true,
  };
  const created = entry.created ?? tab.created;
  const machine = entry.machine ?? tab.machine;
  if (created !== undefined) next.created = created;
  if (machine !== undefined) next.machine = machine;
  const fields = ['listed', 'repo', 'displayPath', 'cwd', 'created', 'machine'];
  const same = fields.every(
    (k) => next[k as keyof TerminalTab] === tab[k as keyof TerminalTab]
  );
  return same ? tab : next;
}
