import { useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { TabsContext, tabsActions } from './tabs.js';
import { reduce } from './tabs-model.js';
import { focusedPaneOf, stripOf, type Workspace } from './workspace.js';
import {
  useRestoredWorkspace,
  useSaveWorkspace,
} from './workspace-persistence.js';

/** The strip's state, above the repository gate: it spans repositories.
 *  Drawn once the saved workspace is restored. */
export function TabsProvider({ children }: { children: ReactNode }) {
  const restored = useRestoredWorkspace();
  if (!restored) return null;
  return <RestoredTabs initial={restored}>{children}</RestoredTabs>;
}

function RestoredTabs({
  initial,
  children,
}: {
  initial: Workspace;
  children: ReactNode;
}) {
  const [workspace, dispatch] = useReducer(reduce, initial);
  useSaveWorkspace(workspace);

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

  const actions = useMemo(() => tabsActions(dispatch), []);
  const api = useMemo(
    () => ({
      ...stripOf(workspace, focusedPaneOf(workspace).id),
      ...actions,
    }),
    [workspace, actions]
  );
  return <TabsContext.Provider value={api}>{children}</TabsContext.Provider>;
}
