import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as TerminalsModule from './terminals.js';

/** Exercise the desktop relay and presentation adapter over the real engine
 * lifecycle, with controlled filesystem and terminal primitives. */

const state = vi.hoisted(() => ({
  alive: new Set<string>(),
  spawns: [] as {
    name: string;
    kind: string;
    cwd: string;
    cols: number;
    rows: number;
    config: unknown;
  }[],
  /** Names tmux still holds a session for when their client exits. */
  tmuxHolds: new Set<string>(),
  broadcasts: [] as { channel: string; payload: unknown }[],
  killed: [] as string[],
  released: [] as string[],
  onData: new Map<string, (data: string) => void>(),
  onExit: new Map<string, ((code: number) => void)[]>(),
  // One session object per spawn, as the registry holds one entry per
  // spawn: the host tells a session's exit from a successor's by
  // identity, so the mock must not hand out a fresh object per read.
  sessions: new Map<string, { exited: boolean; pty: unknown }>(),
  repoRoots: new Set<string>(),
  recents: [] as string[],
  nextId: 0,
  modes: [] as ('open' | 'attach' | undefined)[],
  allocatedName: undefined as string | undefined,
}));

vi.mock('node:fs', () => ({
  statSync: () => ({ isDirectory: () => true }),
}));

vi.mock('./recent-repos.js', () => ({
  ensureRecent: (cwd: string) => {
    if (!state.recents.includes(cwd)) state.recents.push(cwd);
  },
}));

vi.mock('@n10/vcs-core', () => ({
  readConfig: (cwd: string) => ({ fromCwd: cwd }),
}));

vi.mock('@n10/core', () => ({
  sessionTags: (repo: string, identity: { type: string }) => ({
    '@orchestra-spawner': 'n10',
    '@orchestra-repo': repo,
    '@orchestra-session-type': identity.type,
  }),
  ORCHESTRA_TAG: { agent: '@orchestra-agent' },
  isGitRepo: (cwd: string) => state.repoRoots.has(cwd),
  // The remote machine has every directory asked for (the engine's spec
  // covers resolving it there).
  requireMachine: (id: string) => ({ id, executor: {} }),
  directoryOnMachine: (cwd: string) => Promise.resolve(cwd),
  launchTerminalSession: async (spec: {
    name?: string;
    kind: string;
    cwd: string;
    cols: number;
    rows: number;
    config: unknown;
    mode?: 'open' | 'attach';
  }) => {
    await Promise.resolve();
    state.modes.push(spec.mode);
    if (!spec.name) state.nextId += 1;
    const allocated =
      state.nextId === 1
        ? `n10-${spec.kind}`
        : `n10-${spec.kind}-${state.nextId}`;
    const actual = {
      ...spec,
      name: spec.name ?? state.allocatedName ?? allocated,
    };
    state.alive.add(actual.name);
    state.spawns.push({
      name: actual.name,
      kind: actual.kind,
      cwd: actual.cwd,
      cols: actual.cols,
      rows: actual.rows,
      config: actual.config,
    });
    const name = actual.name;
    state.onExit.set(name, []);
    state.sessions.set(name, {
      exited: false,
      pty: {
        cols: actual.cols,
        rows: actual.rows,
        onData: (cb: (data: string) => void) => state.onData.set(name, cb),
        onExit: (cb: (code: number) => void) =>
          state.onExit.get(name)?.push(cb),
      },
    });
    return { name, pty: state.sessions.get(name)!.pty };
  },
  hasPersistedTerminalSession: (name: string) => state.tmuxHolds.has(name),
  getSession: (name: string) => state.sessions.get(name),
  killSession: (name: string) => {
    state.killed.push(name);
    state.alive.delete(name);
    state.sessions.delete(name);
  },
  releaseExitedSession: (name: string) => {
    state.released.push(name);
    state.sessions.delete(name);
  },
  isSessionAlive: (name: string) => state.alive.has(name),
  getSpawnedAt: () => 1000,
  LOCAL_MACHINE: 'local',
  sessionIdentity: () => null,
  captureTmuxRuntime: () => ({}),
}));

