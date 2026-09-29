import { foreignRepoOf } from './tab-identity.js';
import type { Tab } from './tabs-model.js';

/** What the editor showed last, and what it showed before that. */
export interface Shown {
  tab: Tab | null;
  left: Tab | null;
  /** The pre-warm count at the switch: a hover after it wins over
   *  `left`, one before it has already been used. */
  seq: number;
}

export const NOTHING_SHOWN: Shown = { tab: null, left: null, seq: 0 };

/** The pane held ready: the tab a hover settled on since the last
 *  switch, or else the one on screen before it, while still open. */
export function spareFor(
  shown: Shown,
  hover: { tab: Tab | null; seq: number },
  tabs: readonly Tab[]
): Tab | null {
  if (hover.seq > shown.seq) return hover.tab;
  const left = shown.left;
  return left && tabs.some((t) => t.id === left.id) ? left : null;
}

/**
 * The tab whose pane is on screen. A tab that has to mount waits for
 * the deferred render (`deferredId`); one already rendered — the spare,
 * or the pane already on screen — is shown at once, and stays shown
 * while the deferred id catches up. Without that, switching back to the
 * tab left last would show it, then the stale deferred one, then it
 * again, and never settle.
 */
export function shownIdFor({
  activeId,
  deferredId,
  spare,
  shown,
}: {
  activeId: string | null;
  deferredId: string | null;
  spare: Tab | null;
  shown: Tab | null;
}): string | null {
  const rendered =
    activeId !== null && (spare?.id === activeId || shown?.id === activeId);
  return rendered ? activeId : deferredId;
}

/**
 * The panes to render, sorted by id so a swap moves none in the DOM:
 * the one on screen, unless it belongs to another repository (its data
 * cannot be read from here), and the spare, unless it is that same
 * pane or another repository's.
 */
export function panesFor(
  onScreen: Tab | undefined,
  spare: Tab | null,
  repo: string
): Tab[] {
  const panes: Tab[] = [];
  if (onScreen && !foreignRepoOf(onScreen, repo)) panes.push(onScreen);
  if (spare && spare.id !== onScreen?.id && !foreignRepoOf(spare, repo)) {
    panes.push(spare);
  }
  return panes.sort((a, b) => (a.id < b.id ? -1 : 1));
}
