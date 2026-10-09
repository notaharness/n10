import { useEffect, useRef } from 'react';
import { activeTabRepo, useTabs } from './tabs.js';

/**
 * Keep the open repository pointing at whichever tab is in front of the
 * user.
 *
 * The tab strip outlives a repo switch, so the active tab can belong to
 * a repository that is not open — the user clicked it, cycled onto it,
 * or the tab beside it closed and handed it focus. Its pane renders
 * against that repository either way (`EditorPane`), but the host takes
 * writes and launches only for the selected one (`requireRepo`, the
 * session-ownership guard), so its repo is opened: the sidebar and
 * status bar then describe the same repository the editor is showing,
 * which is the only arrangement where "which repo am I in?" has one
 * answer.
 *
 * It reacts to a change of *active tab*, never to a change of
 * repository. Opening a repo from the picker while a foreign tab
 * happens to be active would otherwise bounce straight back to that
 * tab's repo, and a failed open would retry forever.
 */
export function useRepoFollowsTabs(
  repoCwd: string | null,
  openRepo: (cwd: string) => Promise<boolean>,
  ready = true
): void {
  const tabs = useTabs();
  const target = activeTabRepo(tabs);
  const lastActiveId = useRef(tabs.activeId);
  const initialTarget = useRef(target);
  const initialRepoHandled = useRef(false);
  const repoOpened = tabs.repoOpened;
  const shown = useRef<string | null>(null);

  // The other direction: the repository the workspace comes up on —
  // at start, or from the picker — decides which tab is in front, or it
  // would open onto a pane about another one. A switch between two
  // repositories leaves it to the open that succeeded (`adoptRepo`): a
  // failed one returns here, and must not take the tab that asked.
  useEffect(() => {
    if (!ready) return;
    const was = shown.current;
    shown.current = repoCwd;
    if (was !== null || repoCwd === null) return;
    if (!initialRepoHandled.current) {
      initialRepoHandled.current = true;
      // A restored strip may come up in front of another repository's
      // tab: open that repository instead, keeping this one if it fails.
      const savedRepo = initialTarget.current;
      if (savedRepo && savedRepo !== repoCwd) {
        void openRepo(savedRepo).then((opened) => {
          if (!opened) repoOpened(repoCwd);
        });
        return;
      }
    }
    repoOpened(repoCwd);
  }, [ready, repoCwd, repoOpened, openRepo]);

  useEffect(() => {
    const activeId = tabs.activeId;
    const moved = lastActiveId.current !== activeId;
    lastActiveId.current = activeId;
    if (!moved) return;
    // No repo open at all means the picker is on screen; the user asked
    // for it and the tabs do not get to override that.
    if (repoCwd === null || target === null || target === repoCwd) return;
    void openRepo(target);
  }, [tabs.activeId, target, repoCwd, openRepo]);
}
