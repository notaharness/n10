import { describe, expect, it } from 'vitest';
import type { SavedWorkspace } from '../../../host/contract.js';
import {
  itemTabId,
  sessionKey,
  terminalDismissKey,
  terminalTabId,
} from './tab-identity.js';
import {
  EMPTY_WORKSPACE,
  reduce,
  type ItemEntry,
  type SyncListings,
  type TabsAction,
  type TerminalEntry,
  type Workspace,
} from './tabs-model.js';
import { COLLAPSED_LIMIT } from './tab-order.js';
import { restoreWorkspace, toSaved } from './workspace-file.js';
import { focusedPaneOf, stripOf } from './workspace.js';

const REPO = '/repos/alpha';
const OTHER = '/repos/beta';
const id = (key: string, repo = REPO) => itemTabId(repo, key);

const run = (...actions: TabsAction[]) =>
  actions.reduce(reduce, EMPTY_WORKSPACE);
const then = (ws: Workspace, ...actions: TabsAction[]) =>
  actions.reduce(reduce, ws);
const view = (ws: Workspace) => stripOf(ws, focusedPaneOf(ws).id);
const ids = (ws: Workspace) => view(ws).tabs.map((t) => t.id);
const open = (itemKey: string, preview = false): TabsAction => ({
  type: 'open-item',
  repo: REPO,
  itemKey,
  preview,
});
const sync = (
  entries: ItemEntry[] | undefined,
  terminals?: TerminalEntry[],
  repo = REPO,
  more: Omit<SyncListings, 'entries' | 'terminals'> = {}
): TabsAction => ({ type: 'sync-items', repo, entries, terminals, ...more });
/** A sync with tmux's word on which agents run: `x`, or none. */
const alive = (...names: string[]) => ({ alive: names });

const live: ItemEntry = {
  itemKey: 'branch:x',
  branch: 'x',
  sessionName: 'x',
  running: true,
};
const shell = (created?: number, machine?: string): TerminalEntry => ({
  name: 'notes-shell',
  kind: 'shell',
  cwd: '/home/dev/notes',
  displayPath: '~/notes',
  repo: null,
  ...(created !== undefined ? { created } : {}),
  ...(machine ? { machine } : {}),
});

describe('keep and pin', () => {
  it('ends a preview without pinning it', () => {
    const ws = run(open('branch:a', true), {
      type: 'keep',
      id: id('branch:a'),
    });
    expect(view(ws).tabs[0].preview).toBe(false);
    expect(ws.pinned).toEqual([]);
  });

  it('pins a preview and keeps it, leaving the order alone', () => {
    const ws = run(open('branch:a'), open('branch:b', true), {
      type: 'set-pinned',
      ids: [id('branch:b')],
      pinned: true,
    });
    expect(ws.pinned).toEqual([id('branch:b')]);
    expect(view(ws).tabs[1].preview).toBe(false);
    expect(ids(ws)).toEqual([id('branch:a'), id('branch:b')]);
    expect(view(ws).activeId).toBe(id('branch:b'));
  });

  it('unpins without moving the tab or focus', () => {
    let ws = run(open('branch:a'), open('branch:b'), {
      type: 'set-pinned',
      ids: [id('branch:b')],
      pinned: true,
    });
    ws = then(ws, { type: 'set-pinned', ids: [id('branch:b')], pinned: false });
    expect(ws.pinned).toEqual([]);
    expect(ids(ws)).toEqual([id('branch:a'), id('branch:b')]);
    expect(view(ws).activeId).toBe(id('branch:b'));
  });

  it('changes nothing for a tab that is not there, or already pinned', () => {
    const ws = run(open('branch:a'), {
      type: 'set-pinned',
      ids: [id('branch:a')],
      pinned: true,
    });
    expect(
      then(ws, { type: 'set-pinned', ids: [id('branch:a')], pinned: true })
    ).toBe(ws);
    expect(
      then(ws, { type: 'set-pinned', ids: ['nothing'], pinned: true })
    ).toBe(ws);
  });

  it('drops the pin when its tab closes', () => {
    const ws = run(
      open('branch:a'),
      { type: 'set-pinned', ids: [id('branch:a')], pinned: true },
      { type: 'close', id: id('branch:a') }
    );
    expect(ws.pinned).toEqual([]);
  });

  it('keeps pinned tabs through Close Others and Close All', () => {
    let ws = run(open('branch:a'), open('branch:b'), open('branch:c'), {
      type: 'set-pinned',
      ids: [id('branch:a')],
      pinned: true,
    });
    ws = then(ws, { type: 'close-others', id: id('branch:c') });
    expect(ids(ws)).toEqual([id('branch:a'), id('branch:c')]);
    expect(view(ws).activeId).toBe(id('branch:c'));
    ws = then(ws, { type: 'close-all', repo: REPO });
    expect(ids(ws)).toEqual([id('branch:a')]);
    expect(view(ws).activeId).toBe(id('branch:a'));
  });
});

