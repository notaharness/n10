import { describe, expect, it } from 'vitest';
import type { PullRequestInfo } from '@n10/vcs-core';
import type { SidebarItem } from '../../../host/contract.js';
import {
  cutSide,
  repoDisplayName,
  tabPresentation,
  tabRepo,
} from './tab-presentation.js';
import { itemTabId, terminalTabId } from './tab-identity.js';
import type { ItemTab, Tab } from './tabs-model.js';

const A = '/repos/alpha';

const item = (repo: string, itemKey: string): Tab => ({
  id: itemTabId(repo, itemKey),
  kind: 'item',
  repo,
  itemKey,
  preview: false,
});

const settings: Tab = { id: 'settings', kind: 'settings', preview: false };

const terminal = (name: string, repo: string | null, cwd = '/x'): Tab => ({
  id: terminalTabId(name),
  kind: 'terminal',
  name,
  terminalKind: 'shell',
  cwd,
  displayPath: cwd,
  repo,
  preview: false,
  listed: true,
});

describe('repoDisplayName', () => {
  it('is the checkout directory name', () => {
    expect(repoDisplayName('/home/dev/code/n10')).toBe('n10');
  });

  it('ignores a trailing separator', () => {
    expect(repoDisplayName('/home/dev/code/n10/')).toBe('n10');
  });

  it('handles a Windows path', () => {
    expect(repoDisplayName('C:\\src\\n10')).toBe('n10');
  });

  it('falls back to the path when there is nothing to take', () => {
    expect(repoDisplayName('/')).toBe('/');
  });
});

describe('tabRepo', () => {
  it('names an item tab’s repository', () => {
    expect(tabRepo(item(A, 'branch:x'))).toBe(A);
  });

  it('is null for settings', () => {
    expect(tabRepo(settings)).toBeNull();
  });

  it('is the terminal’s repository, or null for a plain folder', () => {
    expect(tabRepo(terminal('t', A))).toBe(A);
    expect(tabRepo(terminal('t', null))).toBeNull();
  });
});

describe('cutSide', () => {
  it('cuts branch names and directories from the start, titles from the end', () => {
    expect(cutSide('branch')).toBe('start');
    expect(cutSide('terminal')).toBe('start');
    expect(cutSide('pr')).toBe('end');
    expect(cutSide('settings')).toBe('end');
  });
});

describe('tabPresentation', () => {
  const pr = { id: 42, title: 'Add undo support' } as PullRequestInfo;
  const withPr: SidebarItem = {
    kind: 'session',
    session: { name: 'feat-undo', running: false },
    pr,
    branch: 'feat-undo',
    isMerged: false,
  };
  const bare: SidebarItem = {
    kind: 'session',
    session: { name: 'feat-undo', running: false },
    branch: 'feat-undo',
    isMerged: false,
  };
  const tab = (extra: Partial<ItemTab> = {}): Tab => ({
    ...(item(A, 'pr:42') as ItemTab),
    ...extra,
  });

  it('names a tab after its pull request while the item is at hand', () => {
    expect(tabPresentation(tab(), withPr)).toEqual({
      label: 'Add undo support',
      face: 'pr',
    });
    expect(tabPresentation(tab({ itemKey: 'branch:feat-undo' }), bare)).toEqual(
      { label: 'feat-undo', face: 'branch' }
    );
  });

  it('keeps the stamped title once the item is out of reach', () => {
    // A tab of another repository: this sidebar has no row for it, and
    // the strip must not fall back to "42".
    const foreign = tab({ title: 'Add undo support', branch: 'feat-undo' });
    expect(tabPresentation(foreign, undefined)).toEqual({
      label: 'Add undo support',
      face: 'pr',
    });
  });

  it('falls back to the branch, then the bare key', () => {
    expect(tabPresentation(tab({ branch: 'feat-undo' }), undefined).label).toBe(
      'feat-undo'
    );
    expect(tabPresentation(tab(), undefined).label).toBe('42');
  });

  it('shows a terminal as its whole directory; the strip cuts it to fit', () => {
    expect(
      tabPresentation(
        terminal('t', null, '~/Documents/Code/Personal/n10'),
        undefined
      )
    ).toEqual({ label: '~/Documents/Code/Personal/n10', face: 'terminal' });
  });

  it('names the settings tab', () => {
    const settings: Tab = { id: 'settings', kind: 'settings', preview: false };
    expect(tabPresentation(settings, undefined)).toEqual({
      label: 'Settings',
      face: 'settings',
    });
  });

  // ux-machines.md §6 / D8: the machine, resolved by the caller, comes
  // first — and is entirely absent for a local tab.
  describe('machine prefix (D8)', () => {
    const branchTab = tab({ itemKey: 'branch:feat-undo', branch: 'feat-undo' });

    it('is unprefixed for a local tab — no machineLabel argument at all', () => {
      expect(tabPresentation(branchTab, undefined)).toEqual({
        label: 'feat-undo',
        face: 'branch',
      });
    });

    it('is unprefixed when the caller explicitly passes null (local)', () => {
      expect(tabPresentation(branchTab, undefined, null)).toEqual({
        label: 'feat-undo',
        face: 'branch',
      });
    });

    it('puts a remote machine label first, separated by " · "', () => {
      expect(tabPresentation(branchTab, undefined, 'workbox')).toEqual({
        label: 'workbox · feat-undo',
        face: 'branch',
      });
    });

    it('prefixes a terminal tab’s directory label the same way', () => {
      expect(
        tabPresentation(terminal('t', null, '~/x'), undefined, 'workbox')
      ).toEqual({ label: 'workbox · ~/x', face: 'terminal' });
    });

    it('never prefixes settings, even if a caller passed a label', () => {
      const settings: Tab = {
        id: 'settings',
        kind: 'settings',
        preview: false,
      };
      expect(tabPresentation(settings, undefined, 'workbox')).toEqual({
        label: 'Settings',
        face: 'settings',
      });
    });
  });
});
