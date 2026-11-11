import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { itemTabId, tabHome, terminalTabId } from './tab-identity.js';
import {
  EMPTY_WORKSPACE,
  reduce as reduceWorkspace,
  reduceStrip as reduce,
  type ForeignSessionEntry,
  type ItemEntry,
  type Strip,
  type Tab,
  type TabsAction,
  type TerminalEntry,
  type Workspace,
} from './tabs-model.js';
import { dismissKeyOf } from './tab-identity.js';
import type { SyncListings } from './tabs-model.js';
import { restoreWorkspace, toSaved } from './workspace-file.js';
import { splitKey } from './layout.js';
import {
  focusedPaneOf,
  panesOf,
  stripOf,
  type LayoutNode,
} from './workspace.js';
import type { SavedWorkspace } from '../../../host/contract.js';

/**
 * Property tests for the tab reducer, alongside the worked cases in
 * tabs.spec.ts.
 *
 * Tabs are keyed by sidebar item, and a sidebar item is re-keyed under
 * the user mid-session: `branch:x` becomes `pr:42` the moment a pull
 * request appears on the branch, and goes back when it closes. Every
 * tab bug on this branch has come from that — a duplicate tab, a tab
 * stranded on a dead key, a tab whose pane unmounted and took a live
 * agent's terminal with it.
 *
 * So rather than adding more example sequences, these run arbitrary
 * ones and assert what has to hold after any of them. Sequences run
 * through the workspace reducer, as the app does; the properties about
 * a strip read the focused pane's (`view`), and the workspace's own
 * invariants — panes, pins, dismissals, the saved file — are at the
 * end.
 *
 * The strip also spans repositories — it keeps the tabs of the repo you
 * switched away from — and both repos below deliberately use the same
 * item keys, session names and branch names, because that is what two
 * checkouts of anything actually look like. Every sequence therefore
 * also asserts that one repo's sidebar poll cannot reach the other
 * repo's tabs.
 */

const KEYS = ['branch:a', 'branch:b', 'pr:1', 'pr:2'] as const;
const REPOS = ['/repos/alpha', '/repos/beta'] as const;

/**
 * Terminal tabs: two in plain folders (repo-less), one at each repo's
 * root. The repo-less ones are the interesting case — they are never
 * foreign, and no repository's sync may touch them.
 */
const TERMINALS: TerminalEntry[] = [
  {
    name: 'notes-shell',
    kind: 'shell',
    cwd: '/home/dev/notes',
    displayPath: '~/notes',
    repo: null,
    // Listed by discovery: what lets its tab be saved and restored.
    created: 1,
  },
  {
    name: 'scratch-agent',
    kind: 'agent',
    cwd: '/tmp/scratch',
    displayPath: '/tmp/scratch',
    repo: null,
  },
  ...REPOS.map(
    (repo, i): TerminalEntry => ({
      name: i === 0 ? `n10-shell` : `n10-shell-${i + 1}`,
      kind: 'shell',
      cwd: repo,
      displayPath: repo,
      repo,
    })
  ),
  // On another machine, whose listing may not have answered.
  {
    name: JSON.stringify(['terminal', 'far-shell', 'peer']),
    kind: 'shell',
    cwd: '/far',
    displayPath: '/far',
    repo: null,
    created: 2,
    machine: 'peer',
  },
];

/**
 * Agents alive in tmux as the host lists them for the strip: one per
 * repository, on the same branch names the sidebar entries use, so a
 * listing and that repository's own sync describe the same agent.
 */
const FOREIGN: ForeignSessionEntry[] = REPOS.map((repo) => ({
  repo,
  branch: 'a',
  sessionName: 'sa',
}));

/** Every id the actions below can name, in either repository. */
const IDS = [
  'settings',
  ...REPOS.flatMap((repo) => KEYS.map((k) => itemTabId(repo, k))),
  ...TERMINALS.map((t) => terminalTabId(t.name)),
];

/**
 * What the user does to the panes. None of them may open, close or
 * change a tab. Their tabs and panes are picks — `#n`, the nth tab open
 * or pane in the layout as the sequence reaches it (`picked`) — since
 * ids drawn blind would rarely name a tab that is open, and sequences
 * would almost never split.
 */
const EDGES = ['left', 'right', 'top', 'bottom'] as const;
const pick = fc.nat({ max: 9 }).map((n) => `#${n}`);
const picks = fc.uniqueArray(pick, { minLength: 1, maxLength: 3 });

const splitAction = fc.record({
  type: fc.constant('split' as const),
  ids: picks,
  target: pick,
  edge: fc.constantFrom(...EDGES),
  activate: fc.option(pick, { nil: undefined }),
});

const paneAction: fc.Arbitrary<TabsAction> = fc.oneof(
  { arbitrary: splitAction, weight: 4 },
  fc.record({
    type: fc.constant('move-to-pane' as const),
    ids: picks,
    pane: pick,
    anchor: fc.option(
      fc.record({
        targetId: pick,
        side: fc.constantFrom<'before' | 'after'>('before', 'after'),
      }),
      { nil: undefined }
    ),
  }),
  fc.record({ type: fc.constant('close-pane' as const), pane: pick }),
  fc.record({ type: fc.constant('focus-pane' as const), pane: pick }),
  fc.record({
    type: fc.constant('focus-toward' as const),
    edge: fc.constantFrom(...EDGES),
  }),
  fc.record({
    type: fc.constant('move-toward' as const),
    edge: fc.constantFrom(...EDGES),
  }),
  fc.record({
    type: fc.constant('resize-split' as const),
    key: pick,
    sizes: fc.array(fc.double({ min: 0.05, max: 1, noNaN: true }), {
      minLength: 2,
      maxLength: 3,
    }),
  }),
  ...superviseActions()
);

