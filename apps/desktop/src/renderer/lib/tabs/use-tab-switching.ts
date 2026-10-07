import { useEffect, useRef } from 'react';
import { resolveDesktopAction, type DesktopActionId } from '@n10/core/ui';
import { useDesktopPrefs } from '../desktop-prefs.js';
import { isRecordingShortcut, useDesktopBindings } from '../keybindings.js';
import { commitMru, EMPTY_MRU, noteTabs, stepMru } from './tab-mru.js';
import { useTabs } from './tabs.js';

const STEP: Record<DesktopActionId, 1 | -1> = {
  'desktop.tabs.next': 1,
  'desktop.tabs.previous': -1,
  'desktop.tabs.cycle-next': 1,
  'desktop.tabs.cycle-previous': -1,
};

const MRU_CAPABLE = new Set<DesktopActionId>([
  'desktop.tabs.cycle-next',
  'desktop.tabs.cycle-previous',
]);

/** A modifier that holds a walk open is still down. Shift alone does
 *  not count: it only reverses the direction. */
function walkHeld(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.altKey || e.metaKey;
}

/** A modal (a dialog, the palette) owns the keyboard while it is up. */
function inModal(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[role="dialog"]') !== null
  );
}

/**
 * Switch the editor tab strip from the keyboard: the four rebindable
 * desktop shortcuts (Ctrl+PgDn/PgUp positional, Ctrl+Tab/Ctrl+Shift+Tab
 * positional or most-recently-used per the `tabCycleMru` pref).
 *
 * Heard on the window in the capture phase and stopped there, so they
 * work while an embedded terminal or a text box has focus — neither
 * ever sees the chord.
 */
export function useTabSwitching(): void {
  const tabs = useTabs();
  const bindings = useDesktopBindings();
  const { tabCycleMru } = useDesktopPrefs();
  const mru = useRef(EMPTY_MRU);
  const latest = useRef({ tabs, bindings, tabCycleMru });

  const tabIds = tabs.tabs.map((t) => t.id).join('\n');
  useEffect(() => {
    latest.current = { tabs, bindings, tabCycleMru };
  });
  useEffect(() => {
    mru.current = noteTabs(
      mru.current,
      tabIds ? tabIds.split('\n') : [],
      tabs.activeId
    );
  }, [tabIds, tabs.activeId]);

  useEffect(() => {
    const commit = () => {
      mru.current = commitMru(mru.current);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (isRecordingShortcut() || inModal(e.target)) return;
      const { tabs: api, bindings: keys, tabCycleMru: byMru } = latest.current;
      const action = resolveDesktopAction(e, keys);
      if (!action) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const delta = STEP[action];
      if (!byMru || !MRU_CAPABLE.has(action)) {
        api.cycle(delta);
        return;
      }
      const ids = api.tabs.map((t) => t.id);
      const step = stepMru(mru.current, ids, api.activeId, delta);
      mru.current = step.mru;
      if (step.target) api.activate(step.target);
      // A chord with no modifier to hold has no release to wait for.
      if (!walkHeld(e)) commit();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!walkHeld(e)) commit();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', commit);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', commit);
    };
  }, []);
}
