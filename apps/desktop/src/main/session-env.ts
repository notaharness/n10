import { homedir } from 'node:os';
import { join } from 'node:path';
import { setLocalSessionEnv } from '@n10/core';
import { beamBinary, beamEnv, beamPaths } from './beam/paths.js';
import { writeSessionBin } from './session-bin.js';

/** Puts `beam` and `n10` first on every local session's PATH, from a
 *  directory under `userData` (`session-bin.ts`), and gives sessions
 *  the beam paths the app uses. Without the directory, sessions keep
 *  the PATH they would have had. */
export function installSessionBin(userData: string): void {
  const dir = join(userData, 'bin');
  let beam: string | undefined;
  try {
    beam = beamBinary();
  } catch (err) {
    console.error('[desktop] no beam binary for this platform', err);
  }
  let pathDirs: string[] = [];
  try {
    writeSessionBin(dir, {
      runtime: process.execPath,
      shim: join(import.meta.dirname, 'n10-shim.js'),
      beam,
    });
    pathDirs = [dir];
  } catch (err) {
    console.error('[desktop] session bin', err);
  }
  setLocalSessionEnv({
    pathDirs,
    env: beamEnv(beamPaths(process.env, homedir()), process.env),
  });
}
