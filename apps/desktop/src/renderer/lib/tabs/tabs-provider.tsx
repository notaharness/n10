import { useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { WorkspaceContext } from './tabs.js';
import { reduce } from './tabs-model.js';
import {
  type Restored,
  useRestoredWorkspace,
  useSaveWorkspace,
} from './workspace-persistence.js';

/** The strip's state, above the repository gate: it spans repositories.
 *  Drawn once the saved workspace is restored; `fallback` until then. */
export function TabsProvider({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  const restored = useRestoredWorkspace();
  if (!restored) return fallback;
  return <RestoredTabs restored={restored}>{children}</RestoredTabs>;
}

function RestoredTabs({
  restored,
  children,
}: {
  restored: Restored;
  children: ReactNode;
}) {
  const [workspace, dispatch] = useReducer(reduce, restored.workspace);
  useSaveWorkspace(workspace, restored.canSave);

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

  const store = useMemo(() => ({ workspace, dispatch }), [workspace]);
  return (
    <WorkspaceContext.Provider value={store}>
      {children}
    </WorkspaceContext.Provider>
  );
}
