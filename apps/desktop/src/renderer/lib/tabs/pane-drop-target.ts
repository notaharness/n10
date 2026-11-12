import { useSyncExternalStore } from 'react';
import type { DropZone } from '../../components/editor/pane-drop.js';
import type { PaneId } from './workspace.js';

/**
 * The pane zone a tab drag is over right now, for the pane to draw its
 * highlight: one at a time, and none outside a drag. `allowed` is false
 * where the drop would do nothing or the pane has no room to split.
 */
export interface PaneDropTarget {
  pane: PaneId;
  zone: DropZone;
  allowed: boolean;
  /** Why not, when the user can do something about it. */
  hint?: string;
}

let current: PaneDropTarget | null = null;
const listeners = new Set<() => void>();

const keyOf = (t: PaneDropTarget | null) =>
  t ? `${t.pane}\n${t.zone}\n${t.allowed}\n${t.hint ?? ''}` : '';

export function setPaneDropTarget(next: PaneDropTarget | null): void {
  if (keyOf(next) === keyOf(current)) return;
  current = next;
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** The target, if it is in `pane`. */
export function usePaneDropTarget(pane: PaneId): PaneDropTarget | null {
  return useSyncExternalStore(subscribe, () =>
    current?.pane === pane ? current : null
  );
}
