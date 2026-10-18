/**
 * Opening a web link in the user's browser, from either shell.
 *
 * Inside WSL the Linux opener, `xdg-open`, finds no browser unless the
 * distro has one installed or the user set one up, so a link goes to
 * Windows instead: through `wslview` when wslu is installed, else
 * through `explorer.exe`, which hands a URL to the Windows default
 * browser. Both receive the URL as one argument, never through a shell.
 * A `BROWSER` the user exported is their own choice and keeps `xdg-open`,
 * which honours it.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { wslEnvironment, type WslEnvironment } from './wsl.js';

const WINDOWS_OPENERS = ['wslview', 'explorer.exe'];

export interface OpenCommand {
  command: string;
  args: string[];
}

export interface OpenerContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  wsl: WslEnvironment | null;
  /** Whether `name` is an executable on the PATH. */
  onPath(name: string): boolean;
}

export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** How to open `url`, or null for anything but an http(s) link. */
export function urlOpenCommand(
  url: string,
  context: OpenerContext
): OpenCommand | null {
  if (!isWebUrl(url)) return null;
  if (context.platform === 'darwin') return { command: 'open', args: [url] };
  if (context.platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', url] };
  }
  return { command: windowsOpener(context) ?? 'xdg-open', args: [url] };
}

/** The Windows opener a link goes through from WSL, or null where the
 *  platform's own opener serves. */
export function windowsOpener(context: OpenerContext): string | null {
  if (!context.wsl?.interop || context.env['BROWSER']) return null;
  return WINDOWS_OPENERS.find((command) => context.onPath(command)) ?? null;
}

export function isOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (env['PATH'] ?? '').split(delimiter).some((dir) => {
    if (!dir) return false;
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export function nodeOpenerContext(): OpenerContext {
  return {
    platform: process.platform,
    env: process.env,
    wsl: process.platform === 'linux' ? wslEnvironment() : null,
    onPath: (name) => isOnPath(name),
  };
}

/**
 * Opens an http(s) URL, detached and fire-and-forget. Resolves once the
 * opener has started, or rejects when it could not be (none installed,
 * or not a web link); the browser's own success is not observable,
 * since `explorer.exe` exits non-zero even when it worked.
 */
export function openUrl(
  url: string,
  context: OpenerContext = nodeOpenerContext()
): Promise<void> {
  const open = urlOpenCommand(url, context);
  if (!open) return Promise.reject(new Error(`Refusing to open ${url}`));
  return new Promise((resolve, reject) => {
    const child = spawn(open.command, open.args, {
      env: context.env,
      stdio: 'ignore',
      detached: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
