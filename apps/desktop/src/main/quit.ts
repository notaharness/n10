import { writeFileSync } from 'node:fs';
import type { NpmUpdatePlan } from '@n10/engine/contract';
import { app } from 'electron';
import type { HostProcess } from './host-process.js';

let pendingUpdate: NpmUpdatePlan | null = null;
export function cancelUpdateQuit() {
  pendingUpdate = null;
}
export async function quitForNpmUpdate(plan: NpmUpdatePlan): Promise<void> {
  if (!process.env.N10_UPDATE_HANDOFF)
    throw new Error(
      'Open n10 through its npm launcher to update automatically.'
    );
  pendingUpdate = plan;
  setImmediate(() => app.quit());
}

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
    let code = 0;
    if (pendingUpdate && process.env.N10_UPDATE_HANDOFF) {
      try {
        writeFileSync(
          process.env.N10_UPDATE_HANDOFF,
          JSON.stringify(pendingUpdate),
          { mode: 0o600 }
        );
        code = 42;
      } catch (error) {
        console.error('[desktop] update handoff', error);
        code = 1;
      }
    }
    (getHost()?.stop() ?? Promise.resolve())
      .catch((err: unknown) => {
        console.error('[desktop] host stop', err);
        code = 1;
      })
      .finally(() => app.exit(code));
  });
}
