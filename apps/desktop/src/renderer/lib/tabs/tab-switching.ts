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
import {
  hasStripCommands,
  isStripCommand,
  runStripCommand,
} from './strip-commands.js';
import {
  hasPaneCommands,
  isPaneCommand,
  runPaneCommand,
} from './pane-commands.js';

/**
 * The keyboard tab switcher, apart from React: one MRU order for the
 * window and the listeners that drive it. The order lives here, at
 * module level, because the strip spans repositories while the screen
 * under it does not: switching repositories remounts the workspace, and
 * a Ctrl+Tab walk onto another repository's tab is exactly what
 * switches them. Neither may lose the order or a walk in progress.
 */
let mru: TabMru = EMPTY_MRU;

/** The order the strip presents its tabs in (`presentedIds`): each
 *  group together, the members behind its chip included, in its
 *  roster's order. Noted by the strip; the
 *  positional shortcuts walk it. */
let presented: readonly string[] = [];

/** What a key press needs to know about the app, read at press time. */
export interface TabSwitchingDeps {
  /** A repository is open and the strip on screen. On the repository
   *  picker or while connecting, the keys do nothing and the order and
   *  any walk are left as they are. */
  enabled(): boolean;
  bindings(): DesktopBindings;
  /** Ctrl+Tab walks by recent use (the `tabCycleMru` pref). */
  byRecentUse(): boolean;
  /** A settings row is recording a chord: stand aside. */
  recording(): boolean;
  tabIds(): readonly string[];
  activeId(): string | null;
  activate(id: string): void;
}

const STEP: Partial<Record<DesktopActionId, 1 | -1>> = {
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
  repeat?: boolean;
  isComposing?: boolean;
};

let stripDragging = false;
export function setStripDragging(active: boolean): void {
  stripDragging = active;
}

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

/** The strip presented its tabs in this order. */
export function notePresentedOrder(ids: readonly string[]): void {
  presented = ids;
}

/**
 * The tab `delta` steps from `activeId` along the order the strip
 * presents, `null` with fewer than two tabs. A tab the strip has not
 * presented yet (opened since it last drew) follows in tab order.
 */
export function stepPresented(
  order: readonly string[],
  tabIds: readonly string[],
  activeId: string | null,
  delta: 1 | -1
): string | null {
  const open = new Set(tabIds);
  const shown = new Set(order);
  const walk = [
    ...order.filter((id) => open.has(id)),
    ...tabIds.filter((id) => !shown.has(id)),
  ];
  if (walk.length < 2) return null;
  const at = walk.indexOf(activeId ?? '');
  return walk[(at + delta + walk.length) % walk.length]!;
}

/** The order and any walk in progress, for tests. */
export function currentMru(): TabMru {
  return mru;
}

/** Forget the orders; tests only. */
export function resetTabMru(): void {
  mru = EMPTY_MRU;
  presented = [];
}

function commit(): void {
  mru = commitMru(mru);
}

/**
 * The tab `n` (1-based) of the focused pane's presented order, pinned
 * tabs first and chips' members included; 9 is the last. `null` for
 * a position the pane does not have.
 */
export function presentedAt(
  order: readonly string[],
  tabIds: readonly string[],
  n: number
): string | null {
  const open = new Set(tabIds);
  const shown = new Set(order);
  const walk = [
    ...order.filter((id) => open.has(id)),
    ...tabIds.filter((id) => !shown.has(id)),
  ];
  return (n === 9 ? walk.at(-1) : walk[n - 1]) ?? null;
}

const SELECT = /^desktop\.tabs\.select-(\d)$/;

/** The strip's or the panes' handler for `action`: whether one is
 *  mounted, and running it. `null` for any other action. */
function commandFor(action: DesktopActionId) {
  if (isStripCommand(action))
    return { mounted: hasStripCommands, run: () => runStripCommand(action) };
  if (isPaneCommand(action))
    return { mounted: hasPaneCommands, run: () => runPaneCommand(action) };
  return null;
}

/** A shortcut that is no step along the strip: the strip's commands,
 *  the panes', and choosing a tab by position. Handled here, or false.
 *  With nothing mounted to run it the key goes on; otherwise it is
 *  consumed, repeats too, and runs once. */
function runAuxiliaryAction(
  e: KeyEvent,
  action: DesktopActionId,
  deps: TabSwitchingDeps
): boolean {
  const ordinal = SELECT.exec(action)?.[1];
  if (ordinal !== undefined) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const id = presentedAt(presented, deps.tabIds(), Number(ordinal));
    if (id && !e.repeat) deps.activate(id);
    return true;
  }
  const command = commandFor(action);
  if (!command) return false;
  if (!command.mounted()) return true;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!e.repeat) command.run();
  return true;
}

function canHandleKey(e: KeyEvent, deps: TabSwitchingDeps): boolean {
  return (
    deps.enabled() &&
    !deps.recording() &&
    !inModal(e.target) &&
    !e.isComposing &&
    !stripDragging
  );
}

function onKeyDown(e: KeyEvent, deps: TabSwitchingDeps): void {
  if (!canHandleKey(e, deps)) return;
  const action = resolveDesktopAction(e, deps.bindings());
  if (!action || runAuxiliaryAction(e, action, deps)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const delta = STEP[action]!;
  if (!deps.byRecentUse() || !MRU_CAPABLE.has(action)) {
    const next = stepPresented(
      presented,
      deps.tabIds(),
      deps.activeId(),
      delta
    );
    if (next) deps.activate(next);
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