/** The supervising layouts (`supervise.ts`), over two groups. A follow
 *  pane shows the first tab it is given. */
function superviseActions(): fc.Arbitrary<TabsAction>[] {
  const key = fc.constantFrom('claude:a', 'claude:b');
  return [
    fc.record({
      type: fc.constant('tile-group' as const),
      pane: pick,
      key,
      home: pick,
      players: picks,
      edge: fc.constantFrom('right' as const, 'bottom' as const),
    }),
    fc
      .record({
        type: fc.constant('follow-group' as const),
        pane: pick,
        key,
        ids: picks,
        edge: fc.constantFrom('right' as const, 'bottom' as const),
      })
      .map((a) => ({ ...a, show: a.ids[0]! })),
    fc.record({ type: fc.constant('stop-following' as const), pane: pick }),
    fc.record({
      type: fc.constant('follow-show' as const),
      pane: pick,
      id: pick,
    }),
  ];
}

/** `a` with its picks (`#n`) read against `ws`: the nth open tab, pane
 *  or split, wrapping. Anything else is left as it is. */
function picked(ws: Workspace, a: TabsAction): TabsAction {
  const tabs = Object.keys(ws.tabs);
  const panes = panesOf(ws.layout).map((p) => p.id);
  const splits: string[] = [];
  const walk = (n: LayoutNode) => {
    if (n.kind === 'split') {
      splits.push(splitKey(n));
      n.children.forEach(walk);
    }
  };
  walk(ws.layout);
  const from = (list: string[]) => (v: string) => {
    const n = /^#(\d+)$/.exec(v);
    return n && list.length > 0 ? list[Number(n[1]) % list.length]! : v;
  };
  const tab = from(tabs);
  const pane = from(panes);
  switch (a.type) {
    case 'split':
      return {
        ...a,
        ids: a.ids.map(tab),
        target: pane(a.target),
        activate: a.activate && tab(a.activate),
      };
    case 'move-to-pane':
      return {
        ...a,
        ids: a.ids.map(tab),
        pane: pane(a.pane),
        anchor: a.anchor && { ...a.anchor, targetId: tab(a.anchor.targetId) },
      };
    case 'close-pane':
    case 'focus-pane':
    case 'stop-following':
      return { ...a, pane: pane(a.pane) };
    case 'tile-group':
      return {
        ...a,
        pane: pane(a.pane),
        home: tab(a.home),
        players: a.players.map(tab),
      };
    case 'follow-group':
      return {
        ...a,
        pane: pane(a.pane),
        ids: a.ids.map(tab),
        show: tab(a.show),
      };
    case 'follow-show':
      return { ...a, pane: pane(a.pane), id: tab(a.id) };
    case 'resize-split':
      return { ...a, key: from(splits)(a.key) };
    default:
      return a;
  }
}

const stripAction: fc.Arbitrary<TabsAction> = fc.oneof(
  fc.record({
    type: fc.constant('open-item' as const),
    repo: fc.constantFrom(...REPOS),
    itemKey: fc.constantFrom(...KEYS),
    preview: fc.boolean(),
  }),
  fc.record({ type: fc.constant('open-settings' as const) }),
  fc.record({
    type: fc.constant('open-terminal' as const),
    terminal: fc.constantFrom(...TERMINALS),
  }),
  fc.record({
    type: fc.constant('keep' as const),
    id: fc.constantFrom(...IDS),
  }),
  fc.record({
    type: fc.constant('set-pinned' as const),
    ids: fc.subarray([...IDS], { minLength: 1, maxLength: 3 }),
    pinned: fc.boolean(),
  }),
  fc.record({
    type: fc.constant('rename-group' as const),
    key: fc.constantFrom('place:/repos/alpha', 'claude:x'),
    name: fc.constantFrom('Ops', '  ', null),
  }),
  // A failed kill, or the user asking for a closed agent back.
  fc.record({
    type: fc.constant('undismiss' as const),
    keys: fc.subarray([
      terminalTabId('notes-shell'),
      `${REPOS[0].length}:${REPOS[0]}:sa`,
      `${REPOS[1].length}:${REPOS[1]}:sb`,
    ]),
  }),
  fc.record({
    type: fc.constant('activate' as const),
    id: fc.constantFrom(...IDS),
  }),
  fc.record({
    type: fc.constant('close' as const),
    id: fc.constantFrom(...IDS),
    repo: fc.constantFrom(...REPOS),
  }),
  fc.record({
    type: fc.constant('close-others' as const),
    id: fc.constantFrom(...IDS),
  }),
  fc.record({
    type: fc.constant('close-all' as const),
    repo: fc.constantFrom(...REPOS),
  }),
  // The host reporting a terminal's process ended, by name — the one
  // way a terminal tab closes without the user or a listing.
  fc.record({
    type: fc.constant('terminal-ended' as const),
    name: fc.constantFrom(...TERMINALS.map((t) => t.name)),
    repo: fc.constantFrom(...REPOS),
  }),
  // Switching repository. Included because it is the one action that
  // may leave nothing active, and because everything else has to keep
  // holding across it.
  fc.record({
    type: fc.constant('repo-opened' as const),
    repo: fc.constantFrom(...REPOS),
  }),
  // Drag-to-reorder. Included because a reorder that drops or
  // duplicates a tab breaks the same invariants everything else here
  // protects.
  fc.record({
    type: fc.constant('move' as const),
    ids: fc.subarray([...IDS], { minLength: 1 }),
    targetId: fc.constantFrom(...IDS),
    side: fc.constantFrom<'before' | 'after'>('before', 'after'),
  }),
  // The interesting one: the sidebar re-keying items underneath, and
  // agents coming and going on them — `sync-items` opens a tab for a
  // newly running agent and pins previews that have one, so those run
  // against the same invariants as everything else. The host's
  // terminal listing rides along on the same dispatch, as after a
  // restart or a scan — one action, one pure step.
  fc
    .record({
      repo: fc.constantFrom(...REPOS),
      entries: fc.array(
        fc.constantFrom<ItemEntry>(
          { itemKey: 'branch:a', branch: 'a' },
          { itemKey: 'pr:1', branch: 'a' },
          { itemKey: 'branch:b', branch: 'b' },
          { itemKey: 'pr:2', branch: 'b' },
          {
            itemKey: 'branch:a',
            branch: 'a',
            sessionName: 'sa',
            running: true,
          },
          { itemKey: 'pr:1', branch: 'a', sessionName: 'sa', running: true },
          {
            itemKey: 'branch:b',
            branch: 'b',
            sessionName: 'sb',
            running: true,
          },
          { itemKey: 'pr:2', branch: 'b', sessionName: 'sb', running: true },
          // A worktree that has a session name but no live agent — the
          // shape that once pinned every preview tab on sight.
          { itemKey: 'branch:a', branch: 'a', sessionName: 'sa' }
        ),
        { maxLength: 4 }
      ),
      // Each listing may not have answered yet.
      loaded: fc.boolean(),
      terminals: fc.option(
        fc.uniqueArray(fc.constantFrom(...TERMINALS), { maxLength: 4 }),
        { nil: undefined, freq: 4 }
      ),
      foreign: fc.option(
        fc.uniqueArray(fc.constantFrom(...FOREIGN), { maxLength: 2 }),
        { nil: undefined, freq: 4 }
      ),
      // Which agents tmux runs, and which machines' terminal listings
      // are complete: this one's whenever there is a listing at all.
      alive: fc.option(fc.subarray(['sa', 'sb']), { nil: undefined, freq: 4 }),
      scanned: fc.constantFrom(undefined, ['local'], ['local', 'peer']),
    })
    .map(({ repo, entries, loaded, terminals, foreign, alive, scanned }) => ({
      type: 'sync-items' as const,
      repo,
      entries: loaded ? entries : undefined,
      terminals,
      foreign,
      alive,
      scanned,
    }))
);

