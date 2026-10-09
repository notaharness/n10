import { app } from 'electron';
import type { HostProcess } from './host-process.js';

export async function quitForUpdate(): Promise<void> {
  setImmediate(() => app.quit());
}

export function installQuitHandler(getHost: () => HostProcess | null) {
  // The host releases its terminal clients (the tmux-hosted processes
  // survive app exit) and stops the beam daemon the app started (D15).
  // `app.exit`, because an `app.quit` from here can land inside this quit
  // and be ignored.
  let quitting = false;
  app.on('will-quit', (event) => {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    // A relaunch while this one waits on the host must win, not quit into it.
    app.releaseSingleInstanceLock();
    (getHost()?.stop() ?? Promise.resolve())
      .catch((err: unknown) => console.error('[desktop] host stop', err))
      .finally(() => app.exit());
  });
}
