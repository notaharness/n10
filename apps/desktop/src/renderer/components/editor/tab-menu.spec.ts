import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextMenuItem } from '../../../host/contract.js';
import { terminalTabId, type Tab } from '../../lib/tabs/tab-identity.js';
import type { PlayerRow } from './OrchestratorPlayers.js';
import { runTabMenu } from './tab-menu.js';

/**
 * An orchestrator tab's context menu is the keyboard's way to its
 * players, which its hover card shows only to a pointer: a "Players"
 * heading, one item per player tab, choosing one activates it. Close
 * Others keeps them.
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
const row = (tab: Tab): PlayerRow => ({
  tab,
  item: undefined,
  snapshot: undefined,
  running: true,
  foreignRepo: null,
  machineLabel: null,
  repoColor: null,
  active: false,
  unseen: false,
});

const orch = terminal('orch');
const first = terminal('first-player');
const second = terminal('second-player');

let shown: ContextMenuItem[] = [];
let choose: string | null = null;
const tabs = {
  tabs: [orch, first, second],
  activate: vi.fn(),
  pin: vi.fn(),
};
const closer = { close: vi.fn(), closeOthers: vi.fn(), closeAll: vi.fn() };

function menu(players: PlayerRow[] = []) {
  return runTabMenu(
    orch,
    tabs as unknown as Parameters<typeof runTabMenu>[1],
    closer as unknown as Parameters<typeof runTabMenu>[2],
    'wrap',
    players
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
});

const labels = () => shown.flatMap((i) => ('label' in i ? [i.label] : []));

describe('an orchestrator tab’s menu', () => {
  it('lists its players under a heading, and choosing one activates it', async () => {
    choose = `player:${second.id}`;
    await menu([row(first), row(second)]);
    const at = labels().indexOf('Players');
    expect(at).toBeGreaterThan(-1);
    expect(shown.find((i) => 'label' in i && i.label === 'Players')).toEqual(
      expect.objectContaining({ enabled: false })
    );
    expect(labels().slice(at + 1, at + 3)).toEqual([
      '~/first-player',
      '~/second-player',
    ]);
    expect(tabs.activate).toHaveBeenCalledWith(second.id);
    expect(closer.close).not.toHaveBeenCalled();
  });

  it('has no Players heading without players', async () => {
    await menu();
    expect(labels()).not.toContain('Players');
  });

  it('Close Others keeps its own players', async () => {
    choose = 'close-others';
    await menu([row(first), row(second)]);
    expect(closer.closeOthers).toHaveBeenCalledWith(orch.id, [
      first.id,
      second.id,
    ]);
  });
});
