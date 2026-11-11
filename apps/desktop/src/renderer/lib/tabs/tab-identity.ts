/**
 * What a tab *is*: its shape, and the identities derived from it.
 *
 * Split from the reducer because these are the answers the rest of
 * the app asks about a tab — which repository it belongs to, whether
 * that is the open one — and none of them involve a transition.
 */
import type { TerminalKind } from '../../../host/contract.js';

export type Tab =
  | {
      id: string;
      kind: 'item';
      /** Absolute path of the repository this tab belongs to. Half of
       *  the tab's identity: `branch:main` means a different thing in
       *  each open repo. */
      repo: string;
      itemKey: string;
      preview: boolean;
      /** Last-known git branch, stamped by `sync-items`. The stable
       *  identity a tab falls back on when its itemKey goes stale —
       *  a worktree's key changes from `branch:x` to `pr:n` the moment
       *  a PR appears (and back when it closes). */
      branch?: string;
      /** The worktree checkout the tab's item lives in, stamped by
       *  `sync-items`. A worktree's identity: `git switch` inside it
       *  moves its item to another branch's key, and the tab follows
       *  it here before anything else. */
      worktree?: string;
      /** The branch the tab was opened for, stamped once by
       *  `sync-items` — the branch the worktree's agent session was
       *  created for when it has one. The tab warns while its worktree
       *  is on any other. */
      originBranch?: string;
      /** Last-known display title, stamped by `sync-items`. What the
       *  strip shows once the item is out of reach — its repository is
       *  not the open one, so the sidebar cannot describe it — rather
       *  than falling back to a key. */
      title?: string;
      /** The registry name of the agent session on this item, stamped
       *  by `sync-items` (or the foreign listing). What closing the tab
       *  dismisses: see `dismissKeyOf`. */
      session?: string;
    }
  | { id: 'settings'; kind: 'settings'; preview: false }
  | {
      id: string;
      kind: 'terminal';
      /** Qualified session key — the terminal's identity. */
      name: string;
      terminalKind: TerminalKind;
      cwd: string;
      /** `cwd` with home written as `~`, as the host renders it. */
      displayPath: string;
      /** The repository this terminal's directory is the root of, or
       *  `null` for a plain folder — which belongs to nobody, sits in
       *  the repo-less group, and is never foreign. */
      repo: string | null;
      /** Terminals are always pinned: a preview tab gets replaced by
       *  the next click, and a shell is not something to lose that way. */
      preview: false;
      /** Whether a host listing has named this terminal yet. A tab
       *  opened on the launch's own answer starts out unlisted, and a
       *  listing fetched before the terminal existed says nothing about
       *  it — only a listing that has named it, and then stops, has
       *  seen it end. */
      listed: boolean;
      /** Its tmux session's creation time, once a listing has said. A
       *  saved tab carries it, and binds on restore only to a session
       *  with the same name *and* this time: names are reused. */
      created?: number;
      /** The machine it runs on, `'local'` or a beam peerId, once a
       *  listing has said. A restored tab on another machine is not
       *  given up for being unlisted: that machine may be offline. */
      machine?: string;
      /** Restored from the saved workspace and not yet matched against
       *  a listing. Its pane attaches nothing until it is. */
      restored?: true;
    };

/** A tab that shows a sidebar item, and so belongs to a repository. */
export type ItemTab = Extract<Tab, { kind: 'item' }>;
export type TerminalTab = Extract<Tab, { kind: 'terminal' }>;

/**
 * The id of the tab for `itemKey` in `repo`.
 *
 * Length-prefixed rather than joined on a separator: repository paths
 * and branch names can both contain any punctuation a separator might
 * use, and a collision here is two repos' tabs rendering each other's
 * pane (panes are keyed by tab id).
 */
export function itemTabId(repo: string, itemKey: string): string {
  return `item:${repo.length}:${repo}:${itemKey}`;
}

/**
 * Whether `tab` is the tab for `itemKey` in `repo`: it shows that item
 * now, or it was opened on it (its id) and has since only been
 * re-keyed — `branch:x` growing into `pr:n`. A tab that followed its
 * worktree onto another branch no longer stands for the item it was
 * opened on; that item, left behind in the sidebar, gets a tab of its
 * own.
 */
export function standsFor(tab: Tab, repo: string, itemKey: string): boolean {
  if (tab.kind !== 'item' || tab.repo !== repo) return false;
  if (tab.itemKey === itemKey) return true;
  const movedOff =
    tab.originBranch !== undefined &&
    tab.branch !== undefined &&
    tab.branch !== tab.originBranch;
  return !movedOff && tab.id === itemTabId(repo, itemKey);
}

