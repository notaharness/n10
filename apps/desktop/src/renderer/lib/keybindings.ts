import { useSyncExternalStore } from 'react';
import {
  desktopBindings,
  type DesktopActionId,
  type DesktopBindings,
  type KeyDescriptor,
} from '@n10/core/ui';
import type { DesktopKeybindings } from '../../host/contract.js';

/**
 * Renderer mirror of the rebound desktop shortcuts (global config,
 * through the host). Read once when first used; until the answer
 * arrives — or if it never does — the defaults apply.
 */
let overrides: DesktopKeybindings = {};
let bindings: DesktopBindings = desktopBindings(undefined);
let requested = false;
/** While a settings row records a new chord, shortcuts stand aside so
 *  the chord reaches the recorder instead of switching tabs. */
let recording = false;
const listeners = new Set<() => void>();

function publish(next: DesktopKeybindings): void {
  overrides = next;
  bindings = desktopBindings(next);
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!requested) {
    requested = true;
    window.n10
      .getKeybindings()
      .then(publish)
      .catch(() => {
        // No repository open yet: keep the defaults and ask again on
        // the next subscriber.
        requested = false;
      });
  }
  return () => listeners.delete(cb);
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
  publish(await window.n10.setKeybinding(actionId, descriptors));
}

export function setRecordingShortcut(on: boolean): void {
  recording = on;
}

export function isRecordingShortcut(): boolean {
  return recording;
}
