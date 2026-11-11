import { describe, expect, it } from 'vitest';
import type { Affiliation } from '@n10/core/ui';
import {
  followPlan,
  NO_PLAYERS,
  NOTHING_TO_FOLLOW,
  tilePlan,
  TILE_NEEDS_HOME,
} from './supervise-plan.js';
import { present, type TabFacts } from './tab-groups.js';
import type { Tab } from './tab-identity.js';

const term = (name: string): Tab => ({
  kind: 'terminal',
  id: `terminal:${name}`,
  name,
  terminalKind: 'agent',
  cwd: `/w/${name}`,
  displayPath: `~/${name}`,
  repo: null,
  preview: false,
  listed: true,
});

const home = { key: 'boss', worktree: '', repo: '/r' };
const parent: Affiliation = {
  kind: 'parent',
  key: 'claude:boss',
  label: 'boss',
  home,
};
const homeless: Affiliation = {
  kind: 'parent',
  key: 'codex:x',
  label: 'Codex · r',
};
const place: Affiliation = { kind: 'place', key: 'place:/r', label: 'r' };

const AFFILIATION: Record<string, Affiliation> = {
  boss: parent,
  p1: parent,
  p2: parent,
  p3: parent,
  c1: homeless,
  c2: homeless,
  x: place,
  y: place,
};
const facts = (tab: Tab): TabFacts => {
  const name = tab.kind === 'terminal' ? tab.name : '';
  return { affiliation: AFFILIATION[name] ?? null, session: name };
};
const tabs = (...names: string[]) => names.map(term);
const groupsOf = (names: string[], pinned: string[] = []) =>
  present(
    tabs(...names),
    facts,
    pinned.map((n) => `terminal:${n}`)
  );
const ids = (...names: string[]) => names.map((n) => `terminal:${n}`);

describe('tile plan', () => {
  it('keeps the home and takes every other unpinned member', () => {
    const groups = groupsOf(['x', 'p1', 'boss', 'p2', 'p3'], ['p3']);
    expect(tilePlan(groups, 'claude:boss', facts)).toEqual({
      ok: true,
      plan: { home: 'terminal:boss', players: ids('p1', 'p2') },
    });
  });

  it('tiles around a pinned home', () => {
    const groups = groupsOf(['boss', 'p1'], ['boss']);
    expect(tilePlan(groups, 'claude:boss', facts)).toEqual({
      ok: true,
      plan: { home: 'terminal:boss', players: ids('p1') },
    });
  });

  it('needs the orchestrator’s own tab here', () => {
    expect(tilePlan(groupsOf(['p1', 'p2']), 'claude:boss', facts)).toEqual({
      ok: false,
      feedback: TILE_NEEDS_HOME,
    });
    expect(tilePlan(groupsOf(['c1', 'c2']), 'codex:x', facts)).toEqual({
      ok: false,
      feedback: TILE_NEEDS_HOME,
    });
    expect(tilePlan(groupsOf(['x', 'y']), 'place:/r', facts)).toEqual({
      ok: false,
      feedback: TILE_NEEDS_HOME,
    });
  });

  it('needs a player to move', () => {
    const groups = groupsOf(['boss', 'p1'], ['p1']);
    expect(tilePlan(groups, 'claude:boss', facts)).toEqual({
      ok: false,
      feedback: NO_PLAYERS,
    });
  });
});

describe('follow plan', () => {
  const pane = (order: string[], focused: boolean, focusedActive: string) => ({
    order: ids(...order),
    focused,
    focusedActive: `terminal:${focusedActive}`,
  });
  const none = () => false;

  it('takes the unpinned members but the home and what the focused pane shows', () => {
    const order = ['boss', 'p1', 'p2', 'p3', 'x'];
    const groups = groupsOf(order, ['p3']);
    expect(
      followPlan(groups, 'claude:boss', pane(order, true, 'p1'), none)
    ).toEqual({
      ok: true,
      plan: { ids: ids('p2'), show: 'terminal:p2', inPlace: false },
    });
  });

  it('shows first the first member with new output waiting', () => {
    const order = ['p1', 'p2', 'p3'];
    const plan = followPlan(
      groupsOf(order),
      'claude:boss',
      pane(order, false, 'x'),
      (tab) => tab.id === 'terminal:p3'
    );
    expect(plan.ok && plan.plan.show).toBe('terminal:p3');
  });

  it('follows in place in an unfocused pane it would empty', () => {
    const order = ['c1', 'c2'];
    const plan = followPlan(
      groupsOf(order),
      'codex:x',
      pane(order, false, 'x'),
      none
    );
    expect(plan.ok && plan.plan.inPlace).toBe(true);
  });

  it('has nothing to follow when only the shown tab and pins are left', () => {
    const order = ['boss', 'p1', 'p2'];
    expect(
      followPlan(
        groupsOf(order, ['p2']),
        'claude:boss',
        pane(order, true, 'p1'),
        none
      )
    ).toEqual({ ok: false, feedback: NOTHING_TO_FOLLOW });
  });
});
