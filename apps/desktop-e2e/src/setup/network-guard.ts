import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The fixture's half of `fixtures/network-guard.cjs`: where the guard
 * writes, whether it loaded, and what it refused.
 *
 * Every test runs guarded except one handed a real GitHub token
 * (`githubToken`), which is the @integration suite reaching GitHub on
 * purpose.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** The main process's preload; the fixture passes it to Electron as `-r`. */
export const NETWORK_GUARD_PRELOAD = join(
  HERE,
  '..',
  'fixtures',
  'network-guard.cjs'
);

/** The session host's preload (`N10_HOST_REQUIRE`): the guard, and the
 *  Azure DevOps fake when a test serves one. */
export const HOST_PRELOAD = join(HERE, '..', 'fixtures', 'host-preload.cjs');

/** `N10_NETWORK_GUARD`: the path the guard's files hang off. */
export function networkGuardBase(homeDir: string): string {
  return join(homeDir, 'network-guard');
}

/** The processes that must have the guard before a test may run:
 *  Electron's `process.type` for the main process and the host. */
const GUARDED = ['browser', 'utility'] as const;

/** The processes the guard is not in yet. The host is up before the
 *  first window opens. */
export function unguardedProcesses(homeDir: string): string[] {
  const base = networkGuardBase(homeDir);
  return GUARDED.filter((type) => !existsSync(`${base}.${type}.loaded`));
}

/** The connections refused so far, one line each — emptied, so a test
 *  that provokes one on purpose can take it and still pass. */
export function takeNetworkRefusals(homeDir: string): string[] {
  const log = `${networkGuardBase(homeDir)}.log`;
  if (!existsSync(log)) return [];
  const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  writeFileSync(log, '', 'utf8');
  return lines;
}