describe('rename-group', () => {
  const rename = (name: string | null): TabsAction => ({
    type: 'rename-group',
    key: 'claude:x',
    name,
  });

  it('names a group by its key, trimmed', () => {
    expect(run(rename('  Ops  ')).groupNames).toEqual({ 'claude:x': 'Ops' });
  });

  it('gives the group its label back for a blank name or null', () => {
    expect(run(rename('Ops'), rename('   ')).groupNames).toEqual({});
    expect(run(rename('Ops'), rename(null)).groupNames).toEqual({});
  });

  it('returns the same workspace for an unchanged name', () => {
    const ws = run(rename('Ops'));
    expect(then(ws, rename('Ops'))).toBe(ws);
  });
});

describe('dismissed', () => {
  it('keeps a closed agent closed while it runs, then forgets it once it ends', () => {
    let ws = run(sync([live]), { type: 'close', id: id('branch:x') });
    expect(ws.dismissed).toEqual([sessionKey(REPO, 'x')]);
    ws = then(ws, sync([live], undefined, REPO, alive('x')));
    expect(ids(ws)).toEqual([]);
    ws = then(
      ws,
      sync([{ ...live, running: false }], undefined, REPO, alive())
    );
    expect(ws.dismissed).toEqual([]);
    // Started again later: a new agent, with its tab.
    ws = then(ws, sync([live]));
    expect(ids(ws)).toEqual([id('branch:x')]);
  });

  it('forgets nothing on a sidebar that has not answered', () => {
    const ws = run(sync([live]), { type: 'close', id: id('branch:x') });
    expect(then(ws, sync(undefined))).toBe(ws);
  });

  it('forgets nothing before tmux has said which agents run', () => {
    const ws = run(sync([live]), { type: 'close', id: id('branch:x') });
    expect(then(ws, sync([{ ...live, running: false }]))).toBe(ws);
  });

  // The sidebar's `running` is "this host attached it": a model read
  // before discovery's scan says not running of an agent tmux still runs.
  it('keeps one the sidebar has not attached yet while tmux runs it', () => {
    let ws = run(sync([live]), { type: 'close', id: id('branch:x') });
    ws = then(
      ws,
      sync([{ ...live, running: false }], undefined, REPO, alive('x'))
    );
    expect(ws.dismissed).toEqual([sessionKey(REPO, 'x')]);
    ws = then(ws, sync([live], undefined, REPO, alive('x')));
    expect(ids(ws)).toEqual([]);
  });

  it('keeps one the sidebar runs that tmux’s answer is too old to name', () => {
    const ws = run(sync([live]), { type: 'close', id: id('branch:x') });
    expect(then(ws, sync([live], undefined, REPO, alive())).dismissed).toEqual([
      sessionKey(REPO, 'x'),
    ]);
  });

  it('keeps one on another machine, which tmux here does not run', () => {
    const remote = JSON.stringify(['worktree', REPO, '/w/x', 'a'.repeat(32)]);
    const ws = run(sync([{ ...live, sessionName: remote }]), {
      type: 'close',
      id: id('branch:x'),
    });
    expect(then(ws, sync([], undefined, REPO, alive())).dismissed).toEqual([
      sessionKey(REPO, remote),
    ]);
  });

  it('forgets an agent the user opened again from the sidebar', () => {
    let ws = run(sync([live]), { type: 'close', id: id('branch:x') });
    ws = then(ws, open('branch:x'), sync([live]));
    expect(ws.dismissed).toEqual([]);
  });

  it('keeps another repository’s closed agent until tmux no longer runs it', () => {
    const foreign = { repo: OTHER, branch: 'f', sessionName: 'f' };
    let ws = run({ type: 'sync-items', repo: REPO, foreign: [foreign] });
    ws = then(ws, { type: 'close', id: id('branch:f', OTHER) });
    ws = then(
      ws,
      sync([], undefined, REPO, { foreign: [foreign], ...alive('f') })
    );
    expect(ids(ws)).toEqual([]);
    // Its own repository open: no foreign listing names it, tmux does.
    ws = then(ws, sync([], undefined, OTHER, alive('f')));
    ws = then(ws, sync([], undefined, REPO, alive('f')));
    expect(ws.dismissed).toEqual([sessionKey(OTHER, 'f')]);
    ws = then(
      ws,
      sync([], undefined, REPO, { foreign: [foreign], ...alive('f') })
    );
    expect(ids(ws)).toEqual([]);
    ws = then(ws, sync([], undefined, REPO, { foreign: [], ...alive() }));
    expect(ws.dismissed).toEqual([]);
  });

  it('keeps a closed terminal of another machine until its listing has answered', () => {
    const name = JSON.stringify(['terminal', 'far-shell', 'peer']);
    const far = { ...shell(1, 'peer'), name };
    let ws = run(sync([], [far], REPO, { scanned: ['local', 'peer'] }), {
      type: 'close',
      id: terminalTabId(name),
    });
    ws = then(ws, sync([], [], REPO, { scanned: ['local'] }));
    expect(ws.dismissed).toEqual([terminalDismissKey(name, 1)]);
    ws = then(ws, sync([], [], REPO, { scanned: ['local', 'peer'] }));
    expect(ws.dismissed).toEqual([]);
  });

  it('dismisses a terminal by its session, so a later one of its name opens', () => {
    let ws = run(sync([], [shell(1)]), {
      type: 'close',
      id: terminalTabId('notes-shell'),
    });
    expect(ws.dismissed).toEqual([terminalDismissKey('notes-shell', 1)]);
    expect(ids(then(ws, sync([], [shell(1)])))).toEqual([]);
    ws = then(ws, sync([], [shell(2)]));
    expect(ids(ws)).toEqual([terminalTabId('notes-shell')]);
    expect(ws.dismissed).toEqual([]);
  });
});

