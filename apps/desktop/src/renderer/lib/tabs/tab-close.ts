import { isForeignTab, terminalTabId, type Tab } from './tab-identity.js';
import type { TabsState } from './tabs-model.js';

/**
 * Taking a tab off the strip, and where focus goes when it was the
 * active one.
 *
 * Its own module because several transitions close tabs: the user's
 * `close`, the host reporting that the process behind a terminal tab
 * has ended, and discovery reporting that a worktree is gone. All must
 * move focus by the same rule, or a shell exiting would be the one way
 * to land the workspace on another repository.
 */

/**
 * Drop a tab, and when it was the active one hand focus to the tab that
 * slid into its place (the last tab, if it was the rightmost).
 */
export function closeTab(
  state: TabsState,
  id: string,
  repo: string | undefined
): TabsState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  let activeId = state.activeId;
  if (state.activeId === id) {
    activeId = nextActive(tabs, idx, repo) ?? null;
  }
  return { ...state, tabs, activeId };
}

/** An exit for a different session using a saved name cannot dismiss its tab. */
export function closeEndedTerminal(
  state: TabsState,
  name: string,
  repo: string | undefined
): TabsState {
  const tab = state.tabs.find((entry) => entry.id === terminalTabId(name));
  if (tab?.kind === 'terminal' && tab.resumeRequired) return state;
  return closeTab(state, terminalTabId(name), repo);
}

/**
 * Close every tab of `repo` that belongs to one of `worktrees` — the
 * checkouts discovery reported gone, however they went. A tab knows
 * its worktree once a sync has seen the item there, so one opened for
 * a worktree still being created is not among them.
 */
export function closeRemovedWorktrees(
  state: TabsState,
  repo: string,
  worktrees: readonly string[]
): TabsState {
  const gone = new Set(worktrees);
  return state.tabs.reduce(
    (next, t) =>
      t.kind === 'item' &&
      t.repo === repo &&
      t.worktree !== undefined &&
      gone.has(t.worktree)
        ? closeTab(next, t.id, repo)
        : next,
    state
  );
}

/**
 * Which tab takes over when the active one closes.
 *
 * The tab that slid into its place, as ever — but never one from
 * another repository. Focus is what the workspace follows, so handing
 * it across a repository boundary would switch the sidebar, the status
 * bar and every query because the user closed a tab. When the repo in
 * view has nothing left, nothing is active: that is its empty state,
 * with the other repositories' tabs still on the strip.
 */
function nextActive(
  tabs: readonly Tab[],
  idx: number,
  repo: string | undefined
): string | null {
  const neighbour = tabs[Math.min(idx, tabs.length - 1)];
  if (repo === undefined || !neighbour || !isForeignTab(neighbour, repo)) {
    return neighbour?.id ?? null;
  }
  // Nearest tab of the repo in view, looking right first — the same
  // direction the plain neighbour rule prefers.
  for (let d = 0; d < tabs.length; d++) {
    const right = tabs[idx + d];
    if (right && !isForeignTab(right, repo)) return right.id;
    const left = tabs[idx - 1 - d];
    if (left && !isForeignTab(left, repo)) return left.id;
  }
  return null;
}
