import { useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { TabsContext, tabsApi } from './tabs.js';
import { EMPTY_TABS, reduce } from './tabs-model.js';

/** The strip's state, above the repository gate: it spans repositories. */
export function TabsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, EMPTY_TABS);

  // A removed worktree takes its tabs with it, whoever removed it: n10,
  // `git worktree remove` or `rm -rf`. Heard here, above the repo gate,
  // because the strip spans repositories and the workspace remounts per
  // repository — a scan landing mid-switch would find no listener there.
  useEffect(
    () =>
      window.n10.onDiscoveryChanged(({ repo, removedWorktrees }) => {
        if (removedWorktrees.length === 0) return;
        dispatch({
          type: 'worktrees-removed',
          repo,
          worktrees: removedWorktrees,
        });
      }),
    []
  );

  const api = useMemo(() => tabsApi(state, dispatch), [state]);
  return <TabsContext.Provider value={api}>{children}</TabsContext.Provider>;
}
