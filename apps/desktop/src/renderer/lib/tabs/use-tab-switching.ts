import { useEffect, useRef } from 'react';
import { useDesktopPrefs } from '../desktop-prefs.js';
import { isRecordingShortcut, useDesktopBindings } from '../keybindings.js';
import { listenForTabSwitching, noteStrip } from './tab-switching.js';
import { useTabs } from './tabs.js';

/**
 * Switch the editor tab strip from the keyboard: the four rebindable
 * desktop shortcuts (Ctrl+PgDn/PgUp positional, Ctrl+Tab/Ctrl+Shift+Tab
 * positional or most-recently-used per the `tabCycleMru` pref). Mount
 * it above the repository gate, beside the strip; `tab-switching.ts`
 * holds the order and the listeners.
 */
export function useTabSwitching(): void {
  const tabs = useTabs();
  const bindings = useDesktopBindings();
  const { tabCycleMru } = useDesktopPrefs();
  const latest = useRef({ tabs, bindings, tabCycleMru });

  const tabIds = tabs.tabs.map((t) => t.id).join('\n');
  useEffect(() => {
    latest.current = { tabs, bindings, tabCycleMru };
  });
  useEffect(() => {
    noteStrip(tabIds ? tabIds.split('\n') : [], tabs.activeId);
  }, [tabIds, tabs.activeId]);

  useEffect(
    () =>
      listenForTabSwitching(window, {
        bindings: () => latest.current.bindings,
        byRecentUse: () => latest.current.tabCycleMru,
        recording: isRecordingShortcut,
        tabIds: () => latest.current.tabs.tabs.map((t) => t.id),
        activeId: () => latest.current.tabs.activeId,
        cycle: (delta) => latest.current.tabs.cycle(delta),
        activate: (id) => latest.current.tabs.activate(id),
      }),
    []
  );
}