// Strip actions as often as before, a pane action in between now and
// then, so sequences run across every shape of layout.
const action: fc.Arbitrary<TabsAction> = fc.oneof(
  { arbitrary: stripAction, weight: 3 },
  { arbitrary: paneAction, weight: 1 }
);

/** The focused pane's strip: what every property below reads. */
const view = (ws: Workspace): Strip => stripOf(ws, focusedPaneOf(ws).id);

/**
 * Replay a sequence the way the app dispatches one.
 *
 * Every repo-carrying action names the repository *in view* — the
 * components dispatching them read it from context, and only a repo
 * switch changes which that is. Letting the generator pick those repos
 * independently manufactures states the app cannot reach (a sidebar
 * poll for a repository nobody is looking at, a close naming one the
 * user is not in), and the invariants below are about reachable
 * states. So the in-view repo is tracked here and substituted in.
 *
 * Cross-repo adversity is not lost: `repo-opened` still switches the
 * repo mid-sequence, and the properties that deliberately aim one
 * action at a *foreign* repo apply it to the finished state themselves.
 */
const inViewOf = (a: TabsAction, repo: string): TabsAction =>
  a.type === 'open-item' ||
  a.type === 'sync-items' ||
  a.type === 'close' ||
  a.type === 'close-all' ||
  a.type === 'terminal-ended'
    ? { ...a, repo }
    : a;

const replayWorkspace = (
  actions: TabsAction[],
  from: Workspace = EMPTY_WORKSPACE
): { ws: Workspace; inView: string } => {
  // The app has a repo open before the strip exists: `Gate` announces
  // one on mount, so there is no "no repo in view" state to model.
  let inView: string = REPOS[0];
  let ws = from;
  for (const a of actions) {
    if (a.type === 'repo-opened') inView = a.repo;
    ws = reduceWorkspace(ws, picked(ws, inViewOf(a, inView)));
  }
  return { ws, inView };
};

const replay = (actions: TabsAction[]): { state: Strip; inView: string } => {
  const { ws, inView } = replayWorkspace(actions);
  return { state: view(ws), inView };
};

const run = (actions: TabsAction[]): Strip => replay(actions).state;

/**
 * Most sequences start from a workspace worth splitting: tabs open in
 * both repositories, then a few splits of one tab each. Left to chance,
 * a strip rarely holds the two tabs a split needs, and the layout
 * properties would see a multi-pane tree in one sequence in twenty.
 */
const openIn = (repo: string) => (itemKey: string) =>
  ({ type: 'open-item', repo, itemKey, preview: false } as const);
const seed: fc.Arbitrary<TabsAction[]> = fc
  .tuple(
    fc.shuffledSubarray([...KEYS], { minLength: 3, maxLength: 4 }),
    fc.shuffledSubarray([...KEYS], { minLength: 2, maxLength: 4 }),
    fc.array(
      fc.record({
        type: fc.constant('split' as const),
        ids: pick.map((p) => [p]),
        target: pick,
        edge: fc.constantFrom(...EDGES),
      }),
      { minLength: 2, maxLength: 4 }
    )
  )
  .map(([here, there, splits]) => [
    ...here.map(openIn(REPOS[0])),
    { type: 'repo-opened', repo: REPOS[1] } as const,
    ...there.map(openIn(REPOS[1])),
    ...splits,
  ]);

const sequence = fc.oneof(
  {
    arbitrary: fc
      .tuple(seed, fc.array(action, { maxLength: 20 }))
      .map(([start, rest]) => [...start, ...rest]),
    weight: 3,
  },
  { arbitrary: fc.array(action, { maxLength: 25 }), weight: 1 }
);

