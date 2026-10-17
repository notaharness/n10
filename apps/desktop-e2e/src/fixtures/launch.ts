import type { ElectronApplication } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDesktopApp } from '../setup/app-close.js';
import { fakeAdoLoaded, forgetFakeAdo } from '../setup/fake-ado.js';
import {
  NETWORK_GUARD_PRELOAD,
  forgetNetworkGuard,
  unguardedProcesses,
} from '../setup/network-guard.js';

/**
 * How the fixture launches the app: its command line, and the preloads
 * it launches with, as the fixture checks them. Each preload writes a
 * marker once it is in place, and a test runs only once every one it
 * needs has.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/desktop — Electron resolves `main` from its package.json. */
const APP_DIR = resolve(HERE, '..', '..', '..', 'desktop');
export const WORKSPACE_ROOT = resolve(APP_DIR, '..', '..');

/** Electron's arguments. The network guard goes first, before any of
 *  the app's code. */
export function launchArgs(guarded: boolean, webgl?: boolean): string[] {
  return [
    ...(guarded ? ['-r', NETWORK_GUARD_PRELOAD] : []),
    APP_DIR,
    // CI runners have no user namespaces for the sandbox, and
    // software rendering is both available and deterministic.
    '--no-sandbox',
    '--disable-gpu',
    '--ozone-platform=x11',
    // WebGL with no GPU, which Chromium allows only when asked.
    ...(webgl ? ['--enable-unsafe-swiftshader'] : []),
  ];
}

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
