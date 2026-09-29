import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { LinePoint } from '../diff/range-selection.js';
import type { PaneState } from '../review/overview-model.js';

/**
 * Where the user was on each tab, for coming back to it: which pane
 * showed, and in the diff the file picked and the line at the top, and
 * the walkthrough's step.
 *
 * Held for this run only, in memory: a window reload may lose it, and
 * nothing is written anywhere. The editor owns the map (`EditorArea`)
 * and drops a tab's entry when the tab closes. A view reads its entry
 * once, as its initial state when it mounts, and writes it as it
 * changes — so a pane mounted again after a switch, or rendered ahead
 * of one as the spare, opens where the user left it. What no longer
 * exists when it comes back (a file gone from the diff, a line folded
 * away) is not guessed at: the view starts from the top.
 */
export interface TabView {
  pane?: PaneState;
  file?: string | null;
  anchor?: LinePoint;
  step?: number;
}

export type TabViews = Map<string, TabView>;

const TabViewsContext = createContext<TabViews | null>(null);
const TabIdContext = createContext<string | null>(null);

export const TabViewsProvider = TabViewsContext.Provider;
/** Names the tab a pane shows, for the views inside it. */
export const TabViewScope = TabIdContext.Provider;

/** The editor's map of views, with entries for closed tabs dropped.
 *  One map for the editor's life, written in place: saving a view is
 *  not a change anything renders from, so it re-renders nothing. (Held
 *  in state rather than a ref because views read it while rendering.) */
export function useTabViewsHost(openIds: readonly string[]): TabViews {
  const [views] = useState<TabViews>(() => new Map());
  useEffect(() => {
    const open = new Set(openIds);
    for (const id of views.keys()) {
      if (!open.has(id)) views.delete(id);
    }
  }, [views, openIds]);
  return views;
}

/**
 * This tab's saved view, read once, and a way to save to it. Outside a
 * tab (a component rendered on its own) nothing is saved or restored.
 */
export function useTabView(): {
  saved: TabView;
  save: (patch: TabView) => void;
} {
  const views = useContext(TabViewsContext);
  const id = useContext(TabIdContext);
  const [saved] = useState<TabView>(() =>
    views && id ? views.get(id) ?? {} : {}
  );
  const save = useCallback(
    (patch: TabView) => {
      if (!views || id === null) return;
      views.set(id, { ...views.get(id), ...patch });
    },
    [views, id]
  );
  return { saved, save };
}
