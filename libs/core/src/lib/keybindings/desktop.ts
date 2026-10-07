import type { KeyPress } from '../input/key-press.js';
import { keyDescriptorToString } from './hints.js';
import type { KeyDescriptor } from './registry.js';
import { descriptorFromKeypress, matchesKey } from './resolver.js';

/**
 * The desktop's rebindable shortcuts. They share the TUI's descriptor
 * shape, resolver and persisted `keybindOverrides` (global config), but
 * not its presets or input contexts: the desktop has one binding set,
 * active wherever focus is, and its ids are namespaced `desktop.` so
 * the TUI's catalog never resolves them.
 */
export type DesktopActionId =
  | 'desktop.tabs.next'
  | 'desktop.tabs.previous'
  | 'desktop.tabs.cycle-next'
  | 'desktop.tabs.cycle-previous';

export const DESKTOP_ACTIONS: readonly {
  id: DesktopActionId;
  label: string;
  description: string;
}[] = [
  {
    id: 'desktop.tabs.next',
    label: 'Next tab',
    description: 'Along the tab strip, wrapping at the end.',
  },
  {
    id: 'desktop.tabs.previous',
    label: 'Previous tab',
    description: 'Along the tab strip, wrapping at the start.',
  },
  {
    id: 'desktop.tabs.cycle-next',
    label: 'Cycle tabs',
    description: 'Along the strip, or by recent use when that is on.',
  },
  {
    id: 'desktop.tabs.cycle-previous',
    label: 'Cycle tabs backwards',
    description: 'Along the strip, or by recent use when that is on.',
  },
];

export type DesktopBindings = Record<DesktopActionId, KeyDescriptor[]>;

export const DESKTOP_DEFAULT_BINDINGS: DesktopBindings = {
  'desktop.tabs.next': [{ ctrl: true, flags: { pageDown: true } }],
  'desktop.tabs.previous': [{ ctrl: true, flags: { pageUp: true } }],
  'desktop.tabs.cycle-next': [{ ctrl: true, flags: { tab: true } }],
  'desktop.tabs.cycle-previous': [
    { ctrl: true, shift: true, flags: { tab: true } },
  ],
};

export function isDesktopActionId(id: string): id is DesktopActionId {
  return DESKTOP_ACTIONS.some((action) => action.id === id);
}

/** The structural subset of a DOM `KeyboardEvent` the desktop reads. */
export interface DomKey {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

const DOM_FLAGS: Record<string, keyof KeyPress> = {
  ArrowUp: 'upArrow',
  ArrowDown: 'downArrow',
  ArrowLeft: 'leftArrow',
  ArrowRight: 'rightArrow',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
  Home: 'home',
  End: 'end',
  Enter: 'return',
  Escape: 'escape',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
};

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph']);

/**
 * A DOM key event in the TUI's terms. Alt is `meta`, as Ink reports it
 * and as the hints print it; the platform key (Cmd, Win) is `super`,
 * which no descriptor can ask for.
 */
function keyPressFromDom(event: DomKey): {
  input: string;
  key: KeyPress;
} {
  const flag = DOM_FLAGS[event.key];
  const key: KeyPress = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    tab: false,
    backspace: false,
    delete: false,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    meta: event.altKey,
    super: event.metaKey,
  };
  if (flag) (key as unknown as Record<string, boolean>)[flag] = true;
  return { input: event.key.length === 1 ? event.key : '', key };
}

/** The desktop action this key event fires, if any. */
export function resolveDesktopAction(
  event: DomKey,
  bindings: DesktopBindings
): DesktopActionId | null {
  // Descriptors cannot ask for Cmd/Win, so a press holding it is the
  // platform's or another shortcut's, never one of these.
  if (event.metaKey) return null;
  const { input, key } = keyPressFromDom(event);
  const hit = DESKTOP_ACTIONS.find((action) =>
    bindings[action.id].some((desc) => matchesKey(desc, input, key))
  );
  return hit?.id ?? null;
}

/**
 * The binding a pressed chord would record, or null while only
 * modifiers are down (the user is still building the chord) or the
 * platform key is held.
 */
export function descriptorFromDom(event: DomKey): KeyDescriptor | null {
  if (MODIFIER_KEYS.has(event.key) || event.metaKey) return null;
  const { input, key } = keyPressFromDom(event);
  return descriptorFromKeypress(input, key);
}

/** Another desktop action already bound to `descriptor`, if any. */
export function desktopConflict(
  bindings: DesktopBindings,
  actionId: DesktopActionId,
  descriptor: KeyDescriptor
): DesktopActionId | null {
  const label = keyDescriptorToString(descriptor);
  const hit = DESKTOP_ACTIONS.find(
    (action) =>
      action.id !== actionId &&
      bindings[action.id].some((d) => keyDescriptorToString(d) === label)
  );
  return hit?.id ?? null;
}

/** A chord the app keeps for itself, by the name it shows. */
export interface ReservedChord {
  label: string;
  descriptor: KeyDescriptor;
}

/**
 * Why `descriptor` cannot be recorded for `actionId`, in words for the
 * user, or null when it can. A tab shortcut is heard wherever focus is
 * and stopped there, so it needs Ctrl or Alt — a bare key or Shift
 * chord would be taken from every text box and terminal — and must not
 * take over one of the app's own (`reserved`) or another tab action's.
 */
export function desktopBindingRefusal(
  bindings: DesktopBindings,
  actionId: DesktopActionId,
  descriptor: KeyDescriptor,
  reserved: readonly ReservedChord[] = []
): string | null {
  const chord = keyDescriptorToString(descriptor);
  if (!descriptor.ctrl && !descriptor.meta) {
    return `${chord} needs Ctrl or Alt: without one it would be taken from typing`;
  }
  const app = reserved.find(
    (r) => keyDescriptorToString(r.descriptor) === chord
  );
  if (app) return `${chord} is already “${app.label}”`;
  const other = desktopConflict(bindings, actionId, descriptor);
  const label = DESKTOP_ACTIONS.find((a) => a.id === other)?.label;
  return label ? `${chord} is already “${label}”` : null;
}

function isDescriptor(value: unknown): value is KeyDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const desc = value as Record<string, unknown>;
  if (desc.input !== undefined && typeof desc.input !== 'string') return false;
  if (desc.flags !== undefined && typeof desc.flags !== 'object') return false;
  return true;
}

/**
 * The desktop's slice of the persisted overrides: its own ids only,
 * each a list of well-formed descriptors. Anything else — the TUI's
 * ids, a hand-edited value of the wrong shape — is left out.
 */
export function desktopOverrides(
  overrides: Record<string, unknown> | undefined
): Partial<DesktopBindings> {
  const result: Partial<DesktopBindings> = {};
  for (const [id, value] of Object.entries(overrides ?? {})) {
    if (!isDesktopActionId(id) || !Array.isArray(value)) continue;
    if (value.every(isDescriptor)) result[id] = value;
  }
  return result;
}

/** Defaults with the user's overrides laid over them. */
export function desktopBindings(
  overrides: Record<string, unknown> | undefined
): DesktopBindings {
  return { ...DESKTOP_DEFAULT_BINDINGS, ...desktopOverrides(overrides) };
}
