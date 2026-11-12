import { useEffect, useRef } from 'react';
import { useDesktopPrefs } from '../desktop-prefs.js';
import { isRecordingShortcut, useDesktopBindings } from '../keybindings.js';
import { listenForTabSwitching, noteStrip } from './tab-switching.js';
import { useTabs, useWorkspace } from './tabs.js';
import { panesOf } from './workspace.js';

/**
 * Switch the editor tab strip from the keyboard: the rebindable desktop
 * shortcuts (Ctrl+PgDn/PgUp positional, Ctrl+Tab/Ctrl+Shift+Tab
 * positional or most-recently-used per the `tabCycleMru` pref), and
 * Ctrl+Alt+P to pin or unpin the active tab. Mount
 * it above the repository gate, beside the strip; `tab-switching.ts`
 * holds the order and the listeners. `enabled` is false while no
 * repository is open, when the strip is not on screen.
 */
export function useTabSwitching(enabled: boolean): void {
  const tabs = useTabs();
  const bindings = useDesktopBindings();
  const { tabCycleMru } = useDesktopPrefs();
  const latest = useRef({ tabs, bindings, tabCycleMru, enabled });

  // Recent use spans the panes, so a pane focused again keeps its
  // order; a walk goes through the focused pane's tabs alone.
  const { workspace } = useWorkspace();
  const tabIds = panesOf(workspace.layout)
    .flatMap((p) => p.order)
    .join('\n');
  useEffect(() => {
    latest.current = { tabs, bindings, tabCycleMru, enabled };
  });
  useEffect(() => {
    noteStrip(tabIds ? tabIds.split('\n') : [], tabs.activeId);
  }, [tabIds, tabs.activeId]);

  useEffect(
    () =>
      listenForTabSwitching(window, {
        enabled: () => latest.current.enabled,
        bindings: () => latest.current.bindings,
        byRecentUse: () => latest.current.tabCycleMru,
        recording: isRecordingShortcut,
        tabIds: () => latest.current.tabs.tabs.map((t) => t.id),
        activeId: () => latest.current.tabs.activeId,
        activate: (id) => latest.current.tabs.activate(id),
      }),
    []
  );
}
