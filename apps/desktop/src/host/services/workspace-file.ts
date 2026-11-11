import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LoadedWorkspace, SavedWorkspace } from '../contract.js';

/**
 * The tab workspace, kept in ~/.n10/workspace.json beside the desktop
 * prefs, so a dev build and the installed app share it as they share
 * those. The host versions and stores it; the renderer owns its shape
 * and checks every field on restore.
 *
 * Saves are debounced — the renderer sends one on every change that
 * matters — and written whole: to a temporary file of this write's own,
 * synced, then renamed over the file, so a crash or a power cut
 * mid-write leaves the previous file, and two instances writing at once
 * never share a temporary file. Between two running instances the last
 * writer wins the whole file; there is no lock.
 *
 * A file that does not parse, or carries a version this build does not
 * know, is set aside under a dated name rather than overwritten, and the
 * workspace starts empty. A file that cannot be read, or set aside,
 * makes this run read-only: every save is refused, so the file is left
 * for a person to look at.
 */

export const WORKSPACE_VERSION = 1;
const DEBOUNCE_MS = 400;

interface WorkspaceFile {
  version: number;
  workspace: SavedWorkspace;
}

function workspacePath(): string {
  return join(homedir(), '.n10', 'workspace.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readable(raw: string): SavedWorkspace | null {
  try {
    const file: unknown = JSON.parse(raw);
    if (!isRecord(file) || file.version !== WORKSPACE_VERSION) return null;
    return isRecord(file.workspace) ? file.workspace : null;
  } catch {
    return null;
  }
}

/**
 * The repositories the saved item tabs name that are no longer on disk.
 * Their tabs cannot open, and a repository moved while n10 was closed
 * gets a live tab under its new path; so the renderer drops them. An
 * item tab is a checkout on this machine, so a missing directory says
 * the repository went, unlike an offline machine's. Only `kind` and
 * `repo` of each tab are read; the renderer checks the rest.
 */
function goneRepos(workspace: SavedWorkspace): string[] {
  const tabs = isRecord(workspace.tabs) ? Object.values(workspace.tabs) : [];
  const repos = new Set(
    tabs.flatMap((t) =>
      isRecord(t) && t.kind === 'item' && typeof t.repo === 'string'
        ? [t.repo]
        : []
    )
  );
  return [...repos].filter((repo) => !existsSync(repo));
}

/** Set once a file was found that this run must not overwrite. */
let readOnly = false;

/** Move an unreadable file out of the way, keeping it for a person to
 *  look at. Where it went, or `null` if it could not be moved. */
function setAside(path: string): string | null {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const aside = `${path}.unreadable-${stamp}`;
  try {
    renameSync(path, aside);
    return aside;
  } catch (error) {
    console.error('[host] workspace set-aside', error);
    return null;
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** The saved workspace, or why there is none to restore. A save still
 *  waiting out its debounce lands first, so a reload reads it. */
export function loadWorkspace(): LoadedWorkspace {
  flushWorkspace();
  const path = workspacePath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return { status: 'none' };
    console.error('[host] workspace read', error);
    readOnly = true;
    return { status: 'unreadable' };
  }
  const workspace = readable(raw);
  if (workspace !== null)
    return { status: 'restored', workspace, goneRepos: goneRepos(workspace) };
  const aside = setAside(path);
  if (aside !== null) return { status: 'set-aside', path: aside };
  readOnly = true;
  return { status: 'unreadable' };
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

let pending: SavedWorkspace | null = null;
let waiters: Waiter[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Write `contents` to `path` through a synced temporary file of this
 *  write's own; a failure removes it and leaves `path` as it was. */
function writeWhole(path: string, contents: string): void {
  const temp = `${path}.${process.pid}.${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}.tmp`;
  try {
    const fd = openSync(temp, 'wx');
    try {
      writeSync(fd, contents);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function write(workspace: SavedWorkspace): void {
  const path = workspacePath();
  mkdirSync(join(path, '..'), { recursive: true });
  const file: WorkspaceFile = { version: WORKSPACE_VERSION, workspace };
  writeWhole(path, JSON.stringify(file));
}

/** Write the latest save now, if one is waiting, and settle every save
 *  it stands for. A failed write leaves the file as it was. */
export function flushWorkspace(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const workspace = pending;
  const settled = waiters;
  pending = null;
  waiters = [];
  if (workspace === null) return;
  try {
    write(workspace);
    for (const w of settled) w.resolve();
  } catch (error) {
    console.error('[host] workspace save', error);
    for (const w of settled) w.reject(error);
  }
}

/** Save `workspace` shortly; a later save before then replaces it.
 *  Settles once the write it ends up in has landed, or failed. Refused
 *  outright in a read-only run. */
export function saveWorkspace(workspace: SavedWorkspace): Promise<void> {
  if (readOnly) {
    return Promise.reject(
      new Error('The workspace file could not be read; it is left as it is.')
    );
  }
  pending = workspace;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushWorkspace, DEBOUNCE_MS);
  return new Promise((resolve, reject) => {
    waiters.push({ resolve, reject });
  });
}

/** Tests only: forget a read-only run. */
export function resetWorkspaceFileForTests(): void {
  readOnly = false;
}
