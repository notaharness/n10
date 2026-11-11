import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
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
 * matters — and written whole through a temporary file and a rename, so
 * a crash mid-write leaves the previous file. A file that does not
 * parse, or carries a version this build does not know, is set aside
 * under a dated name rather than overwritten, and the workspace starts
 * empty.
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

/** The saved workspace, or why there is none to restore. */
export function loadWorkspace(): LoadedWorkspace {
  const path = workspacePath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { status: 'none' };
  }
  const workspace = readable(raw);
  if (workspace !== null) return { status: 'restored', workspace };
  return { status: 'set-aside', path: setAside(path) ?? path };
}

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

let pending: SavedWorkspace | null = null;
let waiters: Waiter[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function write(workspace: SavedWorkspace): void {
  const path = workspacePath();
  const dir = join(path, '..');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file: WorkspaceFile = { version: WORKSPACE_VERSION, workspace };
  writeFileSync(`${path}.tmp`, JSON.stringify(file), 'utf8');
  renameSync(`${path}.tmp`, path);
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
 *  Settles once the write it ends up in has landed, or failed. */
export function saveWorkspace(workspace: SavedWorkspace): Promise<void> {
  pending = workspace;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushWorkspace, DEBOUNCE_MS);
  return new Promise((resolve, reject) => {
    waiters.push({ resolve, reject });
  });
}
