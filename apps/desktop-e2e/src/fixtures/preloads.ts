import type { ElectronApplication } from '@playwright/test';
import { closeDesktopApp } from '../setup/app-close.js';
import { fakeAdoLoaded, forgetFakeAdo } from '../setup/fake-ado.js';
import {
  forgetNetworkGuard,
  unguardedProcesses,
} from '../setup/network-guard.js';

/**
 * The preloads the fixture launches the app with, as the fixture checks
 * them: each writes a marker once it is in place, and a test runs only
 * once every one it needs has.
 */

/** Remove what each preload writes once it is in place. */
export function forgetPreloads(homeDir: string): void {
  forgetNetworkGuard(homeDir);
  forgetFakeAdo(homeDir);
}

/** The preloads a test needs that are not in place. */
export function missingPreloads(
  homeDir: string,
  wanted: { ado: boolean; guard: boolean }
): string[] {
  const missing = wanted.guard
    ? unguardedProcesses(homeDir).map((type) => `the network guard (${type})`)
    : [];
  if (wanted.ado && !fakeAdoLoaded(homeDir)) {
    missing.push('the Azure DevOps fake');
  }
  return missing;
}

/** Stop unless every preload the test needs loaded. The Azure DevOps
 *  fake writes the token, so without it the app has no credentials and
 *  has asked Azure nothing; the network guard refuses what gets past
 *  the fakes. A run without either is stopped all the same. */
export async function requirePreloads(
  app: ElectronApplication,
  missing: string[],
  cleanup?: () => void
): Promise<void> {
  if (missing.length === 0) return;
  await closeDesktopApp(app);
  cleanup?.();
  throw new Error(`Did not load: ${missing.join(', ')}`);
}