let terminals: typeof TerminalsModule;

// Each test re-imports the service over fresh module state. Loading its
// module graph the first time means transforming all of it, which a
// full parallel run can stretch past a hook's timeout; done here, while
// the file is collected, every hook after re-evaluates cached modules.
await import('./terminals.js');

beforeEach(async () => {
  state.alive = new Set();
  state.spawns = [];
  state.killed = [];
  state.released = [];
  state.onData = new Map();
  state.onExit = new Map();
  state.sessions = new Map();
  state.repoRoots = new Set(['/home/dev/n10', '/home/dev/other']);
  state.recents = [];
  state.nextId = 0;
  state.modes = [];
  state.allocatedName = undefined;
  state.tmuxHolds = new Set();
  state.broadcasts = [];
  vi.resetModules();
  terminals = await import('./terminals.js');
  const relay = await import('./session-relay.js');
  relay.setSessionBroadcaster(
    (channel, payload) => state.broadcasts.push({ channel, payload }),
    () => undefined
  );
});

const HOME = '/home/dev';

describe('launchTerminal', () => {
  it('opens a shell in a plain folder, belonging to no repository', async () => {
    const summary = await terminals.launchTerminal(
      { kind: 'shell', cwd: '/home/dev/notes' },
      HOME
    );
    expect(state.spawns).toEqual([
      expect.objectContaining({ kind: 'shell', cwd: '/home/dev/notes' }),
    ]);
    expect(summary).toMatchObject({
      kind: 'shell',
      cwd: '/home/dev/notes',
      displayPath: '~/notes',
      repo: null,
      running: true,
    });
    expect(state.recents).toEqual([]);
  });

  // A repository root joins that repository's group, and is put on the
  // repo list so the workspace can switch to it like any other repo.
  it('binds a terminal at a repository root to that repository', async () => {
    const summary = await terminals.launchTerminal(
      { kind: 'agent', cwd: '/home/dev/other' },
      HOME
    );
    expect(summary.repo).toBe('/home/dev/other');
    expect(state.recents).toEqual(['/home/dev/other']);
  });

  it('treats a subfolder of a repository as a plain folder', async () => {
    const summary = await terminals.launchTerminal(
      { kind: 'shell', cwd: '/home/dev/n10/apps' },
      HOME
    );
    expect(summary.repo).toBeNull();
    expect(state.recents).toEqual([]);
  });

  it('emits a start step for a remote launch, keyed to launchId', async () => {
    await terminals.launchTerminal(
      {
        kind: 'shell',
        cwd: '/remote/dir',
        machine: 'dddddddddddddddd',
        launchId: 'L1',
      },
      HOME
    );
    expect(state.broadcasts).toEqual([
      {
        channel: 'n10/launch/step',
        payload: { launchId: 'L1', step: 'start' },
      },
    ]);
  });

  it('emits no steps for a local launch', async () => {
    await terminals.launchTerminal({ kind: 'shell', cwd: '/x' }, HOME);
    expect(state.broadcasts).toEqual([]);
  });

  it('relays the session’s output into a buffer the renderer can replay', async () => {
    const { name } = await terminals.launchTerminal(
      { kind: 'shell', cwd: '/x' },
      HOME
    );
    state.onData.get(name)?.('$ ');
    state.onData.get(name)?.('ls\r\n');
    expect(terminals.terminalBuffer(name)).toEqual({
      data: '$ ls\r\n',
      seq: 2,
      truncated: false,
    });
  });
});