/**
 * The id opening `itemKey` in `repo` lands on: the tab already
 * standing for it, or a new one. A new tab whose natural id is still
 * held by a tab that moved off it takes a suffixed one — `~` cannot
 * occur in a branch name or a PR key, so the suffix never collides with
 * another item's id. The moved tab keeps its id: panes are keyed by it,
 * and re-iding would remount its terminal.
 */
export function tabIdFor(
  tabs: readonly Tab[],
  repo: string,
  itemKey: string
): string {
  const existing = tabs.find((t) => standsFor(t, repo, itemKey));
  if (existing) return existing.id;
  const base = itemTabId(repo, itemKey);
  const taken = new Set(tabs.map((t) => t.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}~${n}`;
  return id;
}

/**
 * The tab a single click on `itemKey` shows: the one already standing
 * for it, or the preview tab `open-item` would make, id and all — so a
 * pane rendered for it ahead of the click is the pane the click shows.
 */
export function tabOpening(
  tabs: readonly Tab[],
  repo: string,
  itemKey: string
): Tab {
  return (
    tabs.find((t) => standsFor(t, repo, itemKey)) ?? {
      id: tabIdFor(tabs, repo, itemKey),
      kind: 'item',
      repo,
      itemKey,
      preview: true,
    }
  );
}

/** The id of the tab for a terminal session. Session names are unique
 *  across directories and repositories, so the name alone is the key. */
export function terminalTabId(name: string): string {
  return `terminal:${name}`;
}

/** The repository a tab is at home in, or null for one that belongs to
 *  nobody — settings, and a terminal in a plain folder. */
export function tabHome(tab: Tab): string | null {
  return tab.kind === 'settings' ? null : tab.repo;
}

/** Identity of an item tab as a map key — the same pair, unambiguous. */
export function pairKey(tab: Tab): string {
  return tab.kind === 'item' ? itemTabId(tab.repo, tab.itemKey) : tab.id;
}

/** Whether `tab` belongs to a repository other than the open one.
 *  Settings belongs to none, so it is never foreign. */
export function isForeignTab(tab: Tab, repo: string): boolean {
  return foreignRepoOf(tab, repo) !== null;
}

/** The other repository `tab` belongs to, or null when it is at home
 *  — or belongs to nobody, which counts as at home everywhere. */
export function foreignRepoOf(tab: Tab, repo: string): string | null {
  const home = tabHome(tab);
  return home !== null && home !== repo ? home : null;
}

/** Identity of an item's agent session, unique across repositories:
 *  what `dismissed` records for it. Repo-qualified for the same reason
 *  tab ids are — the PTY registry keys sessions by bare branch name, so
 *  two repos' agents share a name. */
export function sessionKey(repo: string, sessionName: string): string {
  return `${repo.length}:${repo}:${sessionName}`;
}

/** Whether `key` (from {@link sessionKey}) is a session of `repo`. */
export function isSessionKeyOf(key: string, repo: string): boolean {
  return key.startsWith(sessionKey(repo, ''));
}

/** The dismissal key of a terminal session. With its creation time it
 *  names that one session, so a later one under the same name is not
 *  dismissed with it; without, any session of that name. */
export function terminalDismissKey(name: string, created?: number): string {
  return created === undefined
    ? terminalTabId(name)
    : `terminal@${created}:${name}`;
}

/** The session name inside a key from {@link sessionKey}. */
export function sessionOfKey(key: string): string {
  const length = /^(\d+):/.exec(key);
  if (!length) return key;
  return key.slice(length[0].length + Number(length[1]) + 1);
}

/** The session name inside a key from {@link terminalDismissKey}. */
export function terminalOfKey(key: string): string {
  return key.slice(key.indexOf(':') + 1);
}

/**
 * The machine a registry name says its session runs on: the optional
 * trailing segment of its tuple (`@n10/core`'s `session-key.ts`), after
 * a terminal's id or a worktree's repository and checkout. `'local'`
 * when there is none, or the name is no tuple.
 */
export function machineOfSession(name: string): string {
  let value: unknown;
  try {
    value = JSON.parse(name);
  } catch {
    return 'local';
  }
  if (!Array.isArray(value)) return 'local';
  const at = value[0] === 'terminal' ? 2 : value[0] === 'worktree' ? 3 : -1;
  const machine: unknown = at < 0 ? undefined : value[at];
  return typeof machine === 'string' ? machine : 'local';
}

/** The session key closing `tab` dismisses: a terminal's own, an
 *  item's agent, or `null` for a tab with no session behind it. */
export function dismissKeyOf(tab: Tab): string | null {
  if (tab.kind === 'terminal') return terminalDismissKey(tab.name, tab.created);
  if (tab.kind === 'item' && tab.session) {
    return sessionKey(tab.repo, tab.session);
  }
  return null;
}
