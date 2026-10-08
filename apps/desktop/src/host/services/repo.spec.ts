import { execFileSync } from 'node:child_process';
import type * as Os from 'node:os';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterAll,
  afterEach,
} from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setRepoOpenedListener,
  activeRepoIs,
  activeConfigService,
  refreshRepo,
  forgetRecentRepo,
  getRepo,
  getRepoInfo,
  listRecentRepos,
  openRepo,
  openStartupRepo,
  prewarmRepo,
  repository,
} from './repo.js';
import { saveRecents } from './recent-repos.js';
import type { RecentRepo } from '@n10/vcs-core';

const fixture = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => {
  const os = await original<typeof Os>();
  const fs = await import('node:fs');
  const path = await import('node:path');
  fixture.home = fs.mkdtempSync(path.join(os.tmpdir(), 'n10-repo-home-'));
  return { ...os, homedir: () => fixture.home };
});
const originalCwd = process.cwd();
afterAll(() => rmSync(fixture.home, { recursive: true, force: true }));

const recents = (cwds: string[]): RecentRepo[] =>
  cwds.map((cwd, i) => ({ cwd, lastOpenedAt: i }));

let gitDir: string;
let plainDir: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'n10-repo-test-'));
  gitDir = join(base, 'repo');
  execFileSync('git', ['init', '--quiet', gitDir]);
  plainDir = join(base, 'plain');
  mkdirSync(plainDir, { recursive: true });
});

afterEach(() => {
  setRepoOpenedListener(() => undefined);
  process.chdir(originalCwd);
  rmSync(join(gitDir, '..'), { recursive: true, force: true });
});

describe('openStartupRepo', () => {
  it('opens the repo when N10_START_DIR is a valid git repo', () => {
    const info = openStartupRepo({ N10_START_DIR: gitDir });
    expect(info).not.toBeNull();
    expect(info!.cwd).toBe(gitDir);
    expect(getRepo()?.cwd).toBe(gitDir);
  });

  it('falls back to restoring the most recent valid repo', () => {
    // Launch without a start dir; recents injected explicitly.
    const info = openStartupRepo({}, recents([gitDir, '/gone/repo']));
    expect(info).not.toBeNull();
    expect(info!.cwd).toBe(gitDir);
  });

  it('skips dead recents when restoring', () => {
    const info = openStartupRepo(
      { N10_START_DIR: plainDir },
      recents(['/gone/repo', gitDir])
    );
    // invalid start dir falls through to the first valid recent
    expect(info).not.toBeNull();
    expect(info!.cwd).toBe(gitDir);
  });

  it('returns null with no start dir and empty recents', () => {
    expect(openStartupRepo({ N10_START_DIR: undefined }, [])).toBeNull();
  });
});

describe('opening a repository', () => {
  it('starts repository observers only when the handle changes', () => {
    const opened = vi.fn();
    setRepoOpenedListener(opened);
    openRepo(gitDir);
    openRepo(gitDir);
    expect(opened).toHaveBeenCalledExactlyOnceWith(gitDir);
    const other = join(gitDir, '..', 'other');
    execFileSync('git', ['init', '--quiet', other]);
    openRepo(other);
    expect(opened).toHaveBeenCalledTimes(2);
    expect(opened).toHaveBeenLastCalledWith(other);
  });

  it('refuses a directory that is not a repository', () => {
    // The picker relies on this to keep the user on the picker with an
    // error, rather than opening an empty workspace over nothing.
    expect(() => openRepo(plainDir)).toThrow(/Not a git repository/);
  });

  it('leaves the active repo alone when the open fails', () => {
    openRepo(gitDir);
    expect(getRepo()?.cwd).toBe(gitDir);

    expect(() => openRepo(plainDir)).toThrow();
    // A failed switch must not strand the app between two repos.
    expect(getRepo()?.cwd).toBe(gitDir);
    expect(activeRepoIs(gitDir)).toBe(true);
  });

  it('describes and warms another repository without opening it', () => {
    const opened = vi.fn();
    setRepoOpenedListener(opened);
    openRepo(gitDir);
    opened.mockClear();
    const other = join(gitDir, '..', 'other');
    execFileSync('git', ['init', '--quiet', other]);
    expect(getRepoInfo(other).cwd).toBe(realpathSync(other));
    prewarmRepo(other);
    expect(repository(other).parked()).toBe(true);
    expect(getRepo()?.cwd).toBe(gitDir);
    expect(activeRepoIs(gitDir)).toBe(true);
    expect(opened).not.toHaveBeenCalled();
    // Opened later, it is the handle that was read.
    const read = repository(other);
    openRepo(other);
    expect(repository(other)).toBe(read);
    expect(read.parked()).toBe(false);
  });

  it('tracks which repo long-running work belongs to', () => {
    openRepo(gitDir);
    expect(activeRepoIs(gitDir)).toBe(true);
    expect(activeRepoIs(plainDir)).toBe(false);
  });
});

