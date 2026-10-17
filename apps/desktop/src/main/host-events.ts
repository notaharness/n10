/**
 * How a host push reaches the windows, and the window lifecycle the
 * host needs to hear about. Every window-broadcast in the app goes
 * through here.
 */
import { app, BrowserWindow, webContents } from 'electron';
import type { HostPushes } from '../host/host-pushes.js';
import type { Viewer } from '../host/services/session-watch.js';

// A window whose renderer died has no frame to deliver to, and stays
// that way while the app asks what to do (renderer-recovery.ts): a
// send would log a stack, and the PTY relay sends per chunk.
function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    const contents = win.webContents;
    if (contents.isDestroyed() || contents.isCrashed()) continue;
    contents.send(channel, payload);
  }
}

function sendTo(viewer: Viewer, channel: string, payload: unknown): void {
  const contents = webContents.fromId(viewer);
  if (!contents || contents.isDestroyed() || contents.isCrashed()) return;
  contents.send(channel, payload);
}

export const windowPushes: HostPushes = { broadcast, sendTo };

/** A window's watches end with the page that made them: closing it,
 *  reloading it (the renderer-crash recovery does) or losing its
 *  renderer. The next page watches again as its terminals mount. A
 *  navigation counts once committed: `main.ts` cancels the ones that
 *  would leave the app, and the page stays. */
export function onPageGone(drop: (viewer: Viewer) => void): void {
  app.on('web-contents-created', (_event, contents) => {
    const viewer = contents.id;
    const gone = () => drop(viewer);
    contents.on('destroyed', gone);
    contents.on('render-process-gone', gone);
    contents.on('did-navigate', gone);
  });
}
