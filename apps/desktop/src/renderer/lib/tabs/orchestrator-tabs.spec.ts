import { describe, expect, it } from 'vitest';
import type { OrchestratorGroupSummary } from '../../../host/contract.js';
import { itemTabId, terminalTabId, type Tab } from './tab-identity.js';
import {
  orchestratorTabs,
  playerMarks,
  presentedOrder,
  stripSelection,
  stripTabs,
} from './orchestrator-tabs.js';

/**
 * Finding Orchestra's groups among the tabs: an orchestrator's tab by
 * its session, players' tabs by theirs or, from another repository, by
 * checkout. Players without a tab are simply not shown.
 */

const REPO = '/repos/alpha';
const OTHER = '/repos/beta';

const terminal = (name: string): Tab => ({
  id: terminalTabId(name),
  kind: 'terminal',
  name,
  terminalKind: 'shell',
  cwd: '/x',
  displayPath: '/x',
  repo: null,
  preview: false,
  listed: true,
});
const worktreeTab = (repo: string, branch: string): Tab => ({
  id: itemTabId(repo, `branch:${branch}`),
  kind: 'item',
  repo,
  itemKey: `branch:${branch}`,
  preview: false,
  branch,
  worktree: `${repo}/.claude/worktrees/${branch}`,
});
const term = (key: string) => ({ key, repo: REPO, worktree: '' });
const wt = (repo: string, branch: string) => ({
  key: `wt:${repo}:${branch}`,
  repo,
  worktree: `${repo}/.claude/worktrees/${branch}`,
});

/** This repository's item tabs answer to a session key; others' don't. */
const sessionOf = (tab: Tab): string | undefined =>
  tab.kind === 'terminal'
    ? tab.name
    : tab.kind === 'item' && tab.repo === REPO
    ? `wt:${tab.repo}:${tab.branch}`
    : undefined;

const ids = (tabs: readonly Tab[] | undefined) => tabs?.map((t) => t.id);

describe('orchestratorTabs', () => {
  const orch = terminal('orch');
  const a = worktreeTab(REPO, 'a');
  const b = worktreeTab(OTHER, 'b');
  const loose = worktreeTab(REPO, 'loose');
  const group: OrchestratorGroupSummary = {
    orchestrator: term('orch'),
    players: [wt(REPO, 'a'), wt(OTHER, 'b'), wt(REPO, 'no-tab')],
  };

  it('groups player tabs under the orchestrator tab, in strip order', () => {
    const view = orchestratorTabs([b, orch, loose, a], [group], sessionOf);
    expect(ids(view.players.get(orch.id))).toEqual([b.id, a.id]);
    expect([...view.grouped]).toEqual([b.id, a.id]);
    expect(view.orchestratorOf.get(a.id)).toBe(orch.id);
    expect(view.grouped.has(loose.id)).toBe(false);
  });

  it('marks an orchestrator tab with no player tabs', () => {
    const view = orchestratorTabs([orch, loose], [group], sessionOf);
    expect(ids(view.players.get(orch.id))).toEqual([]);
    expect(view.grouped.size).toBe(0);
  });

  it('groups nothing when the orchestrator has no tab', () => {
    const view = orchestratorTabs([a, b], [group], sessionOf);
    expect(view.players.size).toBe(0);
    expect(view.grouped.size).toBe(0);
  });

  it('leaves an orchestrator that reports to another in its place', () => {
    const sub = terminal('sub');
    const view = orchestratorTabs(
      [orch, sub, a],
      [
        { orchestrator: term('orch'), players: [term('sub')] },
        { orchestrator: term('sub'), players: [wt(REPO, 'a')] },
      ],
      sessionOf
    );
    expect(ids(view.players.get(orch.id))).toEqual([]);
    expect(ids(view.players.get(sub.id))).toEqual([a.id]);
    expect(view.grouped.has(sub.id)).toBe(false);
  });

  it('selects the orchestrator tab for an active player, and makes it the Tab stop', () => {
    const view = orchestratorTabs([a, orch, loose, b], [group], sessionOf);
    const strip = stripTabs([a, orch, loose, b], view);
    expect(strip.map((t) => t.id)).toEqual([orch.id, loose.id]);
    expect(stripSelection(strip, view, b.id)).toEqual({
      selectedId: orch.id,
      tabStopId: orch.id,
    });
    expect(stripSelection(strip, view, loose.id)).toEqual({
      selectedId: loose.id,
      tabStopId: loose.id,
    });
    // Nothing on the strip active: the first tab is the Tab stop.
    expect(stripSelection(strip, view, null)).toEqual({
      selectedId: null,
      tabStopId: orch.id,
    });
  });

  it('presents each orchestrator followed by its players', () => {
    const tabs = [a, orch, loose, b];
    const view = orchestratorTabs(tabs, [group], sessionOf);
    expect(presentedOrder(tabs, view)).toEqual([orch.id, a.id, b.id, loose.id]);
  });

  it("carries its players' selection, unseen mark and blink to the orchestrator tab", () => {
    const quiet = {
      active: false,
      unseen: false,
      snapshot: { flashing: false },
    };
    expect(playerMarks(undefined)).toEqual({
      active: false,
      unseen: false,
      flashing: false,
    });
    expect(playerMarks([quiet, { ...quiet, unseen: true }]).unseen).toBe(true);
    expect(
      playerMarks([quiet, { ...quiet, snapshot: { flashing: true } }]).flashing
    ).toBe(true);
    // The active player's blink is already being looked at.
    expect(
      playerMarks([{ ...quiet, active: true, snapshot: { flashing: true } }])
    ).toEqual({ active: true, unseen: false, flashing: false });
  });
});
