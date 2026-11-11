import { sessionKey, standsFor, tabIdFor, type Tab } from './tab-identity.js';
import { keepTab } from './tab-order.js';
import type { ItemEntry } from './tabs-model.js';
import type { Strip } from './workspace.js';

/**
 * The passes that open item and settings tabs: the user's open, and
 * `sync-items` giving each running agent its tab.
 */

/**
 * Activate the tab for an item, opening one if none is on it yet.
 *
 * The search is {@link standsFor}: by itemKey, and by the id the tab
 * was opened with — a re-keyed tab (see `sync-items`) keeps its
 * original id, so a tab opened as `branch:x` and since re-keyed to
 * `pr:n` must be found when `branch:x` is opened again, which the
 * palette does whenever the branch isn't in the sidebar model yet.
 * Panes are keyed by tab id, so two tabs sharing one would render each
 * other's content and closing one would act on the wrong tab — which
 * is also why a tab that followed its worktree off the item it was
 * opened on does not match by id, and the new tab takes a free one
 * ({@link tabIdFor}).
 *
 * Confined to `repo`: the same item key in another repository is a
 * different item, and matching it would hand this repo's click to a
 * tab pointing at someone else's branch.
 */
export function openItem(
  state: Strip,
  repo: string,
  itemKey: string,
  preview: boolean
): Strip {
  const existing = state.tabs.find((t) => standsFor(t, repo, itemKey));
  if (existing) {
    const kept = preview ? state : keepTab(state, existing.id);
    return { ...kept, activeId: existing.id };
  }
  const id = tabIdFor(state.tabs, repo, itemKey);
  const next: Tab = { id, kind: 'item', repo, itemKey, preview };
  // Replace this repo's preview tab (if any) instead of stacking.
  // Scoped to the repo: another repository's preview tab is a tab the
  // user can no longer see, and swallowing it on a click over here
  // would delete work in a window they are not looking at.
  const previewIdx = state.tabs.findIndex(
    (t) => t.preview && t.kind === 'item' && t.repo === repo
  );
  if (preview && previewIdx >= 0) {
    const tabs = [...state.tabs];
    tabs[previewIdx] = next;
    return { ...state, tabs, activeId: id };
  }
  return { ...state, tabs: [...state.tabs, next], activeId: id };
}

/** Settings is a singleton tab: open it once, activate it thereafter. */
export function openSettings(state: Strip): Strip {
  if (state.tabs.some((t) => t.id === 'settings')) {
    return { ...state, activeId: 'settings' };
  }
  return {
    ...state,
    tabs: [...state.tabs, { id: 'settings', kind: 'settings', preview: false }],
    activeId: 'settings',
  };
}

/**
 * Every running agent gets a tab unless it was dismissed: restores the
 * tabs for tmux sessions that survived a restart, and surfaces sessions
 * started elsewhere. A tab the user closes stays closed while the
 * sidebar keeps reporting the agent, because the close dismissed it
 * (`tab-dismissed.ts`); and an agent that already has a tab is left
 * alone, so this can't steal focus from what the user is looking at.
 *
 * With a tab already in front of the user, the new one opens in the
 * background and joins `unseen`: an agent started from a shell or by
 * an orchestrator is news, not a request to move. With nothing active
 * — the strip at launch, or after the user closed everything — it
 * takes focus, as there is no place to lose. Tabs the user asks for
 * through the UI go through `open-item` and are focused there.
 *
 * "Already has a tab" is asked of the strip both before `rekey` ran
 * and after. The two differ where re-keying collapsed a duplicate onto
 * the survivor: the tab carrying the id `item:<key>` is gone from the
 * new strip, but it was open, and the collapse was bookkeeping rather
 * than the user closing anything — asking the post-rekey strip alone
 * answers "no tab" there, and the `open-item` that follows finds the
 * survivor by its itemKey and activates it, moving the focus off
 * whatever the user had in front of them on a poll they never asked
 * for. And a tab re-keyed onto the entry's key this very sync (a
 * foreign tab meeting its repository's own sidebar) is found only in
 * the strip after.
 */
export function openRunning(
  state: Strip,
  repo: string,
  entries: ItemEntry[],
  before: readonly Tab[]
): Strip {
  const dismissed = new Set(state.dismissed);
  // Decided once for the whole sync: the launch restore opens every
  // surviving agent onto an empty strip, and only the first of them
  // would otherwise see nothing active.
  const background = state.activeId !== null;
  const hasTab = (key: string, tabs: readonly Tab[]) =>
    tabs.some((t) => standsFor(t, repo, key));
  let next = state;
  for (const e of entries) {
    if (!e.running || !e.sessionName) continue;
    if (dismissed.has(sessionKey(repo, e.sessionName))) continue;
    if (hasTab(e.itemKey, before) || hasTab(e.itemKey, next.tabs)) continue;
    const shown = withSession(openItem(next, repo, e.itemKey, false), e);
    next = background ? behindActive(next, shown) : shown;
  }
  return next;
}

/** `state` with its active tab — the one an open just landed on —
 *  stamped with the entry's session, so closing it before the next sync
 *  still dismisses the agent. */
function withSession(state: Strip, e: ItemEntry): Strip {
  const tabs = state.tabs.map(
    (t): Tab =>
      t.id === state.activeId && t.kind === 'item' && !t.session
        ? { ...t, session: e.sessionName }
        : t
  );
  return { ...state, tabs };
}

/** `opened`, with focus left where `state` had it. A tab the open
 *  added is marked unseen; one it found already on the strip — a
 *  re-keyed tab the user opened themselves — is not news. */
function behindActive(state: Strip, opened: Strip): Strip {
  const id = opened.activeId;
  const added = id !== null && !state.tabs.some((t) => t.id === id);
  return {
    ...opened,
    activeId: state.activeId,
    unseen: added ? [...state.unseen, id] : state.unseen,
  };
}
