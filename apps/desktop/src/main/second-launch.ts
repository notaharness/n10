/**
 * A launch while n10 is already running. Electron's single-instance
 * lock quits the new process and hands the running one the
 * `additionalData` the new one asked for the lock with. The new process
 * resolves its start directory exactly as a first launch would and
 * sends it; the running instance opens that repository.
 *
 * `additionalData` rather than the `argv` the event also carries:
 * Chromium may reorder and extend that list, and it holds neither the
 * other process's environment (the npm launcher's `N10_START_DIR`) nor
 * whether a terminal started it.
 */
import { resolve } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { canonicalRepoPath, isGitRepo } from '../host/services/repo.js';

/** What a second launch sends the running instance. */
export interface SecondLaunch {
  /** Absolute: the running instance has a working directory of its own. */
  startDir?: string;
}

/** The lock's `additionalData` for a launch that resolved `startDir`. */
export function secondLaunchData(
  startDir: string | undefined,
  cwd: string = process.cwd()
): SecondLaunch {
  return startDir ? { startDir: resolve(cwd, startDir) } : {};
}

/**
 * The repository a second launch asks for, by its real path. Null when
 * it names none, or names a directory that is not a repository, which
 * a first launch passes over too.
 */
export function requestedRepo(data: unknown): string | null {
  const startDir =
    typeof data === 'object' && data !== null
      ? (data as SecondLaunch).startDir
      : undefined;
  if (typeof startDir !== 'string' || startDir === '') return null;
  const cwd = canonicalRepoPath(startDir);
  if (isGitRepo(cwd)) return cwd;
  console.warn(`[desktop] second launch: not a git repo: ${startDir}`);
  return null;
}

function bringForward(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

/**
 * Answer every later launch: bring the window forward and, when the
 * launch named a repository, `open` it. Install before the window is
 * created. A launch during startup waits for the window's first page
 * load, since there is no renderer to tell before then; of several
 * such launches, the last one wins.
 */
export function installSecondLaunch(open: (cwd: string) => void): void {
  let loaded = false;
  let waiting: string | null = null;
  app.once('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', () => {
      loaded = true;
      if (waiting) open(waiting);
      waiting = null;
    });
  });
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    bringForward();
    const repo = requestedRepo(data);
    if (!repo) return;
    if (loaded) open(repo);
    else waiting = repo;
  });
}
