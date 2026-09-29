import { homedir } from 'node:os';
import { BeamClient } from './client.js';
import type { OwnedDaemon } from './owned-daemon.js';
import { beamEnv, beamPaths } from './paths.js';

/** The app's beam client: it connects to the daemon at beam's own
 *  paths, or starts one there that it owns (decisions.md D15) through
 *  `spawn`, which only the main process can do. */
export function appBeamClient(
  spawn: (env: Record<string, string>) => OwnedDaemon
): BeamClient {
  const paths = beamPaths(process.env, homedir());
  return new BeamClient({
    socketPath: paths.socket,
    spawnDaemon: () => spawn(beamEnv(paths, process.env)),
    log: (message) => console.error(message),
  });
}