describe('a restored terminal tab', () => {
  /** A workspace that went through the file, as a launch restores it. */
  const restored = (created: number, machine?: string) => {
    const saved = run(sync([], [shell(created, machine)]));
    const file = JSON.parse(JSON.stringify(toSaved(saved))) as SavedWorkspace;
    return restoreWorkspace(file);
  };
  const tab = (ws: Workspace) => view(ws).tabs[0];

  it('comes back restored, waiting for a listing', () => {
    expect(tab(restored(1))).toMatchObject({ restored: true, created: 1 });
  });

  it('binds to the session it was saved with', () => {
    const ws = then(restored(1), sync([], [shell(1)]));
    expect(tab(ws)).toMatchObject({ listed: true, created: 1 });
    expect(tab(ws)).not.toHaveProperty('restored');
  });

  it('closes when its name now belongs to a later session, which gets a tab of its own', () => {
    // Saved ahead of an item tab: a bound tab keeps its place, a new one
    // for the later session opens at the end.
    const saved = run(sync([], [shell(1)]), open('branch:a'));
    const file = JSON.parse(JSON.stringify(toSaved(saved))) as SavedWorkspace;
    const ws = then(restoreWorkspace(file), sync([], [shell(2)]));
    expect(ids(ws)).toEqual([id('branch:a'), terminalTabId('notes-shell')]);
    expect(view(ws).tabs[1]).toMatchObject({ created: 2, listed: true });
    expect(view(ws).tabs[1]).not.toHaveProperty('restored');
  });

  it('keeps its place when it binds', () => {
    const saved = run(sync([], [shell(1)]), open('branch:a'));
    const file = JSON.parse(JSON.stringify(toSaved(saved))) as SavedWorkspace;
    const ws = then(restoreWorkspace(file), sync([], [shell(1)]));
    expect(ids(ws)).toEqual([terminalTabId('notes-shell'), id('branch:a')]);
  });

  it('closes when a listing does not have it', () => {
    expect(ids(then(restored(1), sync([], [])))).toEqual([]);
  });

  it('waits on a listing that does not know the creation time yet, or no listing', () => {
    expect(tab(then(restored(1), sync([], [shell()])))).toMatchObject({
      restored: true,
    });
    expect(tab(then(restored(1), sync([])))).toMatchObject({ restored: true });
  });

  it('waits for another machine that has not answered', () => {
    const ws = then(restored(1, 'peer'), sync([], []));
    expect(tab(ws)).toMatchObject({ restored: true, machine: 'peer' });
  });

  it('closes on another machine once its listing has answered without it', () => {
    const ws = then(
      restored(1, 'peer'),
      sync([], [], REPO, { scanned: ['local', 'peer'] })
    );
    expect(ids(ws)).toEqual([]);
  });

  it('waits on a listing taken before this machine’s first scan finished', () => {
    const ws = then(restored(1), sync([], [], REPO, { scanned: [] }));
    expect(tab(ws)).toMatchObject({ restored: true });
  });

  it('gives way to a terminal the host just started under its name', () => {
    const ws = then(restored(1), {
      type: 'open-terminal',
      terminal: shell(5),
    });
    expect(tab(ws)).toMatchObject({ created: 5, listed: false });
    expect(tab(ws)).not.toHaveProperty('restored');
    expect(view(ws).activeId).toBe(terminalTabId('notes-shell'));
  });
});