describe('adoptTerminal', () => {
  // The restore path: the name and directory come from tmux, and the
  // launch reattaches under exactly that name.
  it('reattaches under the name and in the directory tmux reported', async () => {
    await terminals.adoptTerminal({
      name: 'n10-shell',
      kind: 'shell',
      path: '/home/dev/notes',
    });
    expect(state.spawns).toEqual([
      expect.objectContaining({
        name: 'n10-shell',
        kind: 'shell',
        cwd: '/home/dev/notes',
      }),
    ]);
    expect(terminals.listTerminals(HOME)).toEqual([
      expect.objectContaining({
        name: 'n10-shell',
        repo: null,
        displayPath: '~/notes',
      }),
    ]);
  });

  it('coalesces concurrent attachment before installing one output relay', async () => {
    const terminal = {
      name: 'n10-shell',
      kind: 'shell' as const,
      path: '/x',
    };
    await Promise.all([
      terminals.adoptTerminal(terminal),
      terminals.adoptTerminal(terminal),
    ]);
    expect(state.spawns).toHaveLength(1);
    state.onData.get(terminal.name)?.('one output');
    expect(terminals.terminalBuffer(terminal.name)).toEqual({
      data: 'one output',
      seq: 1,
      truncated: false,
    });
  });

  // A terminal restored at a repository root the user has since
  // forgotten still needs its repository on the list: activating its
  // tab opens that repository.
  it('puts a restored terminal’s repository back on the repo list', async () => {
    await terminals.adoptTerminal({
      name: 'n10-agent',
      kind: 'agent',
      path: '/home/dev/other',
    });
    expect(state.recents).toEqual(['/home/dev/other']);
    expect(terminals.listTerminals(HOME)[0].repo).toBe('/home/dev/other');
  });
});

describe('listTerminals', () => {
  it('reports every terminal, running or not, whatever repository is open', async () => {
    const a = await terminals.launchTerminal(
      { kind: 'shell', cwd: '/home/dev/n10' },
      HOME
    );
    const b = await terminals.launchTerminal(
      { kind: 'shell', cwd: '/tmp' },
      HOME
    );
    state.alive.delete(b.name); // the shell exited on its own
    expect(terminals.listTerminals(HOME)).toEqual([
      expect.objectContaining({ name: a.name, running: true }),
      expect.objectContaining({ name: b.name, running: false }),
    ]);
  });
});

/** The process behind `name` ends: the registry marks its entry exited
 *  and every exit subscriber hears about it, in the order they
 *  subscribed. The entry stays until something releases it. */
function endProcess(name: string): void {
  const session = state.sessions.get(name);
  if (session) session.exited = true;
  state.alive.delete(name);
  for (const cb of [...(state.onExit.get(name) ?? [])]) cb(0);
}

// The tab closes by itself when its process ends — `exit` typed into a
// shell, an agent quitting, tmux ending the session — so the host must
// stop listing the terminal, or the strip would keep a tab open on a
// process that is gone. Everything held for it goes with it: the
// relay buffer, and the registry tombstone nothing can view any more.
describe('a terminal whose process ended', () => {
  it('is no longer listed, and its buffer and registry entry are released', async () => {
    const { name } = await terminals.launchTerminal(
      { kind: 'shell', cwd: '/x' },
      HOME
    );
    state.onData.get(name)?.('$ exit\r\n');
    endProcess(name);
    expect(terminals.listTerminals(HOME)).toEqual([]);
    expect(terminals.terminalBuffer(name)).toBeUndefined();
    expect(terminals.isTerminal(name)).toBe(false);
    expect(state.released).toEqual([name]);
    // Released, never killed: on tmux a kill would reach the session,
    // and the client can exit while the session lives on.
    expect(state.killed).toEqual([]);
  });

  it('tells the renderer, so the tab closes at once rather than on the next poll', async () => {
    const { name } = await terminals.launchTerminal(
      { kind: 'shell', cwd: '/x' },
      HOME
    );
    endProcess(name);
    expect(state.broadcasts).toEqual([
      {
        channel: 'n10/session/exit',
        payload: { name, code: 0, retained: false },
      },
    ]);
  });

  it('applies to an agent terminal as much as a shell', async () => {
    const { name } = await terminals.launchTerminal(
      { kind: 'agent', cwd: '/home/dev/other' },
      HOME
    );
    endProcess(name);
    expect(terminals.listTerminals(HOME)).toEqual([]);
    expect(terminals.agentTerminalNames()).toEqual([]);
  });
});