// A repository's identity is its real path — the string git reports as
// the toplevel, which is what the tmux prefix, a worktree's origin and
// the strip's repo groups are all computed from. Opening through a
// symlink (or macOS's /var against /private/var) must land on the same
// identity, or the same repository gets a second tab group, a second
// recents entry and a foreign tab for its own agents.
describe('opening a repository through a symlink', () => {
  let link: string;
  let real: string;
  beforeEach(() => {
    real = realpathSync(gitDir);
    link = join(gitDir, '..', 'link-to-repo');
    symlinkSync(gitDir, link);
  });
  const ours = () =>
    listRecentRepos()
      .map((r) => r.cwd)
      .filter((cwd) => cwd === link || cwd === real || cwd === plainDir);

  it('opens it under its real path', () => {
    saveRecents([]);
    const info = openRepo(link);
    expect(info.cwd).toBe(real);
    expect(getRepo()?.cwd).toBe(real);
    expect(activeRepoIs(real)).toBe(true);
    expect(realpathSync(process.cwd())).toBe(real);
  });

  it('records one recent, under the real path, even over an old symlink entry', () => {
    saveRecents(recents([link]));
    openRepo(link);
    expect(ours()).toEqual([real]);
  });

  it('lists an existing symlink-path recent under its real path, once', () => {
    saveRecents(recents([link, real, plainDir]));
    expect(ours()).toEqual([real, plainDir]);
  });

  it('forgets a repository whichever path the entry was stored under', () => {
    saveRecents(recents([link, plainDir]));
    forgetRecentRepo(real);
    expect(ours()).toEqual([plainDir]);
  });

  it('canonicalises the start directory the same way', () => {
    saveRecents([]);
    const info = openStartupRepo({ N10_START_DIR: link });
    expect(info?.cwd).toBe(real);
  });
});

describe('recent repositories', () => {
  it('records an opened repo, newest first', () => {
    saveRecents([]);
    openRepo(gitDir);
    expect(listRecentRepos()[0].cwd).toBe(gitDir);
  });

  it('marks a recent that no longer exists as invalid rather than dropping it', () => {
    // The picker greys these out, which tells the user what happened;
    // silently removing them looks like n10 lost their repo.
    const dead = join(tmpdir(), 'n10-gone-forever');
    saveRecents(recents([gitDir, dead]));
    const listed = listRecentRepos();
    expect(listed.map((r) => r.cwd)).toContain(dead);
    expect(listed.find((r) => r.cwd === dead)?.valid).toBe(false);
    expect(listed.find((r) => r.cwd === gitDir)?.valid).toBe(true);
  });

  it('forgets a repo on request', () => {
    saveRecents(recents([gitDir, plainDir]));
    forgetRecentRepo(plainDir);
    expect(listRecentRepos().map((r) => r.cwd)).toEqual([gitDir]);
  });

  it('caps the list so it stays a menu rather than a history', () => {
    saveRecents(recents(Array.from({ length: 25 }, (_, i) => `/repo-${i}`)));
    expect(listRecentRepos().length).toBeLessThanOrEqual(10);
  });
});

it('refreshes config explicitly without making snapshot reads publish', () => {
  openRepo(gitDir);
  const service = activeConfigService();
  const reload = vi.spyOn(service, 'reload');
  getRepo();
  expect(reload).not.toHaveBeenCalled();
  expect(refreshRepo()?.cwd).toBe(gitDir);
  expect(reload).toHaveBeenCalledOnce();
});

describe('the verdicts a repository can file', () => {
  it('are the provider’s, once it can file a review there', () => {
    execFileSync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/acme/app.git'],
      { cwd: gitDir }
    );
    expect(openRepo(gitDir).reviewEvents).toEqual([
      'COMMENT',
      'APPROVE',
      'REQUEST_CHANGES',
    ]);
  });

  it('are none while the provider is not set up for the repository', () => {
    // GitHub, but no remote to name the repository: nothing to file a
    // review on.
    openRepo(gitDir);
    activeConfigService().updateField(
      { label: 'Provider', key: 'vendor', configBag: 'project' },
      'github'
    );
    const info = refreshRepo()!;
    expect(info.providerId).toBe('github');
    expect(info.vcsConfigured).toBe(false);
    expect(info.reviewEvents).toEqual([]);
  });
});