describe('restoring a file', () => {
  const terminal = {
    id: terminalTabId('notes-shell'),
    kind: 'terminal',
    name: 'notes-shell',
    terminalKind: 'shell',
    cwd: '/home/dev/notes',
    displayPath: '~/notes',
    repo: null,
    created: 1,
    preview: false,
  };
  const item = {
    id: id('branch:a'),
    kind: 'item',
    repo: REPO,
    itemKey: 'branch:a',
    preview: false,
  };
  const file = (tabs: Record<string, unknown>, order: string[]) =>
    ({
      tabs,
      layout: { kind: 'pane', id: 'pane-1', order, activeId: null },
    } as SavedWorkspace);

  it('takes no tab from a name every object has', () => {
    const ws = restoreWorkspace(
      JSON.parse(
        '{"tabs":{},"layout":{"kind":"pane","id":"p","order":["constructor","toString"],"activeId":"constructor"},"pinned":["constructor"]}'
      ) as SavedWorkspace
    );
    expect(ids(ws)).toEqual([]);
    expect(ws.pinned).toEqual([]);
  });

  it('keeps tabs whose ids are their own', () => {
    const ws = restoreWorkspace(
      file({ [terminal.id]: terminal, [item.id]: item }, [terminal.id, item.id])
    );
    expect(ids(ws)).toEqual([terminal.id, item.id]);
  });

  it('drops a terminal tab whose id is not its session’s', () => {
    const wrong = { ...terminal, id: terminalTabId('other') };
    const ws = restoreWorkspace(file({ [wrong.id]: wrong }, [wrong.id]));
    expect(ids(ws)).toEqual([]);
  });

  it('drops an item tab whose id is not of its repository', () => {
    const wrong = { ...item, id: id('branch:a', OTHER) };
    const ws = restoreWorkspace(file({ [wrong.id]: wrong }, [wrong.id]));
    expect(ids(ws)).toEqual([]);
  });
});

describe('collapse choices', () => {
  it('keeps the latest, up to a limit', () => {
    let ws = EMPTY_WORKSPACE;
    for (let i = 0; i < COLLAPSED_LIMIT + 5; i++) {
      ws = then(ws, {
        type: 'set-collapsed',
        keys: [`k${i}`],
        collapsed: true,
      });
    }
    ws = then(ws, { type: 'set-collapsed', keys: ['k5'], collapsed: false });
    const keys = Object.keys(ws.collapsed);
    expect(keys).toHaveLength(COLLAPSED_LIMIT);
    expect(keys.at(-1)).toBe('k5');
    expect(keys[0]).toBe('k6');
    expect(Object.keys(restoreWorkspace(toSaved(ws)).collapsed)).toEqual(keys);
  });
});
