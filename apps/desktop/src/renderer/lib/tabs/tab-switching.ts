import {
  resolveDesktopAction,
  type DesktopActionId,
  type DesktopBindings,
} from '@n10/core/ui';
import {
  commitMru,
  EMPTY_MRU,
  noteTabs,
  stepMru,
  type TabMru,
} from './tab-mru.js';

/**
 * The keyboard tab switcher, apart from React: one MRU order for the
 * window and the listeners that drive it. The order lives here, at
 * module level, because the strip spans repositories while the screen
 * under it does not: switching repositories remounts the workspace, and
 * a Ctrl+Tab walk onto another repository's tab is exactly what
 * switches them. Neither may lose the order or a walk in progress.
 */
let mru: TabMru = EMPTY_MRU;

/** What a key press needs to know about the app, read at press time. */
export interface TabSwitchingDeps {
  bindings(): DesktopBindings;
  /** Ctrl+Tab walks by recent use (the `tabCycleMru` pref). */
  byRecentUse(): boolean;
  /** A settings row is recording a chord: stand aside. */
  recording(): boolean;
  tabIds(): readonly string[];
  activeId(): string | null;
  cycle(delta: 1 | -1): void;
  activate(id: string): void;
}

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

type KeyEvent = Event & {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

/** A modifier that holds a walk open is still down. Shift alone does
 *  not count: it only reverses the direction. */
function walkHeld(e: KeyEvent): boolean {
  return e.ctrlKey || e.altKey || e.metaKey;
}

/** A modal (a dialog, the palette) owns the keyboard while it is up. */
function inModal(target: EventTarget | null): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return (
    typeof el?.closest === 'function' && el.closest('[role="dialog"]') !== null
  );
}

/** The strip changed (tabs, or which one is in front). */
export function noteStrip(
  tabIds: readonly string[],
  activeId: string | null
): void {
  mru = noteTabs(mru, tabIds, activeId);
}

/** The order and any walk in progress, for tests. */
export function currentMru(): TabMru {
  return mru;
}

/** Forget the order; tests only. */
export function resetTabMru(): void {
  mru = EMPTY_MRU;
}

function commit(): void {
  mru = commitMru(mru);
}

function onKeyDown(e: KeyEvent, deps: TabSwitchingDeps): void {
  if (deps.recording() || inModal(e.target)) return;
  const action = resolveDesktopAction(e, deps.bindings());
  if (!action) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const delta = STEP[action];
  if (!deps.byRecentUse() || !MRU_CAPABLE.has(action)) {
    deps.cycle(delta);
    return;
  }
  const step = stepMru(mru, deps.tabIds(), deps.activeId(), delta);
  mru = step.mru;
  if (step.target) deps.activate(step.target);
  // A chord with no modifier to hold has no release to wait for.
  if (!walkHeld(e)) commit();
}

/**
 * Listen on `target` (the window) in the capture phase and stop the
 * chord there, so the shortcuts work while an embedded terminal or a
 * text box has focus and neither ever sees them. A walk commits when
 * the last holding modifier is let go, or the window loses focus (the
 * release then never arrives). Answers the way to stop listening;
 * the order and a walk in progress outlive it.
 */
export function listenForTabSwitching(
  target: EventTarget,
  deps: TabSwitchingDeps
): () => void {
  const down = (e: Event) => onKeyDown(e as KeyEvent, deps);
  const up = (e: Event) => {
    if (!walkHeld(e as KeyEvent)) commit();
  };
  target.addEventListener('keydown', down, true);
  target.addEventListener('keyup', up, true);
  target.addEventListener('blur', commit);
  return () => {
    target.removeEventListener('keydown', down, true);
    target.removeEventListener('keyup', up, true);
    target.removeEventListener('blur', commit);
  };
}