describe('tab reducer invariants', () => {
  it('never holds two tabs for the same item', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        // Repo-qualified: the same item key in two repositories is two
        // items, and both are entitled to a tab.
        const keys = run(actions)
          .tabs.filter((t) => t.kind === 'item')
          .map((t) => itemTabId(t.repo, t.itemKey));
        // A re-key that produced a second tab for one item is exactly
        // the duplicate-tab bug.
        expect(new Set(keys).size).toBe(keys.length);
      }),
      { numRuns: 500 }
    );
  });

  it('never lets a tab change repository', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        for (const t of run(actions).tabs) {
          if (t.kind !== 'item') continue;
          // Re-keying keeps the id a tab was opened with, so the id is
          // the record of which repo opened it. A tab whose `repo` and
          // id disagree has been followed across repositories — onto
          // another checkout's branch of the same name.
          expect(t.id.startsWith(itemTabId(t.repo, ''))).toBe(true);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('never holds two tabs with the same id', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const ids = run(actions).tabs.map((t) => t.id);
        // React keys panes by tab id.
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 500 }
    );
  });

  it('always points activeId at a tab that exists', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const { tabs, activeId } = run(actions);
        if (activeId === null) return;
        // A dangling activeId renders an empty editor area with tabs
        // still in the strip.
        expect(tabs.some((t) => t.id === activeId)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('marks unseen only open tabs, once each, and never one a pane shows', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const { ws } = replayWorkspace(actions);
        const shown = new Set(panesOf(ws.layout).map((p) => p.activeId));
        expect(new Set(ws.unseen).size).toBe(ws.unseen.length);
        for (const id of ws.unseen) {
          expect(ws.tabs[id]).toBeDefined();
          expect(shown.has(id)).toBe(false);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('a sole pane goes without an active tab only when the repo in view has none', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const { ws, inView } = replayWorkspace(actions);
        // With panes, focus moving onto a pane keeps the selection it had,
        // none included (docs/decisions.md, "A pane keeps its selection").
        if (panesOf(ws.layout).length !== 1) return;
        const state = view(ws);
        if (state.activeId !== null) return;
        // Nothing active is legitimate in exactly one situation: the
        // repository in view has no tab on the strip, so the editor
        // shows its empty state while other repos' tabs stay put.
        // Anywhere else it is a blank editor area with tabs above it.
        const own = state.tabs.filter(
          (t) => t.kind === 'item' && t.repo === inView
        );
        expect(own).toEqual([]);
      }),
      { numRuns: 500 }
    );
  });

  // Counterexample seed -162001443, path 326:4:3:3:3:6:0:3:3:2:1:4:2:2:7.
  // Focus returning to a pane keeps its blank selection, even when it
  // still holds a tab of the repository in view.
  it('keeps a focused pane blank after a repo switch and close', () => {
    const open = (repo: string, itemKey: string): TabsAction => ({
      type: 'open-item',
      repo,
      itemKey,
      preview: false,
    });
    const split = (edge: 'left' | 'bottom'): TabsAction => ({
      type: 'split',
      ids: ['#0'],
      target: '#0',
      edge,
    });
    const actions: TabsAction[] = [
      open(REPOS[0], 'branch:b'),
      open(REPOS[0], 'branch:a'),
      open(REPOS[0], 'pr:2'),
      { type: 'repo-opened', repo: REPOS[1] },
      open(REPOS[1], 'pr:2'),
      open(REPOS[1], 'branch:b'),
      split('left'),
      split('left'),
      {
        type: 'open-terminal',
        terminal: {
          name: 'n10-shell-2',
          kind: 'shell',
          cwd: REPOS[1],
          displayPath: REPOS[1],
          repo: REPOS[1],
        },
      },
      { type: 'close', id: 'terminal:n10-shell-2', repo: REPOS[0] },
      split('bottom'),
      { type: 'repo-opened', repo: REPOS[0] },
      { type: 'focus-pane', pane: '#0' },
    ];
    const { ws, inView } = replayWorkspace(actions);
    const focused = focusedPaneOf(ws);
    expect(focused.activeId).toBeNull();
    expect(
      focused.order.some(
        (id) => ws.tabs[id]?.kind === 'item' && ws.tabs[id]?.repo === inView
      )
    ).toBe(true);
  });

  it('activates one of a repository’s own tabs when it comes into view', () => {
    fc.assert(
      fc.property(sequence, fc.constantFrom(...REPOS), (actions, repo) => {
        const state = reduce(run(actions), { type: 'repo-opened', repo });
        const own = state.tabs.filter(
          (t) => t.kind !== 'settings' && t.repo === repo
        );
        if (own.length === 0) return;
        const active = state.tabs.find((t) => t.id === state.activeId);
        // Either one of this repo's tabs, or a tab that belongs to
        // nobody — settings, a plain-folder terminal — which is never
        // displaced by a switch.
        const home = active === undefined ? null : tabHome(active);
        expect(home === null || home === repo).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('returns a repository to the tab it was left on', () => {
    fc.assert(
      fc.property(sequence, fc.constantFrom(...REPOS), (actions, away) => {
        const before = run(actions);
        const active = before.tabs.find((t) => t.id === before.activeId);
        if (active?.kind !== 'item' || active.repo === away) return;
        // Leave for the other repository and come back.
        const there = reduce(before, { type: 'repo-opened', repo: away });
        const back = reduce(there, { type: 'repo-opened', repo: active.repo });
        expect(back.activeId).toBe(before.activeId);
      }),
      { numRuns: 300 }
    );
  });

  it('keeps at most one preview tab per repository', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        for (const repo of REPOS) {
          const previews = run(actions).tabs.filter(
            (t) => t.preview && t.kind === 'item' && t.repo === repo
          );
          // Two preview tabs in one repo means the next single click
          // there replaces an unpredictable one of them. Across repos
          // they are independent: a click here must not swallow a tab
          // the user can no longer see.
          expect(previews.length).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('never opens more than one settings tab', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const settings = run(actions).tabs.filter((t) => t.kind === 'settings');
        expect(settings.length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 }
    );
  });
});

describe('one repository cannot reach another', () => {
  /** The strip as the repos *other* than `repo` see it. */
  const foreign = (state: Strip, repo: string): Tab[] =>
    state.tabs.filter((t) => t.kind === 'item' && t.repo !== repo);

  it('leaves every other repo’s tabs exactly as they were on sync', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.constantFrom(...REPOS),
        fc.array(
          fc.constantFrom<ItemEntry>(
            { itemKey: 'branch:a', branch: 'a' },
            { itemKey: 'pr:1', branch: 'a', sessionName: 'sa', running: true },
            { itemKey: 'branch:b', branch: 'b', sessionName: 'sb' }
          ),
          { maxLength: 4 }
        ),
        (actions, repo, entries) => {
          const before = run(actions);
          const after = reduce(before, {
            type: 'sync-items',
            repo,
            entries,
            terminals: [],
          });
          // Identity, not equality: a foreign tab that came out
          // re-keyed, re-pinned or merely rebuilt has been touched by a
          // poll about a repository it has nothing to do with.
          expect(foreign(after, repo)).toEqual(foreign(before, repo));
          for (const [i, t] of foreign(after, repo).entries()) {
            expect(t).toBe(foreign(before, repo)[i]);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('never drops a tab belonging to a repository it was not told about', () => {
    fc.assert(
      fc.property(sequence, fc.constantFrom(...REPOS), (actions, repo) => {
        const before = run(actions);
        const after = reduce(before, {
          type: 'sync-items',
          repo,
          entries: [],
          terminals: [],
        });
        // An empty sidebar over here is not a reason to close tabs
        // over there — their agents are still running.
        expect(foreign(after, repo).length).toBe(foreign(before, repo).length);
      }),
      { numRuns: 300 }
    );
  });
});

describe('closing never hands focus to another repository', () => {
  /**
   * A close only decides focus when it closes the *active* tab —
   * otherwise activeId is left exactly where it was, foreign or not
   * (activating a foreign tab is how the user switches repository in
   * the first place). So both properties below are about the move.
   */
  const closeAndMove = (
    actions: TabsAction[],
    id: string,
    repo: string
  ): Strip | null => {
    const { ws } = replayWorkspace(actions);
    const after = reduceWorkspace(ws, { type: 'close', id, repo });
    // A pane its last tab left goes, and focus with it: that is the
    // neighbour's own tab, not a choice the close made.
    if (after.focusedPane !== ws.focusedPane) return null;
    return view(after).activeId === view(ws).activeId ? null : view(after);
  };

  it('never moves focus onto a tab outside the repo the close named', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.constantFrom(...IDS),
        fc.constantFrom(...REPOS),
        (actions, id, repo) => {
          const after = closeAndMove(actions, id, repo);
          const active = after?.tabs.find((t) => t.id === after.activeId);
          if (active === undefined || active.kind === 'settings') return;
          // A plain-folder terminal belongs to nobody, so focus may
          // land on it from anywhere.
          if (active.kind === 'terminal' && active.repo === null) return;
          // Focus is what the workspace follows, so a close that hands
          // it across a repository boundary switches the sidebar, the
          // status bar and every query — because the user shut a tab.
          expect(active.repo).toBe(repo);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('goes to nothing rather than abroad when the repo runs out of tabs', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.constantFrom(...IDS),
        fc.constantFrom(...REPOS),
        (actions, id, repo) => {
          const after = closeAndMove(actions, id, repo);
          if (after === null || after.activeId !== null) return;
          const own = after.tabs.filter(
            (t) => t.kind === 'item' && t.repo === repo
          );
          expect(own).toEqual([]);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('a reconciliation never hands focus to another repository', () => {
  it('leaves the focused pane on its repository, or on nothing', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const { ws, inView } = replayWorkspace(actions);
        const after = reduceWorkspace(ws, {
          type: 'sync-items',
          repo: inView,
          entries: [],
          terminals: [],
          scanned: ['local', 'peer'],
        });
        // A pane its last tab left goes, and focus with it.
        if (after.focusedPane !== ws.focusedPane) return;
        const before = view(ws).activeId;
        const now = view(after);
        if (before === null || now.activeId === before) return;
        if (now.tabs.some((t) => t.id === before)) return;
        const active = now.tabs.find((t) => t.id === now.activeId);
        if (active === undefined || active.kind === 'settings') return;
        if (active.kind === 'terminal' && active.repo === null) return;
        // Its active tab closed in the background: what replaces it is
        // of the repository in view, or the pane shows nothing.
        expect(active.repo).toBe(inView);
      }),
      { numRuns: 500 }
    );
  });
});

describe('terminal tabs', () => {
  it('never holds two tabs for the same terminal', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const names = run(actions)
          .tabs.filter((t) => t.kind === 'terminal')
          .map((t) => t.name);
        // One session, one tab: two would render the same PTY twice
        // and close it out from under each other.
        expect(new Set(names).size).toBe(names.length);
      }),
      { numRuns: 500 }
    );
  });

  it('is never re-keyed, pinned or collapsed by any repository’s sync', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.constantFrom(...REPOS),
        fc.array(
          fc.constantFrom<ItemEntry>(
            { itemKey: 'branch:a', branch: 'a' },
            { itemKey: 'pr:1', branch: 'a', sessionName: 'sa', running: true },
            { itemKey: 'branch:b', branch: 'b', sessionName: 'sb' }
          ),
          { maxLength: 4 }
        ),
        (actions, repo, entries) => {
          const before = run(actions);
          // A sidebar poll with no terminal listing on it: the item
          // passes alone, which must not reach a terminal tab.
          const after = reduce(before, {
            type: 'sync-items',
            repo,
            entries,
            terminals: undefined,
          });
          const terminals = (s: Strip) =>
            s.tabs.filter((t) => t.kind === 'terminal');
          // Identity, not equality: a terminal tab that came out rebuilt
          // has been reconciled against a sidebar it has no row in.
          expect(terminals(after).length).toBe(terminals(before).length);
          for (const [i, t] of terminals(after).entries()) {
            expect(t).toBe(terminals(before)[i]);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('never moves focus on a listing unless the listing ended the active tab', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.uniqueArray(fc.constantFrom(...TERMINALS), { maxLength: 4 }),
        (actions, terminals) => {
          const before = run(actions);
          // Terminals ride along on `sync-items`; an empty `entries` list
          // is a no-op for the item passes, so this is exactly the
          // dispatch a terminal-only listing produces.
          const after = reduce(before, {
            type: 'sync-items',
            repo: REPOS[0],
            entries: [],
            terminals,
          });
          // A restored terminal from another repository would otherwise
          // switch the workspace at startup. The one listing that may
          // move focus is one that closed the active tab, since its
          // terminal ended — and then focus follows the close rules,
          // asserted with every other close above.
          const stillThere = after.tabs.some((t) => t.id === before.activeId);
          const moved = after.activeId !== before.activeId;
          expect(stillThere && moved).toBe(false);
        }
      ),
      { numRuns: 300 }
    );
  });

  // The host's word that a terminal ended is final, listed or not: no
  // tab for that name survives it, and no other tab is touched.
  it('holds no tab for a terminal the host said ended, and every other tab as it was', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.constantFrom(...TERMINALS.map((t) => t.name)),
        (actions, name) => {
          const { state: before, inView } = replay(actions);
          const after = reduce(before, {
            type: 'terminal-ended',
            name,
            repo: inView,
          });
          expect(
            after.tabs.some((t) => t.kind === 'terminal' && t.name === name)
          ).toBe(false);
          const rest = before.tabs.filter(
            (t) => !(t.kind === 'terminal' && t.name === name)
          );
          expect(after.tabs.length).toBe(rest.length);
          for (const [i, t] of after.tabs.entries()) {
            expect(t).toBe(rest[i]);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  // The listing is the only word on which terminals exist. After any
  // sync that carries one, a terminal tab it does not name is a tab
  // for a process that has ended — a shell that exited, a tmux session
  // killed from outside — and must be gone; one it does name is
  // untouched, so a quiet poll cannot remount a live shell's pane. The
  // one exception is a terminal no listing has ever named: the tab
  // opened on the launch's own answer, and a listing fetched before
  // the terminal existed has not seen it end.
  it('holds no terminal tab a listing named and this one does not, and every one it does', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.constantFrom(...REPOS),
        fc.uniqueArray(fc.constantFrom(...TERMINALS), { maxLength: 4 }),
        (actions, repo, terminals) => {
          const before = run(actions);
          const after = reduce(before, {
            type: 'sync-items',
            repo,
            entries: [],
            terminals,
          });
          const listed = new Set(terminals.map((t) => t.name));
          const open = (s: Strip) =>
            s.tabs.filter((t) => t.kind === 'terminal');
          // A surviving tab is either named by this listing, or has
          // never been named by one since it opened (`listed` is the
          // tab's own record of that, stamped by every listing).
          for (const t of open(after)) {
            expect(listed.has(t.name) || !t.listed).toBe(true);
          }
          // …and a named tab is the same object as before, once a
          // listing has stamped it (the first stamp is the one change).
          for (const t of open(before)) {
            if (!listed.has(t.name)) continue;
            const kept = open(after).find((a) => a.id === t.id);
            expect(t.listed ? kept : kept?.id).toBe(t.listed ? t : t.id);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('re-keying preserves the tab', () => {
  /** Every way the sidebar can describe branch `a`. */
  const keyForA = fc.constantFrom('branch:a', 'pr:1');

  it('keeps one tab through any number of key changes', () => {
    fc.assert(
      fc.property(fc.array(keyForA, { minLength: 1, maxLength: 6 }), (keys) => {
        let state = reduce(view(EMPTY_WORKSPACE), {
          type: 'open-item',
          repo: REPOS[0],
          itemKey: keys[0],
          preview: false,
        });
        const openedId = state.tabs[0].id;

        for (const key of keys) {
          state = reduce(state, {
            type: 'sync-items',
            repo: REPOS[0],
            entries: [{ itemKey: key, branch: 'a' }],
            terminals: [],
          });
        }

        // A pull request opening and closing repeatedly must leave one
        // tab, still the one the user opened — its id is what keeps a
        // live agent's terminal pane mounted.
        expect(state.tabs).toHaveLength(1);
        expect(state.tabs[0].id).toBe(openedId);
        expect(state.tabs[0].kind === 'item' && state.tabs[0].itemKey).toBe(
          keys[keys.length - 1]
        );
      }),
      { numRuns: 300 }
    );
  });

  it('stamps the branch so a stale key can still be resolved', () => {
    fc.assert(
      fc.property(keyForA, (key) => {
        let state = reduce(view(EMPTY_WORKSPACE), {
          type: 'open-item',
          repo: REPOS[0],
          itemKey: key,
          preview: false,
        });
        state = reduce(state, {
          type: 'sync-items',
          repo: REPOS[0],
          entries: [{ itemKey: key, branch: 'a' }],
          terminals: [],
        });
        // EditorArea and the close-tab path both fall back to this when
        // the key does not resolve during the render before sync-items
        // catches up.
        expect(state.tabs[0].kind === 'item' && state.tabs[0].branch).toBe('a');
      }),
      { numRuns: 100 }
    );
  });

  it('merges rather than duplicates when both keys are open at once', () => {
    // Opening a branch tab and its PR tab separately, then syncing, has
    // to collapse them — they are one item.
    let state = reduce(view(EMPTY_WORKSPACE), {
      type: 'open-item',
      repo: REPOS[0],
      itemKey: 'branch:a',
      preview: false,
    });
    state = reduce(state, {
      type: 'open-item',
      repo: REPOS[0],
      itemKey: 'pr:1',
      preview: false,
    });
    expect(state.tabs).toHaveLength(2);

    state = reduce(state, {
      type: 'sync-items',
      repo: REPOS[0],
      entries: [{ itemKey: 'pr:1', branch: 'a' }],
      terminals: [],
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs.some((t) => t.id === state.activeId)).toBe(true);
  });
});

describe('agents alive in other repositories', () => {
  // The listing restores tabs at launch; it must never take the user
  // anywhere — not to another repository, and not off the tab they
  // are on — and never speak for the repository in view.
  it('never moves focus, and never opens a tab in the repo in view', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.uniqueArray(fc.constantFrom(...FOREIGN), { maxLength: 2 }),
        (actions, foreign) => {
          const { state: before, inView } = replay(actions);
          const after = reduce(before, {
            type: 'sync-items',
            repo: inView,
            entries: [],
            foreign,
          });
          expect(after.activeId).toBe(before.activeId);
          const own = (s: Strip) =>
            s.tabs.filter((t) => t.kind === 'item' && t.repo === inView);
          expect(own(after).length).toBe(own(before).length);
        }
      ),
      { numRuns: 500 }
    );
  });
});

describe('the workspace', () => {
  const sequenceWs = (actions: TabsAction[]) => replayWorkspace(actions).ws;

  /** Every split well formed, at any depth: two or more children, none
   *  a split running its way, and positive sizes that sum to one, one
   *  per child. */
  const wellFormed = (node: LayoutNode): boolean =>
    node.kind === 'pane' ||
    (node.children.length >= 2 &&
      node.children.every(
        (c) => c.kind === 'pane' || c.direction !== node.direction
      ) &&
      node.sizes.length === node.children.length &&
      node.sizes.every((size) => size > 0) &&
      Math.abs(node.sizes.reduce((a, b) => a + b, 0) - 1) < 1e-9 &&
      node.children.every(wellFormed));

  it('holds every tab in exactly one pane, and nothing a pane does not', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const ws = sequenceWs(actions);
        const placed = panesOf(ws.layout).flatMap((p) => p.order);
        expect(new Set(placed).size).toBe(placed.length);
        expect([...placed].sort()).toEqual(Object.keys(ws.tabs).sort());
      }),
      { numRuns: 500 }
    );
  });

  it('follows a group from live panes only, one each, with tabs they hold', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const ws = sequenceWs(actions);
        const panes = panesOf(ws.layout);
        const entries = Object.entries(ws.follows);
        expect(panes.length > 1 || entries.length === 0).toBe(true);
        const keys = entries.map(([, f]) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
        for (const [id, f] of entries) {
          const pane = panes.find((p) => p.id === id);
          expect(pane).toBeDefined();
          expect(f.ids.length).toBeGreaterThan(0);
          for (const t of f.ids) {
            expect(pane!.order).toContain(t);
            expect(ws.pinned).not.toContain(t);
          }
        }
      }),
      { numRuns: 500 }
    );
  });

  it('switches a follow pane without moving focus or any tab', () => {
    fc.assert(
      fc.property(sequence, pick, pick, (actions, p, t) => {
        const ws = sequenceWs(actions);
        const show = picked(ws, { type: 'follow-show', pane: p, id: t });
        const after = reduceWorkspace(ws, show);
        expect(after.focusedPane).toBe(ws.focusedPane);
        expect(panesOf(after.layout).map((x) => x.order)).toEqual(
          panesOf(ws.layout).map((x) => x.order)
        );
        expect(after.follows).toEqual(ws.follows);
      }),
      { numRuns: 300 }
    );
  });

  it('keeps its layout well formed, with an empty pane only as the sole one', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const ws = sequenceWs(actions);
        const panes = panesOf(ws.layout);
        expect(wellFormed(ws.layout)).toBe(true);
        expect(new Set(panes.map((p) => p.id)).size).toBe(panes.length);
        // Every split named, each name once: React keys panes by them.
        const splits: (string | undefined)[] = [];
        const walk = (n: LayoutNode) => {
          if (n.kind === 'pane') return;
          splits.push(n.id);
          n.children.forEach(walk);
        };
        walk(ws.layout);
        expect(splits.every((id) => id !== undefined)).toBe(true);
        expect(new Set(splits).size).toBe(splits.length);
        expect(panes.some((p) => p.id === ws.focusedPane)).toBe(true);
        const empties = panes.filter((p) => p.order.length === 0);
        expect(empties.length === 0 || panes.length === 1).toBe(true);
        for (const p of panes) {
          expect(p.activeId === null || p.order.includes(p.activeId)).toBe(
            true
          );
        }
      }),
      { numRuns: 500 }
    );
  });

  it('never opens, closes or changes a tab for what is done to the panes', () => {
    fc.assert(
      fc.property(sequence, paneAction, (actions, a) => {
        const ws = sequenceWs(actions);
        const after = reduceWorkspace(ws, picked(ws, a));
        expect(after.tabs).toEqual(ws.tabs);
        expect(after.pinned).toEqual(ws.pinned);
        expect(after.dismissed).toEqual(ws.dismissed);
      }),
      { numRuns: 500 }
    );
  });

  it('pins only tabs it holds, each once', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const ws = sequenceWs(actions);
        expect(new Set(ws.pinned).size).toBe(ws.pinned.length);
        for (const id of ws.pinned) expect(ws.tabs[id]).toBeDefined();
      }),
      { numRuns: 500 }
    );
  });

  it('keeps every pinned tab through Close Others and Close All', () => {
    fc.assert(
      fc.property(
        sequence,
        fc.constantFrom(...IDS),
        fc.boolean(),
        (actions, id, all) => {
          const { ws, inView } = replayWorkspace(actions);
          const after = reduceWorkspace(
            ws,
            all
              ? { type: 'close-all', repo: inView }
              : { type: 'close-others', id }
          );
          for (const pinned of ws.pinned) {
            expect(after.tabs[pinned]).toBe(ws.tabs[pinned]);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('dismisses no session that has a tab, once a sync has run', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const { ws, inView } = replayWorkspace(actions);
        const after = reduceWorkspace(ws, {
          type: 'sync-items',
          repo: inView,
          entries: [],
        });
        const open = new Set(Object.values(after.tabs).map(dismissKeyOf));
        for (const key of after.dismissed) expect(open.has(key)).toBe(false);
      }),
      { numRuns: 300 }
    );
  });

  // Bounded: a dismissal lasts only as long as the listings that speak
  // for its session still have it alive.
  it('dismisses nothing the listings say has ended', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const { ws, inView } = replayWorkspace(actions);
        const after = reduceWorkspace(ws, {
          type: 'sync-items',
          repo: inView,
          entries: [],
          terminals: [],
          foreign: [],
          alive: [],
          scanned: ['local', 'peer'],
        });
        expect(after.dismissed).toEqual([]);
      }),
      { numRuns: 300 }
    );
  });

  // The converse, and what keeps a closed tab closed: a dismissal is
  // never forgotten while its session runs, nor on the word of a
  // listing that has not answered, or is not complete for its machine.
  it('forgets no dismissal while its session runs, or nothing says it ended', () => {
    const ended = fc.constantFrom<Omit<SyncListings, 'entries'>>(
      // Everything alive: tmux runs every agent, every terminal listed.
      { alive: ['sa', 'sb'], terminals: TERMINALS, scanned: ['local', 'peer'] },
      // Nothing has answered.
      {},
      // This machine's listing is not complete, nor the peer's.
      { terminals: [], scanned: [] }
    );
    fc.assert(
      fc.property(sequence, ended, (actions, listings) => {
        const { ws, inView } = replayWorkspace(actions);
        // A terminal listing that names everything opens tabs on what
        // is not dismissed; those keys were not dismissed to begin with.
        const after = reduceWorkspace(ws, {
          type: 'sync-items',
          repo: inView,
          ...listings,
        });
        const open = new Set(Object.values(after.tabs).map(dismissKeyOf));
        const closed = ws.dismissed.filter((key) => !open.has(key));
        expect(after.dismissed).toEqual(expect.arrayContaining(closed));
      }),
      { numRuns: 300 }
    );
  });

  // After a restart: a restored terminal tab binds to its own session or
  // waits; only a listing complete for its machine can close it.
  it('keeps every restored terminal tab through listings that are not complete', () => {
    const incomplete = fc.constantFrom<SyncListings>(
      { entries: [], terminals: [], scanned: [] },
      { entries: [], terminals: [] },
      { entries: [] }
    );
    fc.assert(
      fc.property(sequence, incomplete, (actions, listings) => {
        const { ws, inView } = replayWorkspace(actions);
        const file = JSON.parse(JSON.stringify(toSaved(ws))) as SavedWorkspace;
        const back = restoreWorkspace(file);
        const after = reduceWorkspace(back, {
          type: 'sync-items',
          repo: inView,
          ...listings,
        });
        // The default completes this machine's listing, not a peer's.
        const waiting = Object.values(back.tabs).filter(
          (tab) =>
            tab.kind === 'terminal' &&
            !(listings.terminals && !listings.scanned && tab.machine !== 'peer')
        );
        expect(waiting.map((tab) => after.tabs[tab.id])).toEqual(waiting);
      }),
      { numRuns: 300 }
    );
  });

  it('comes back from its saved file as it was, less what is not saved', () => {
    fc.assert(
      fc.property(sequence, (actions) => {
        const ws = sequenceWs(actions);
        const file = JSON.parse(JSON.stringify(toSaved(ws))) as SavedWorkspace;
        const back = restoreWorkspace(file);
        // A terminal tab no listing has dated is not saved.
        const saved = (id: string) => {
          const t = ws.tabs[id];
          return t.kind !== 'terminal' || t.created !== undefined;
        };
        // Each pane with a saved tab comes back with its saved tabs in
        // order, showing the one it showed; a pane left without goes.
        const panes = panesOf(ws.layout)
          .map((p) => ({
            id: p.id,
            order: p.order.filter(saved),
            activeId: p.activeId && saved(p.activeId) ? p.activeId : null,
          }))
          .filter((p) => p.order.length > 0);
        const restored = panesOf(back.layout).map((p) => ({
          id: p.id,
          order: p.order,
          activeId: p.activeId,
        }));
        expect(restored).toEqual(
          panes.length > 0
            ? panes
            : [{ id: 'pane-1', order: [], activeId: null }]
        );
        const focusKept = panes.some((p) => p.id === ws.focusedPane);
        expect(back.focusedPane === ws.focusedPane || !focusKept).toBe(true);
        expect(back.pinned).toEqual(ws.pinned.filter(saved));
        expect(back.groupNames).toEqual(ws.groupNames);
        expect(back.dismissed).toEqual(ws.dismissed);
        expect(back.lastActiveByRepo).toEqual(ws.lastActiveByRepo);
        expect(back.unseen).toEqual([]);
        const terminals = view(back).tabs.filter((t) => t.kind === 'terminal');
        expect(terminals.every((t) => t.restored)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });
});
