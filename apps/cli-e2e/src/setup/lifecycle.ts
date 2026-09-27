import { errors, type Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { socketEnv } from './tmux.js';

export function fixtureTmux(homeDir: string, ...args: string[]): string {
  return execFileSync('tmux', args, {
    env: { ...socketEnv(homeDir), HOME: homeDir },
    encoding: 'utf8',
  }).trim();
}

/** Observe absence without swallowing browser, IPC or cleanup failures. */
export async function visibleWithin(
  locator: Locator,
  timeout = 15_000
): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch (error) {
    if (error instanceof errors.TimeoutError) return false;
    throw error;
  }
}
