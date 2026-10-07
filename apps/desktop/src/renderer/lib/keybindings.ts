import { useSyncExternalStore } from 'react';
import {
  desktopBindings,
  keyDescriptorToString,
  type DesktopActionId,
  type DesktopBindings,
  type KeyDescriptor,
  type ReservedChord,
} from '@n10/core/ui';
import {
  APP_SHORTCUTS,
  appShortcutDescriptor,
} from '../../host/app-shortcuts.js';
import type { DesktopKeybindings } from '../../host/contract.js';

/**
 * Renderer mirror of the rebound desktop shortcuts (global config,
 * through the host). Read when first used and again whenever the
 * window comes back to the front, since another n10 — the TUI, a
 * second window — or a hand edit may have changed the file meanwhile.
 * Until an answer arrives, or if none does, the defaults apply.
 */
let overrides: DesktopKeybindings = {};
let bindings: DesktopBindings = desktopBindings(undefined);
let watching = false;
/** Bumped by every write and every read begun: a read only lands if
 *  nothing newer has been begun or written since it started. */
let generation = 0;
/** While a settings row records a new chord, shortcuts stand aside so
 *  the chord reaches the recorder instead of switching tabs. */
let recording = false;
const listeners = new Set<() => void>();

function publish(next: DesktopKeybindings): void {
  overrides = next;
  bindings = desktopBindings(next);
  for (const l of listeners) l();
}

/** Read the shortcuts from the host again. A failed read (no
 *  repository open yet) keeps what is shown. */
export function refreshDesktopBindings(): void {
  const started = ++generation;
  window.n10.getKeybindings().then(
    (next) => {
      if (started === generation) publish(next);
    },
    () => undefined
  );
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!watching) {
    watching = true;
    refreshDesktopBindings();
    window.addEventListener('focus', refreshDesktopBindings);
  }
  return () => listeners.delete(cb);
}

/** The shortcuts as they stand, outside React. */
export function currentDesktopBindings(): DesktopBindings {
  return bindings;
}

export function useDesktopBindings(): DesktopBindings {
  return useSyncExternalStore(subscribe, () => bindings);
}

/** The rebound shortcuts alone, for marking a row as customised. */
export function useKeybindingOverrides(): DesktopKeybindings {
  return useSyncExternalStore(subscribe, () => overrides);
}

/** Rebind `actionId`, or with null restore its default. */
export async function setDesktopBinding(
  actionId: DesktopActionId,
  descriptors: KeyDescriptor[] | null
): Promise<void> {
  const written = ++generation;
  const next = await window.n10.setKeybinding(actionId, descriptors);
  if (written === generation) publish(next);
}

/** Recording a chord: tab shortcuts stand aside here, and the native
 *  menu's accelerators in the main process, so Ctrl+W reaches the
 *  recorder (to be refused) rather than closing the tab. */
export function setRecordingShortcut(on: boolean): void {
  if (recording === on) return;
  recording = on;
  window.n10.holdMenuShortcuts(on).catch(() => {
    // Best effort: with the host restarting the menu keeps its
    // accelerators, and the recorder still refuses those chords.
  });
}

export function isRecordingShortcut(): boolean {
  return recording;
}

/** A chord as the keys to show, one per key cap: modifiers first, Shift
 *  as ⇧. Built from the descriptor, not by splitting its text, so a
 *  chord on the + key shows a + cap. */
export function chordKeys(d: KeyDescriptor): string[] {
  const upper = d.input !== undefined && /^[A-Z]$/.test(d.input);
  const key: KeyDescriptor = {};
  if (d.flags) key.flags = d.flags;
  if (d.input !== undefined) key.input = d.input.toLowerCase();
  return [
    ...(d.ctrl ? ['Ctrl'] : []),
    ...(d.shift || upper ? ['⇧'] : []),
    ...(d.meta ? ['Alt'] : []),
    keyDescriptorToString(key),
  ];
}

/** The app's own shortcuts, as chords a tab shortcut may not take. */
export const RESERVED_CHORDS: readonly ReservedChord[] = APP_SHORTCUTS.map(
  (s) => ({ label: s.label, descriptor: appShortcutDescriptor(s) })
);
