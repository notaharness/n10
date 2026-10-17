import { describe, expect, it } from 'vitest';
import type { SidebarItem } from '../../../host/contract.js';
import { indexItems, tabItem } from './tab-item.js';
import { EMPTY_TABS, reduce, type ItemEntry, type Tab } from './tabs-model.js';

/**
 * A tab resolves to its row among its own repository's rows only. A
 * pane renders against whichever repository's rows it is given, the
 * open one's or a parked one's, and two repositories often share a
 * branch name: the other's row would hand the tab that repository's
 * worktree, agent and diff.
 */

const ALPHA = '/repos/alpha';
const BETA = '/repos/beta';

/** A worktree row, as the host lists one. */
function row(repo: string, branch: string): SidebarItem {
  return {
    kind: 'session',
    branch,
    session: {
      name: `${repo}:${branch}`,
      path: `${repo}/.claude/worktrees/${branch}`,
    },
  } as unknown as SidebarItem;
}

/** A tab opened on `branch` in `repo`, synced to its row. */
function tabOn(repo: string, branch: string, entry: Partial<ItemEntry> = {}) {
  let s = reduce(EMPTY_TABS, {
    type: 'open-item',
    repo,
    itemKey: `branch:${branch}`,
    preview: false,
  });
  s = reduce(s, {
    type: 'sync-items',
    repo,
    entries: [
      {
        itemKey: `branch:${branch}`,
        branch,
        title: branch,
        worktree: `${repo}/.claude/worktrees/${branch}`,
        ...entry,
      },
    ],
  });
  return s.tabs[0] as Tab;
}

describe('a tab among its repository’s rows', () => {
  const alphaRows = [row(ALPHA, 'shared'), row(ALPHA, 'only-alpha')];
  const betaRows = [row(BETA, 'shared')];

  it('resolves to its own repository’s row', () => {
    const tab = tabOn(ALPHA, 'shared');
    expect(tabItem(tab, indexItems(ALPHA, alphaRows))).toBe(alphaRows[0]);
  });

  it('resolves to nothing among another repository’s rows, even on a shared branch', () => {
    const tab = tabOn(ALPHA, 'shared');
    expect(tabItem(tab, indexItems(BETA, betaRows))).toBeUndefined();
  });

  it('finds its checkout by worktree first, then key, then branch', () => {
    const moved = row(ALPHA, 'renamed');
    const rows = [...alphaRows, moved];
    // `git switch` in its checkout: the key is gone, the worktree stays.
    const byWorktree = tabOn(ALPHA, 'gone', {
      worktree: `${ALPHA}/.claude/worktrees/renamed`,
    });
    expect(tabItem(byWorktree, indexItems(ALPHA, rows))).toBe(moved);
    // A pull request appeared: the key moved on, the branch did not.
    const byBranch = tabOn(ALPHA, 'only-alpha', {
      itemKey: 'pr:7',
      worktree: undefined,
    });
    expect(tabItem(byBranch, indexItems(ALPHA, rows))).toBe(alphaRows[1]);
  });
});
