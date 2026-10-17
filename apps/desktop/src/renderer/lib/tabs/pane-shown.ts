import { createContext, useContext } from 'react';

/**
 * Whether the pane a component sits in is the one on screen.
 *
 * The editor keeps one spare pane rendered and hidden, ready for a
 * switch (`EditorArea`). What it holds must not take focus, keys or
 * the user's attention while it waits: the pane is `inert`, and the
 * few things that act without an event on them — a terminal focusing
 * itself, keyboard shortcuts on `window`, a session counted as seen —
 * ask this. Outside the editor, everything is on screen.
 */
export const PaneShownContext = createContext(true);

export function usePaneShown(): boolean {
  return useContext(PaneShownContext);
}
