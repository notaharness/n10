import {
  chmodSync,
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
  resetWorkspaceFileForTests,
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
  if (existsSync(dir())) chmodSync(dir(), 0o755);
  flushWorkspace();
  resetWorkspaceFileForTests();
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
      goneRepos: [],
    });
  });

  // A repository moved or deleted while n10 was closed: its item tabs
  // name a directory that is not there. Terminals are not repositories.
  it('names the repositories item tabs are of that are gone from disk', () => {
    const here = mkdtempSync(join(home, 'repo-'));
    const gone = join(home, 'moved-away');
    const tabs = {
      a: { kind: 'item', repo: here },
      b: { kind: 'item', repo: gone },
      c: { kind: 'item', repo: gone },
      d: { kind: 'terminal', repo: join(home, 'also-gone') },
      e: 'junk',
    };
    write(JSON.stringify({ version: WORKSPACE_VERSION, workspace: { tabs } }));
    const loaded = loadWorkspace();
    expect(loaded.status === 'restored' && loaded.goneRepos).toEqual([gone]);
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

describe('a file this run must not overwrite', () => {
  /** A save is refused, and the file is as it was. */
  async function refusesSaves(expected: () => void) {
    await expect(saveWorkspace({ a: 9 })).rejects.toThrow();
    flushWorkspace();
    expected();
  }

  it('is one that exists but cannot be read', async () => {
    mkdirSync(file(), { recursive: true });
    expect(loadWorkspace()).toEqual({ status: 'unreadable' });
    await refusesSaves(() => expect(readdirSync(file())).toEqual([]));
  });

  it('is an unreadable one that could not be set aside', async () => {
    write('{ not json');
    // A directory that cannot be written to: nothing moves out of it.
    chmodSync(dir(), 0o555);
    expect(loadWorkspace()).toEqual({ status: 'unreadable' });
    chmodSync(dir(), 0o755);
    await refusesSaves(() =>
      expect(readFileSync(file(), 'utf8')).toBe('{ not json')
    );
    expect(asideFiles()).toEqual([]);
  });

  // The window reloads in the same host; the read-only run ends with
  // its cause.
  it('is written to again once a later load reads it', async () => {
    mkdirSync(file(), { recursive: true });
    expect(loadWorkspace()).toEqual({ status: 'unreadable' });
    rmSync(file(), { recursive: true });
    write(JSON.stringify({ version: WORKSPACE_VERSION, workspace: { a: 1 } }));
    expect(loadWorkspace()).toMatchObject({ status: 'restored' });
    const saved = saveWorkspace({ a: 2 });
    flushWorkspace();
    await saved;
    expect(loadWorkspace()).toMatchObject({ workspace: { a: 2 } });
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
      goneRepos: [],
    });
  });

  it('writes what is waiting when the host shuts down', () => {
    void saveWorkspace({ a: 2 });
    flushWorkspace();
    expect(loadWorkspace()).toEqual({
      status: 'restored',
      workspace: { a: 2 },
      goneRepos: [],
    });
  });

  it('keeps the last good file, and says so, when a write fails', async () => {
    const saved = saveWorkspace({ a: 1 });
    flushWorkspace();
    await saved;
    // A directory that cannot be written to makes the write fail.
    chmodSync(dir(), 0o555);
    const failed = saveWorkspace({ a: 2 });
    flushWorkspace();
    await expect(failed).rejects.toThrow();
    chmodSync(dir(), 0o755);
    expect(readdirSync(dir())).toEqual(['workspace.json']);
    expect(loadWorkspace()).toEqual({
      status: 'restored',
      workspace: { a: 1 },
      goneRepos: [],
    });
  });

  it('removes its temporary file when the rename fails', async () => {
    // A non-empty directory in the file's place: the rename onto it fails.
    mkdirSync(join(file(), 'x'), { recursive: true });
    const failed = saveWorkspace({ a: 1 });
    flushWorkspace();
    await expect(failed).rejects.toThrow();
    expect(readdirSync(dir())).toEqual(['workspace.json']);
  });

  it('writes a save still waiting before a load reads the file', () => {
    void saveWorkspace({ a: 3 });
    expect(loadWorkspace()).toEqual({
      status: 'restored',
      workspace: { a: 3 },
      goneRepos: [],
    });
  });
});
