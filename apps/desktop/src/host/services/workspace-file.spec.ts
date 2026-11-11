import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  flushWorkspace,
  loadWorkspace,
  saveWorkspace,
  WORKSPACE_VERSION,
} from './workspace-file.js';

/**
 * The workspace file under a scratch HOME: what a launch restores, what
 * a save writes, and what happens to a file this build cannot read —
 * set aside, never overwritten, and the workspace starts empty.
 */

let home: string;
let originalHome: string | undefined;

const dir = () => join(home, '.n10');
const file = () => join(dir(), 'workspace.json');
const write = (contents: string) => {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(file(), contents, 'utf8');
};
const asideFiles = () =>
  readdirSync(dir()).filter((f) => f.startsWith('workspace.json.unreadable-'));

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'n10-workspace-'));
  process.env.HOME = home;
});

afterEach(() => {
  flushWorkspace();
  vi.useRealTimers();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('loadWorkspace', () => {
  it('has nothing to restore before anything was saved', () => {
    expect(loadWorkspace()).toEqual({ status: 'none' });
  });

  it('restores what was saved', () => {
    write(
      JSON.stringify({ version: WORKSPACE_VERSION, workspace: { pinned: [] } })
    );
    expect(loadWorkspace()).toEqual({
      status: 'restored',
      workspace: { pinned: [] },
    });
  });

  it.each([
    ['a file that does not parse', '{ not json'],
    [
      'a version it does not know',
      JSON.stringify({ version: 99, workspace: {} }),
    ],
    ['a file with no workspace in it', JSON.stringify({ version: 1 })],
  ])('sets aside %s, keeping it, and starts empty', (_what, contents) => {
    write(contents);
    const loaded = loadWorkspace();
    expect(loaded.status).toBe('set-aside');
    expect(existsSync(file())).toBe(false);
    const [aside] = asideFiles();
    expect(readFileSync(join(dir(), aside), 'utf8')).toBe(contents);
    expect(loaded.status === 'set-aside' && loaded.path).toBe(
      join(dir(), aside)
    );
  });
});

describe('saveWorkspace', () => {
  it('writes the latest of a burst once, versioned, after a pause', async () => {
    vi.useFakeTimers();
    const done = [
      saveWorkspace({ pinned: ['a'] }),
      saveWorkspace({ pinned: ['b'] }),
    ];
    expect(existsSync(file())).toBe(false);
    await vi.runAllTimersAsync();
    await Promise.all(done);
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({
      version: WORKSPACE_VERSION,
      workspace: { pinned: ['b'] },
    });
  });

  it('writes whole, through a temporary file, leaving none behind', async () => {
    const saved = saveWorkspace({ a: 1 });
    flushWorkspace();
    await saved;
    expect(readdirSync(dir())).toEqual(['workspace.json']);
    expect(loadWorkspace()).toEqual({
      status: 'restored',
      workspace: { a: 1 },
    });
  });

  it('writes what is waiting when the host shuts down', () => {
    void saveWorkspace({ a: 2 });
    flushWorkspace();
    expect(loadWorkspace()).toEqual({
      status: 'restored',
      workspace: { a: 2 },
    });
  });

  it('keeps the last good file, and says so, when a write fails', async () => {
    const saved = saveWorkspace({ a: 1 });
    flushWorkspace();
    await saved;
    // A directory where the temporary file goes makes the write fail.
    mkdirSync(`${file()}.tmp`);
    const failed = saveWorkspace({ a: 2 });
    flushWorkspace();
    await expect(failed).rejects.toThrow();
    rmSync(`${file()}.tmp`, { recursive: true });
    expect(loadWorkspace()).toEqual({
      status: 'restored',
      workspace: { a: 1 },
    });
  });
});
