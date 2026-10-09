/**
 * Electron main for the Windows viability probe: no window, one utility
 * process forked the way the desktop forks its session host
 * (`host-process.ts`). It records both process ids and, for the
 * `main-exit` scenario, quits on its own once the host is ready without
 * telling the host anything.
 */
import { app, utilityProcess } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const stateDir = process.env['N10_PROBE_DIR'];
const scenario = process.env['N10_PROBE_SCENARIO'];
if (!stateDir) throw new Error('N10_PROBE_DIR is not set');

void app.whenReady().then(() => {
  const host = utilityProcess.fork(
    join(import.meta.dirname, 'probe-host.mjs'),
    [],
    {
      serviceName: 'n10 host',
      stdio: 'inherit',
      env: { ...process.env },
    }
  );
  host.once('spawn', () =>
    writeFileSync(
      join(stateDir, 'processes.json'),
      JSON.stringify({ main: process.pid, host: host.pid })
    )
  );
  host.on('message', (message: { t?: string }) => {
    if (message.t === 'ready' && scenario === 'main-exit') app.exit(0);
  });
});

// No window ever opens; the probe lives until it is killed or exits.
app.on('window-all-closed', () => undefined);
