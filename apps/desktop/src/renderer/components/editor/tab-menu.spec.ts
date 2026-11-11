import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextMenuItem } from '../../../host/contract.js';
import { terminalTabId, type Tab } from '../../lib/tabs/tab-identity.js';
import { runGroupMenu, runTabMenu, type GroupMenu } from './tab-menu.js';

/**
 * A grouped tab's native menu offers its group's actions below its own;
 * a chip with no tab of its own offers the group's alone. Close Others
 * closes every other tab, its group's included.
 */

const terminal = (name: string): Tab => ({
  id: terminalTabId(name),
  kind: 'terminal',
  name,
  terminalKind: 'shell',
  cwd: `/home/u/${name}`,
  displayPath: `~/${name}`,
  repo: null,
  preview: false,
  listed: true,
});

const home = terminal('orch');
const player = terminal('player');

let shown: ContextMenuItem[] = [];
let choose: string | null = null;
const tabs = {
  tabs: [home, player],
  pinned: [] as string[],
  activate: vi.fn(),
  keep: vi.fn(),
  setPinned: vi.fn(),
};
const closer = { close: vi.fn(), closeOthers: vi.fn(), closeAll: vi.fn() };
const group = (collapsed = false, canCollapseOthers = true): GroupMenu => ({
  collapsed,
  canCollapseOthers,
  showTabs: vi.fn(),
  rename: vi.fn(),
  setCollapsed: vi.fn(),
  collapseOthers: vi.fn(),
});

function menu(g?: GroupMenu) {
  return runTabMenu(
    home,
    tabs as unknown as Parameters<typeof runTabMenu>[1],
    closer as unknown as Parameters<typeof runTabMenu>[2],
    'wrap',
    g
  );
}

beforeEach(() => {
  vi.stubGlobal('window', {
    n10: {
      showContextMenu: (items: ContextMenuItem[]) => {
        shown = items;
        return Promise.resolve(choose);
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  choose = null;
  tabs.pinned = [];
});

const item = (label: string) =>
  shown.find((i) => 'label' in i && i.label === label);

const labels = () => shown.flatMap((i) => ('label' in i ? [i.label] : []));

describe('a grouped tab’s menu', () => {
  it('offers its group’s actions after its own', async () => {
    await menu(group());
    expect(labels().slice(0, 3)).toEqual([
      'Close',
      'Close Others',
      'Close All',
    ]);
    expect(labels()).toEqual(
      expect.arrayContaining([
        'Show tabs',
        'Rename group…',
        'Collapse group',
        'Collapse others',
      ])
    );
  });

  it('offers Expand group on a collapsed group, and runs it', async () => {
    const g = group(true);
    choose = 'group-expand';
    await menu(g);
    expect(labels()).toContain('Expand group');
    expect(g.setCollapsed).toHaveBeenCalledWith(false);
    expect(closer.close).not.toHaveBeenCalled();
  });

  it('disables Collapse others when no other group would change', async () => {
    await menu(group(false, false));
    expect(
      shown.find((i) => 'label' in i && i.label === 'Collapse others')
    ).toEqual(expect.objectContaining({ enabled: false }));
  });

  it('has no group actions without a group', async () => {
    await menu();
    expect(labels()).not.toContain('Show tabs');
  });

  it('closes every other tab on Close Others', async () => {
    choose = 'close-others';
    await menu(group());
    expect(closer.closeOthers).toHaveBeenCalledWith(home.id);
  });
});

describe('a chip’s own menu', () => {
  it('offers only the group’s actions, and Show tabs opens the roster', async () => {
    const g = group();
    choose = 'group-show';
    await runGroupMenu(g);
    expect(labels()).toEqual([
      'Show tabs',
      'Rename group…',
      'Collapse group',
      'Collapse others',
    ]);
    expect(g.showTabs).toHaveBeenCalled();
  });

  it('opens the rename dialog on Rename group…', async () => {
    const g = group();
    choose = 'group-rename';
    await runGroupMenu(g);
    expect(g.rename).toHaveBeenCalled();
  });
});

describe('pins in a tab’s menu', () => {
  it('pins an unpinned tab and unpins a pinned one', async () => {
    choose = 'pin';
    await menu();
    expect(labels()).toContain('Pin tab');
    expect(tabs.setPinned).toHaveBeenCalledWith([home.id], true);
    tabs.pinned = [home.id];
    choose = 'unpin';
    await menu();
    expect(labels()).toContain('Unpin tab');
    expect(tabs.setPinned).toHaveBeenLastCalledWith([home.id], false);
  });

  it('says pinned tabs stay open, and turns Close Others and Close All off when only pins are left', async () => {
    await menu();
    expect(item('Close Others')).toMatchObject({
      enabled: true,
      toolTip: 'Pinned tabs stay open',
    });
    tabs.pinned = [player.id];
    await menu();
    expect(item('Close Others')).toMatchObject({ enabled: false });
    expect(item('Close All')).toMatchObject({ enabled: true });
    tabs.pinned = [home.id, player.id];
    await menu();
    expect(item('Close All')).toMatchObject({ enabled: false });
  });

  it('offers Rename group… for a tab alone in its place', async () => {
    const rename = vi.fn();
    choose = 'group-rename';
    await runTabMenu(
      home,
      tabs as unknown as Parameters<typeof runTabMenu>[1],
      closer as unknown as Parameters<typeof runTabMenu>[2],
      'wrap',
      undefined,
      rename
    );
    expect(labels()).toContain('Rename group…');
    expect(rename).toHaveBeenCalled();
  });
});