describe('a retained agent pane', () => {
  it('keeps the stopped agent tab and its output without relaunching', async () => {
    const { name } = await terminals.launchTerminal(
      { kind: 'agent', cwd: '/x' },
      HOME
    );
    state.tmuxHolds.add(name);
    state.onData.get(name)?.('Finished');
    endProcess(name);
    expect(terminals.listTerminals(HOME)).toEqual([
      expect.objectContaining({ name, kind: 'agent', running: false }),
    ]);
    expect(terminals.terminalBuffer(name)?.data).toBe('Finished');
    expect(state.spawns).toHaveLength(1);
    expect(state.released).toEqual([]);
    expect(
      state.broadcasts.filter((event) => event.channel === 'n10/session/exit')
    ).toEqual([
      {
        channel: 'n10/session/exit',
        payload: { name, code: 0, retained: true },
      },
    ]);
  });

  it('restarts the selected terminal under its existing identity', async () => {
    const tab = await terminals.launchTerminal(
      { kind: 'agent', cwd: '/x' },
      HOME
    );
    state.tmuxHolds.add(tab.name);
    endProcess(tab.name);
    const restarted = await terminals.launchTerminal(
      { kind: 'agent', cwd: '/x', sessionName: tab.name },
      HOME
    );
    expect(restarted.name).toBe(tab.name);
    expect(restarted.running).toBe(true);
    expect(terminals.listTerminals(HOME)).toHaveLength(1);
  });

  it('notes the retained tab’s own repository on restart, not the request cwd', async () => {
    // The renderer's restart request shouldn't need to carry a real
    // repository at all — the tab already knows where it lives.
    const tab = await terminals.launchTerminal(
      { kind: 'agent', cwd: '/home/dev/other' },
      HOME
    );
    state.tmuxHolds.add(tab.name);
    endProcess(tab.name);
    await terminals.launchTerminal(
      { kind: 'agent', cwd: '/home/dev/n10', sessionName: tab.name },
      HOME
    );
    expect(state.recents).toEqual(['/home/dev/other']);
  });
});

// getSessionActivity folds this into the same working-agent spinner a
// worktree agent gets. A shell animates on whatever the user types —
// `ls`, a build — with no agent behind it, so only the `agent` kind may
// reach that spinner.
describe('agentTerminalNames', () => {
  it('reports agent terminals and leaves shells out', async () => {
    const shell = await terminals.launchTerminal(
      { kind: 'shell', cwd: '/home/dev/notes' },
      HOME
    );
    const agent = await terminals.launchTerminal(
      { kind: 'agent', cwd: '/home/dev/other' },
      HOME
    );
    expect(terminals.agentTerminalNames()).toEqual([agent.name]);
    expect(terminals.agentTerminalNames()).not.toContain(shell.name);
  });

  it('is empty with no terminals at all', () => {
    expect(terminals.agentTerminalNames()).toEqual([]);
  });
});

it('uses the allocated backend name for the tab and its lifecycle', async () => {
  state.allocatedName = 'n10-shell-3';
  const tab = await terminals.launchTerminal({
    kind: 'shell',
    cwd: '/home/dev/n10',
  });
  expect(state.modes).toEqual([undefined]);
  expect(tab.name).toBe('n10-shell-3');
  expect(tab.running).toBe(true);
  expect(state.onExit.has('n10-shell-3')).toBe(true);
  // Restoring names a target explicitly rather than allocating another.
  await terminals.adoptTerminal({
    name: tab.name,
    kind: 'shell',
    path: '/home/dev/n10',
  });
  expect(state.modes).toEqual([undefined, 'attach']);
  expect(
    terminals.listTerminals(HOME).map((terminal) => terminal.name)
  ).toEqual(['n10-shell-3']);
});
