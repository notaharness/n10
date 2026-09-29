import { showTerminal } from '@n10/core';

/**
 * Which windows hold a session's terminal, and which have it on screen.
 *
 * A window watches a session for as long as it holds a terminal for
 * it, and only a watched session's output is sent to it: a session
 * nobody holds a terminal for costs the renderer nothing, however much
 * it prints. A terminal can be held off screen, made ready ahead of a
 * switch, so being on screen is counted apart: `show` holds core's
 * `showTerminal`, which is what keeps output the user watched from
 * asking for their attention — the same signal the TUI's terminal pane
 * holds.
 *
 * A viewer is a window's `webContents` id. Counts are per viewer, so a
 * terminal mounted twice (StrictMode's replay, or two panes on one
 * session) stays counted until both let go, and a window that reloads
 * or closes is dropped whole (`dropViewer`) rather than trusted to let
 * go on its way out.
 */

export type Viewer = number;

interface Hold {
  count: number;
  release: () => void;
}

type Holds = Map<string, Map<Viewer, Hold>>;

const watches: Holds = new Map();
const onScreen: Holds = new Map();

function take(
  holds: Holds,
  viewer: Viewer,
  name: string,
  start: () => () => void
) {
  let byViewer = holds.get(name);
  if (!byViewer) {
    byViewer = new Map();
    holds.set(name, byViewer);
  }
  const held = byViewer.get(viewer);
  if (held) held.count += 1;
  else byViewer.set(viewer, { count: 1, release: start() });
}

function give(holds: Holds, viewer: Viewer, name: string): void {
  const byViewer = holds.get(name);
  const held = byViewer?.get(viewer);
  if (!byViewer || !held) return;
  held.count -= 1;
  if (held.count > 0) return;
  held.release();
  byViewer.delete(viewer);
  if (byViewer.size === 0) holds.delete(name);
}

const nothing = () => () => undefined;

export function watch(viewer: Viewer, name: string): void {
  take(watches, viewer, name, nothing);
}

export function unwatch(viewer: Viewer, name: string): void {
  give(watches, viewer, name);
}

export function show(viewer: Viewer, name: string): void {
  take(onScreen, viewer, name, () => showTerminal(name));
}

export function hide(viewer: Viewer, name: string): void {
  give(onScreen, viewer, name);
}

/** Forget everything `viewer` held: its page is gone or replaced. */
export function dropViewer(viewer: Viewer): void {
  for (const holds of [watches, onScreen]) {
    for (const [name, byViewer] of holds) {
      const held = byViewer.get(viewer);
      if (!held) continue;
      held.release();
      byViewer.delete(viewer);
      if (byViewer.size === 0) holds.delete(name);
    }
  }
}

export function viewersOf(name: string): Iterable<Viewer> {
  return watches.get(name)?.keys() ?? [];
}
