import { showTerminal } from '@n10/core';

/**
 * Which windows have a session's terminal on screen.
 *
 * A window watches a session for as long as it renders that session's
 * terminal, and only a watched session's output is sent to it: a
 * session nobody is looking at costs the renderer nothing, however
 * much it prints. Watching also holds core's `showTerminal`, which is
 * what keeps output the user watched from asking for their attention —
 * the same signal the TUI's terminal pane holds.
 *
 * A viewer is a window's `webContents` id. Counts are per viewer, so a
 * terminal mounted twice (StrictMode's replay, or two panes on one
 * session) stays watched until both let go, and a window that reloads
 * or closes is dropped whole (`dropViewer`) rather than trusted to
 * unwatch on its way out.
 */

export type Viewer = number;

interface Watch {
  count: number;
  release: () => void;
}

const watches = new Map<string, Map<Viewer, Watch>>();

export function watch(viewer: Viewer, name: string): void {
  let byViewer = watches.get(name);
  if (!byViewer) {
    byViewer = new Map();
    watches.set(name, byViewer);
  }
  const held = byViewer.get(viewer);
  if (held) held.count += 1;
  else byViewer.set(viewer, { count: 1, release: showTerminal(name) });
}

export function unwatch(viewer: Viewer, name: string): void {
  const byViewer = watches.get(name);
  const held = byViewer?.get(viewer);
  if (!byViewer || !held) return;
  held.count -= 1;
  if (held.count > 0) return;
  held.release();
  byViewer.delete(viewer);
  if (byViewer.size === 0) watches.delete(name);
}

/** Forget everything `viewer` watched: its page is gone or replaced. */
export function dropViewer(viewer: Viewer): void {
  for (const [name, byViewer] of watches) {
    const held = byViewer.get(viewer);
    if (!held) continue;
    held.release();
    byViewer.delete(viewer);
    if (byViewer.size === 0) watches.delete(name);
  }
}

export function viewersOf(name: string): Iterable<Viewer> {
  return watches.get(name)?.keys() ?? [];
}
