import { describe, expect, it } from 'vitest';
import type { BranchSession, MachineView } from '../../../host/contract.js';
import {
  newSessionNames,
  sessionCards,
  shownSession,
  type SessionCard,
} from './session-cards.js';

const PEER = 'b'.repeat(32);
const machines = [
  { peerId: 'a'.repeat(32), label: 'laptop', isLocal: true },
  { peerId: PEER, label: 'workbox', isLocal: false },
] as MachineView[];

const session = (over: Partial<BranchSession>): BranchSession => ({
  name: 'agent',
  kind: 'agent',
  machine: 'local',
  running: true,
  spawnedAt: 1,
  ...over,
});

describe('sessionCards', () => {
  it('titles each session and names another machine’s only', () => {
    const cards = sessionCards(
      [
        session({}),
        session({ name: 'remote', machine: PEER }),
        session({ name: 'shell', kind: 'terminal', terminalKind: 'shell' }),
        session({ name: 'ai', kind: 'terminal', terminalKind: 'agent' }),
      ],
      machines
    );
    expect(cards.map((c) => [c.name, c.title, c.machineLabel])).toEqual([
      ['agent', 'Agent', null],
      ['remote', 'Agent', 'workbox'],
      ['shell', 'Terminal', null],
      ['ai', 'Agent', null],
    ]);
  });
});

describe('shownSession', () => {
  const cards = sessionCards(
    [session({ name: 'a' }), session({ name: 'b' })],
    machines
  );
  it('prefers the pick, then the tab’s own agent, then the first', () => {
    expect(shownSession(cards, 'b', 'a')?.name).toBe('b');
    expect(shownSession(cards, 'gone', 'b')?.name).toBe('b');
    expect(shownSession(cards, null, undefined)?.name).toBe('a');
    expect(shownSession([], null, 'a')).toBeUndefined();
  });
});

describe('newSessionNames', () => {
  const card = (name: string) => ({ name } as SessionCard);
  it('reports nothing for the first listing, then only what it lacked', () => {
    expect(newSessionNames(null, [card('a')])).toEqual([]);
    expect(newSessionNames([card('a')], [card('a'), card('b')])).toEqual(['b']);
    expect(newSessionNames([card('a'), card('b')], [card('b')])).toEqual([]);
  });
});
