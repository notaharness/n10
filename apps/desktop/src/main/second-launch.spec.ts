import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const app = new EventEmitter();
const windows: FakeWindow[] = [];
vi.mock('electron', () => ({
  app,
  BrowserWindow: { getAllWindows: () => windows },
}));

const { installSecondLaunch, requestedRepo, secondLaunchData } = await import(
  './second-launch.js'
);
const { claimLaunchRepo, releaseLaunchRepo } = await import(
  '../host/services/launch-repo.js'
);

class FakeWindow extends EventEmitter {
  webContents = new EventEmitter();
  minimized = false;
  isMinimized = () => this.minimized;
  restore = vi.fn(() => {
    this.minimized = false;
  });
  focus = vi.fn();
}

const root = mkdtempSync(join(tmpdir(), 'n10-second-launch-'));
const repo = join(root, 'repo');
const other = join(root, 'other');
const plain = join(root, 'plain');
mkdirSync(join(repo, '.git'), { recursive: true });
mkdirSync(join(other, '.git'), { recursive: true });
mkdirSync(plain);
symlinkSync(repo, join(root, 'link'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('secondLaunchData', () => {
  it('sends the start dir as an absolute path', () => {
    expect(secondLaunchData('/work/repo', '/elsewhere')).toEqual({
      startDir: '/work/repo',
    });
    expect(secondLaunchData('repo', '/work')).toEqual({
      startDir: '/work/repo',
    });
  });

  it('sends nothing when the launch named no directory', () => {
    expect(secondLaunchData(undefined, '/work')).toEqual({});
    expect(secondLaunchData('', '/work')).toEqual({});
  });
});

describe('requestedRepo', () => {
  it('answers a repository by its real path', () => {
    expect(requestedRepo({ startDir: repo })).toBe(repo);
    expect(requestedRepo({ startDir: join(root, 'link') })).toBe(repo);
  });

  it('passes over a directory that is not a repository', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(requestedRepo({ startDir: plain })).toBeNull();
    expect(requestedRepo({ startDir: join(root, 'missing') })).toBeNull();
    warn.mockRestore();
  });

  it('ignores data that names no start dir', () => {
    for (const data of [undefined, null, 'x', {}, { startDir: 7 }]) {
      expect(requestedRepo(data)).toBeNull();
    }
  });
});

describe('installSecondLaunch', () => {
  const open = vi.fn();
  let win: FakeWindow;

  const launch = (data: unknown) =>
    app.emit('second-instance', {}, ['n10'], '/', data);
  const navigate = (isMainFrame: boolean, isSameDocument: boolean) =>
    win.webContents.emit('did-start-navigation', {
      isMainFrame,
      isSameDocument,
    });

  beforeEach(() => {
    app.removeAllListeners();
    open.mockReset();
    // No page has claimed, and nothing waits.
    claimLaunchRepo();
    releaseLaunchRepo();
    windows.length = 0;
    installSecondLaunch(open);
    win = new FakeWindow();
    windows.push(win);
    app.emit('browser-window-created', {}, win);
  });

  it('brings a minimized window forward', () => {
    win.minimized = true;
    launch({});
    expect(win.restore).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('keeps a launch until a page claims, handing it the last one', () => {
    launch({ startDir: other });
    launch({ startDir: repo });
    expect(open).not.toHaveBeenCalled();
    expect(claimLaunchRepo()).toBe(repo);
    expect(claimLaunchRepo()).toBeNull();
  });

  it('opens a launch at once in a page that has claimed', () => {
    claimLaunchRepo();
    launch({ startDir: repo });
    expect(open).toHaveBeenCalledExactlyOnceWith(repo);
  });

  it('keeps launches for the next page once the page navigates away', () => {
    claimLaunchRepo();
    navigate(false, false);
    navigate(true, true);
    launch({ startDir: other });
    expect(open).toHaveBeenCalledExactlyOnceWith(other);

    navigate(true, false);
    launch({ startDir: repo });
    expect(open).toHaveBeenCalledOnce();
    expect(claimLaunchRepo()).toBe(repo);
  });

  it('keeps launches for the next window once the window closes', () => {
    claimLaunchRepo();
    win.emit('closed');
    launch({ startDir: repo });
    expect(open).not.toHaveBeenCalled();
    expect(claimLaunchRepo()).toBe(repo);
  });
});
