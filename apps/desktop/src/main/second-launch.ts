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
import { isAbsolute, resolve } from 'node:path';
import { app, BrowserWindow } from 'electron';
import {
  offerLaunchRepo,
  releaseLaunchRepo,
} from '../host/services/launch-repo.js';
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
 * a first launch passes over too. A relative path is refused rather
 * than resolved against this process's working directory, which is not
 * the one the launch meant.
 */
export function requestedRepo(data: unknown): string | null {
  const startDir =
    typeof data === 'object' && data !== null
      ? (data as SecondLaunch).startDir
      : undefined;
  if (typeof startDir !== 'string' || !isAbsolute(startDir)) return null;
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
 * launch named a repository, `open` it if a page has claimed launches
 * (`services/launch-repo.ts`), or keep it for the next page that does.
 * Install before the first window is created.
 */
export function installSecondLaunch(open: (cwd: string) => void): void {
  app.on('browser-window-created', (_event, win) => {
    // The claim is the page's, so it ends when another document commits,
    // an error page replaces the page, or its renderer dies. Not when a
    // navigation starts: main's will-navigate may still refuse it, and
    // the page then carries on listening.
    const contents = win.webContents;
    contents.on('did-navigate', releaseLaunchRepo);
    contents.on('did-fail-load', (_e, _code, _text, _url, isMainFrame) => {
      if (isMainFrame) releaseLaunchRepo();
    });
    contents.on('render-process-gone', releaseLaunchRepo);
    win.on('closed', releaseLaunchRepo);
  });
  app.on('second-instance', (_event, _argv, _cwd, data) => {
    bringForward();
    const repo = requestedRepo(data);
    if (repo && offerLaunchRepo(repo)) open(repo);
  });
}
