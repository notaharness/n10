/**
 * Starts one session host where `host-target.ts` says: a utility
 * process on this computer, or `n10 host --stdio` behind `wsl.exe` or
 * `ssh`. `host-process.ts` forks again through this after a host ends.
 */
import { join } from 'node:path';
import { app, utilityProcess } from 'electron';
import { hostEnv } from './host-env.js';
import { spawnPipeHost, utilityLink, type HostLink } from './host-link.js';
import { hostCommand, remoteStartDir, type HostTarget } from './host-target.js';
import type { HostHello } from './host-wire.js';

export interface ForkHostOptions {
  target: HostTarget;
  /** The directory the app was started for. */
  startDir?: string;
  /** The first host of this run. Only that one opens `startDir` behind
   *  a pipe; one started again opens what it remembers. */
  first: boolean;
  /** This app's version, which a host behind a pipe must run. */
  version: string;
  onHello: (hello: HostHello) => void;
}

export function forkHost(options: ForkHostOptions): HostLink {
  const { target } = options;
  return target.kind === 'local'
    ? forkLocal(options.startDir)
    : startPipe(target, options);
}

function forkLocal(startDir: string | undefined): HostLink {
  return utilityLink(
    utilityProcess.fork(join(import.meta.dirname, 'host-worker.js'), [], {
      serviceName: 'n10 host',
      stdio: 'inherit',
      env: hostEnv(
        {
          ...process.env,
          N10_UPDATE_ROOT: app.getAppPath(),
          N10_UPDATE_PACKAGED: app.isPackaged ? '1' : '0',
        },
        app.getPath('userData'),
        startDir
      ),
    })
  );
}

function startPipe(
  target: Exclude<HostTarget, { kind: 'local' }>,
  options: ForkHostOptions
): HostLink {
  const start = options.first
    ? remoteStartDir(target, options.startDir)
    : undefined;
  return spawnPipeHost({
    target,
    frontendVersion: options.version,
    onHello: options.onHello,
    ...hostCommand(target, {
      startDir: start?.path,
      startDistro: start?.distro,
      command: process.env.N10_HOST_COMMAND,
    }),
  });
}
