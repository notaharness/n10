import type * as WorktreeModule from '@n10/worktree-manager';
import type * as EngineModule from '@n10/engine';
import type { AppConfig } from '@n10/vcs-core';
import type * as CoreModule from '@n10/core';
import { worktreeSessionKey } from '@n10/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SessionsModule from './sessions.js';
import type { MachineView } from '@n10/engine/contract';
import type { TaggedSession } from '@n10/core';

/** Sessions from multiple repositories coexist under qualified keys. */

const state = vi.hoisted(() => ({
  cwd: '/repo-a',
  handles: new Map<string, EngineModule.SessionService>(),
  alive: new Set<string>(),
  spawns: [] as {
    name: string;
    cwd: string;
    config: unknown;
    request: unknown;
    fresh?: boolean;
    expected?: unknown;
    agent?: { id: string };
  }[],
  killed: [] as string[],
  persistedKilled: [] as string[],
  persisted: new Set<string>(),
  entries: new Map<string, object>(),
  /** Native tmux incarnation name behind each session's PTY. */
  ptyNames: new Map<string, string>(),
  /** What a fresh `tmuxSessionSnapshot(pty.target.name)` answers, keyed by
   *  native name — absent means the read fails, as it would for a
   *  vanished target. */
  tmuxSnapshots: new Map<string, { incarnation: unknown }>(),
  onData: new Map<string, (data: string) => void>(),
  configByCwd: {} as Record<string, unknown>,
  createFails: new Set<string>(),
  /** Prompts the engine plan command delivered into a live agent. */
  injected: [] as { name: string; prompt: string }[],
  /** Branch names whose checkout core should report as failed. */
  checkoutFails: new Set<string>(),
  createWorktreeCalls: [] as {
    branch: string;
    cwd: string;
    machine?: { id: string };
  }[],
  knownMachines: new Set<string>(),
  /** Names `reconnectSession` called the fake backend's `reconnect()` for. */
  reconnectCalls: [] as string[],
  /** Per-name `pty.connectionState`, read live (not just at entry
   *  creation) — finding 10's tests flip this after a session exists. */
  connectionStateByName: new Map<string, string>(),
  /** Paired machines `listMachines()` answers with, for the plan
   *  checkout's cross-machine duplicate-agent check. */
  machines: [] as MachineView[],
  /** Tagged sessions a remote machine's `list-sessions` would report,
   *  keyed by peerId. */
  remoteSessions: new Map<string, TaggedSession[]>(),
  /** What `pwd -P` answers on a remote machine, by the path asked. */
  remotePhysical: new Map<string, string>(),
  /** Checkouts `listWorktrees` would report: `repo\0branch` → path. */
  worktrees: new Map<string, string>(),
}));

/** Where the fakes put `branch`'s checkout in `repo`. */
function checkoutPath(branch: string, repo: string): string {
  return `${repo}/.claude/worktrees/${branch}`;
}

/** Record `branch`'s checkout in `repo`, as git would list it. */
function addCheckout(branch: string, repo = state.cwd): string {
  const path = checkoutPath(branch, repo);
  state.worktrees.set(`${repo}\0${branch}`, path);
  return path;
}

vi.mock('./repo.js', async () => {
  const { createSessionService } = await vi.importActual<typeof EngineModule>(
    '@n10/engine'
  );
  const handles = state.handles;
  function repository(repo: string) {
    let sessions = handles.get(repo);
    if (!sessions) {
      // The engine resolves a remote machine's own clone (its spec).
      const create = (branch: string, machine?: { id: string }) => {
        const cwd = repo;
        state.createWorktreeCalls.push({ branch, cwd, machine });
        if (state.createFails.has(branch))
          return Promise.reject(new Error(`git refused ${branch}`));
        return Promise.resolve(addCheckout(branch, cwd));
      };
      const worktrees = {
        create,
        find: async (target: { branch: string }) => {
          const path = state.worktrees.get(`${repo}\0${target.branch}`);
          return path ? { path, branch: target.branch } : null;
        },
        resolve: (target: { branch: string }) => create(target.branch),
        refresh: async () => undefined,
        subscribe: () => () => undefined,
        getSnapshot: () => ({ worktrees: [], error: null }),
      } as unknown as EngineModule.WorktreeService;
      sessions = createSessionService({
        config: {
          repo,
          getSnapshot: () => ({
            config: (state.configByCwd[repo] ?? {
              fromCwd: repo,
            }) as AppConfig,
          }),
          subscribe: () => () => undefined,
        },
        worktrees,
        isCurrent: () => state.cwd === repo,
      });
      handles.set(repo, sessions);
    }
    return {
      cwd: repo,
      worktrees: { scope: () => ({ cwd: repo }) },
      sessions,
      config: {
        getSnapshot: () => ({ config: state.configByCwd[repo] ?? {} }),
      },
    };
  }
  return {
    requireRepo: () => state.cwd,
    activeRepoIs: (cwd: string) => cwd === state.cwd,
    activeRepository: () => repository(state.cwd),
    repository,
  };
});

vi.mock('@n10/vcs-core', () => ({
  readConfig: (cwd: string) => state.configByCwd[cwd] ?? { fromCwd: cwd },
}));

vi.mock('@n10/terminal-tmux', () => ({
  tmuxSessionSnapshot: (name: string) => state.tmuxSnapshots.get(name) ?? null,
  sameTmuxIncarnation: (
    a: Record<string, unknown>,
    b: Record<string, unknown>
  ) =>
    ['name', 'sessionId', 'paneId', 'panePid', 'serverPid'].every(
      (key) => a[key] === b[key]
    ),
}));

vi.mock('@n10/worktree-manager', async (original) => ({
  ...(await original<typeof WorktreeModule>()),
  createWorktree: async (branch: string, scope: { cwd: string }) => {
    if (state.checkoutFails.has(branch)) return null;
    return addCheckout(branch, scope.cwd);
  },
}));

vi.mock('./remote-machines.js', () => ({
  machineFor: (peerId: string) => {
    if (!state.knownMachines.has(peerId))
      throw new Error(`Machine "${peerId}" is not available`);
    return { id: peerId, executor: {}, ptyOpener: {} };
  },
}));

vi.mock('./machines.js', async () => {
  const { createMachineService } = await vi.importActual<typeof EngineModule>(
    '@n10/engine'
  );
  const machines = createMachineService();
  machines.setPort({
    listMachines: async () => state.machines,
  } as EngineModule.MachinesPort);
  machines.setRemotePort({} as EngineModule.RemoteMachinePort);
  return { machines };
});

vi.mock('@n10/core', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreModule>();
  return {
    setMachineReachable: () => undefined,
    worktreeSessionKey: actual.worktreeSessionKey,
    sessionLabel: actual.sessionLabel,
    sessionIdentity: actual.sessionIdentity,
    sessionTags: actual.sessionTags,
    registryNameOf: actual.registryNameOf,
    ORCHESTRA_TAG: actual.ORCHESTRA_TAG,
    listOurSessions: () => [],
    captureSessionRuntime: () => ({}),
    LOCAL_MACHINE: actual.LOCAL_MACHINE,
    resolveAgent: actual.resolveAgent,
    sessionIncarnationMatches: (
      name: string,
      expected: CoreModule.SessionIncarnation
    ) => {
      if (actual.sessionIdentity(name)?.machine !== actual.LOCAL_MACHINE)
        return false;
      const native = state.ptyNames.get(name) ?? name;
      const live = state.tmuxSnapshots.get(native)?.incarnation as
        | CoreModule.SessionIncarnation
        | undefined;
      return (
        !!live &&
        ['name', 'sessionId', 'paneId', 'panePid', 'serverPid'].every(
          (key) =>
            live[key as keyof CoreModule.SessionIncarnation] ===
            expected[key as keyof CoreModule.SessionIncarnation]
        )
      );
    },
    // The checkout that has the branch, as core reads it from git.
    sessionKeyForBranch: (branch: string, { cwd: repo }: { cwd: string }) => {
      const path = state.worktrees.get(`${repo}\0${branch}`);
      return Promise.resolve(
        path ? actual.worktreeSessionKey(path, repo) : null
      );
    },
    resolveRemoteWorktreePath: (path: string) =>
      Promise.resolve(state.remotePhysical.get(path) ?? path),
    listOurSessionsWith: (_executor: unknown, machine: string) =>
      Promise.resolve(state.remoteSessions.get(machine) ?? []),
    getSessionLaunchContext: () => ({
      exists: false,
      running: false,
      canResume: false,
    }),
    deliverToRunningSession: (name: string, prompt: string) => {
      state.injected.push({ name, prompt });
      return state.alive.has(name);
    },
    buildAgentOptions: actual.buildAgentOptions,
    buildReviewLaunchRequest: (
      pr: { id: number },
      instruction?: string,
      options: { guide?: boolean } = {}
    ) => ({
      intent: 'review',
      prompt: `review #${pr.id}${instruction ? `: ${instruction}` : ''}`,
      systemGuidance: options.guide ? 'guidance, guide' : 'guidance',
    }),
    launchSession: async (spec: {
      name: string;
      cwd: string;
      config: unknown;
      request: unknown;
      fresh?: boolean;
      expected?: unknown;
      agent?: { id: string };
    }) => {
      await Promise.resolve();
      state.alive.add(spec.name);
      state.spawns.push({
        name: spec.name,
        cwd: spec.cwd,
        config: spec.config,
        request: spec.request,
        fresh: spec.fresh,
        expected: spec.expected,
        agent: spec.agent,
      });
    },
    onSessionExit: () => () => undefined,
    strandedSessionRows: () => [],
    releaseExitedSession: () => undefined,
    getSession: (name: string) => {
      if (!state.alive.has(name)) return undefined;
      if (!state.entries.has(name))
        state.entries.set(name, {
          exited: false,
          pty: {
            target: { kind: 'tmux', name: state.ptyNames.get(name) ?? name },
            onData: (cb: (data: string) => void) => state.onData.set(name, cb),
            onExit: () => undefined,
            write: () => undefined,
            resize: () => undefined,
            reconnect: () => state.reconnectCalls.push(name),
            get connectionState() {
              return state.connectionStateByName.get(name);
            },
          },
        });
      return state.entries.get(name);
    },
    stopSession: (name: string) => {
      if (!state.alive.has(name) && !state.entries.has(name)) {
        state.persistedKilled.push(name);
        return;
      }
      state.killed.push(name);
      state.alive.delete(name);
      state.entries.delete(name);
    },
    isSessionAlive: (name: string) => state.alive.has(name),
    hasSessionConnection: (name: string) => state.alive.has(name),
    hasLiveSession: (name: string) => state.persisted.has(name),
    getSpawnedAt: () => 1000,
    sessionNames: () => [...state.entries.keys()],
    noteInput: () => undefined,
    noteResize: () => undefined,
    noteSeen: () => undefined,
    snapshot: (name: string) => ({
      active: state.alive.has(name),
      flashing: false,
    }),
  };
});

// The service keeps its known-session map in module scope, which is
// exactly the state these tests are about — so each test gets a fresh
// module rather than inheriting the previous test's sessions.
let sessions: typeof SessionsModule;
let getSessionActivity: typeof sessions.getSessionActivity;
let getSessionBuffer: typeof sessions.getSessionBuffer;
let killSession: typeof sessions.killSession;
let launchAgent: typeof sessions.launchAgent;
let checkoutPlan: typeof sessions.checkoutPlan;
let launchReviewAgent: typeof sessions.launchReviewAgent;
let listSessions: typeof sessions.listSessions;
let reconnectSession: typeof sessions.reconnectSession;

beforeEach(async () => {
  state.cwd = '/repo-a';
  state.handles.clear();
  state.alive = new Set();
  state.spawns = [];
  state.killed = [];
  state.persistedKilled = [];
  state.persisted = new Set();
  state.entries = new Map();
  state.ptyNames = new Map();
  state.tmuxSnapshots = new Map();
  state.onData = new Map();
  state.configByCwd = {};
  state.createFails = new Set();
  state.injected = [];
  state.checkoutFails = new Set();
  state.createWorktreeCalls = [];
  state.knownMachines = new Set();
  state.reconnectCalls = [];
  state.connectionStateByName = new Map();
  state.machines = [];
  state.remoteSessions = new Map();
  state.worktrees = new Map();

  vi.resetModules();
  sessions = await import('./sessions.js');
  ({
    checkoutPlan,
    getSessionActivity,
    getSessionBuffer,
    killSession,
    launchAgent,
    launchReviewAgent,
    listSessions,
    reconnectSession,
  } = sessions);
  sessions.setSessionBroadcaster(
    () => undefined,
    () => undefined
  );
});

/** The session key of `branch`'s checkout as the fakes create it. */
function keyFor(branch: string, repo = '/repo-a', machine?: string): string {
  return worktreeSessionKey(checkoutPath(branch, repo), repo, machine);
}

/** Emit PTY output for a session, as the relay would. */
function emit(name: string, data: string) {
  state.onData.get(name)?.(data);
}

// Shared by `launchAgent` and `checkoutPlan`'s cross-machine
// duplicate-agent tests (findings 1 and 4 reuse the same guard).
function connectedMachine(peerId: string, label: string): MachineView {
  return {
    peerId,
    label,
    isLocal: false,
    state: 'connected',
    path: 'direct',
    lastSeenAt: 1000,
    grant: 'all',
    queued: 0,
    inboundWaiting: [],
    inboundRefused: [],
  };
}

function remoteWorktreeSession(
  repo: string,
  branch: string,
  machine: string
): TaggedSession {
  return {
    target: { kind: 'tmux', name: `n10-${branch.replace(/\//g, '-')}` },
    created: 1,
    exited: false,
    path: '/wherever',
    worktreePath: '/wherever',
    spawner: 'kirby',
    repo,
    type: 'worktree',
    branch,
    machine,
  };
}

describe('launchAgent', () => {
  it('spawns the worktree session and reads config from the repo root', async () => {
    // Per-project config is keyed by a hash of the cwd, so reading it
    // from the worktree path resolves a different, empty bag.
    state.configByCwd['/repo-a'] = { marker: 'root-config' };
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });

    expect(state.spawns).toHaveLength(1);
    expect(state.spawns[0].name).toBe(keyFor('feature/x', '/repo-a'));
    expect(state.spawns[0].cwd).toBe('/repo-a/.claude/worktrees/feature/x');
    expect(state.spawns[0].config).toEqual({ marker: 'root-config' });
  });

  it('creates the worktree on the named machine and keys the session with it (D2, D5)', async () => {
    state.knownMachines.add('dddddddddddddddd');
    await launchAgent({
      branch: 'feature/x',
      intent: 'continue-or-blank',
      machine: 'dddddddddddddddd',
    });
    expect(state.createWorktreeCalls[0]).toMatchObject({
      branch: 'feature/x',
      cwd: '/repo-a',
      machine: { id: 'dddddddddddddddd' },
    });
    expect(state.spawns[0].name).toBe(
      keyFor('feature/x', '/repo-a', 'dddddddddddddddd')
    );
  });

  it('keys a remote session by the physical path its machine resolves', async () => {
    state.knownMachines.add('dddddddddddddddd');
    state.remotePhysical.set(
      checkoutPath('feature/x', '/repo-a'),
      '/real/repo-a/.claude/worktrees/feature-x'
    );
    await launchAgent({
      branch: 'feature/x',
      intent: 'continue-or-blank',
      machine: 'dddddddddddddddd',
    });
    expect(state.spawns[0].name).toBe(
      worktreeSessionKey(
        '/real/repo-a/.claude/worktrees/feature-x',
        '/repo-a',
        'dddddddddddddddd'
      )
    );
    state.remotePhysical.clear();
  });

  it('fails loudly rather than launching locally when the named machine is not available', async () => {
    // peer-abc is never added to state.knownMachines.
    await expect(
      launchAgent({
        branch: 'feature/x',
        intent: 'continue-or-blank',
        machine: 'dddddddddddddddd',
      })
    ).rejects.toThrow(/not available/);
    expect(state.createWorktreeCalls).toHaveLength(0);
    expect(state.spawns).toHaveLength(0);
  });

  it('emits worktree then start steps for a remote launch, keyed to launchId', async () => {
    state.knownMachines.add('dddddddddddddddd');
    const broadcasts: unknown[] = [];
    sessions.setSessionBroadcaster(
      (channel, payload) => {
        if (channel === 'n10/launch/step') broadcasts.push(payload);
      },
      () => undefined
    );
    await launchAgent({
      branch: 'feature/x',
      intent: 'continue-or-blank',
      machine: 'dddddddddddddddd',
      launchId: 'launch-1',
    });
    expect(broadcasts).toEqual([
      { launchId: 'launch-1', step: 'worktree' },
      { launchId: 'launch-1', step: 'start' },
    ]);
  });

  it('emits no steps for a local launch', async () => {
    const broadcasts: unknown[] = [];
    sessions.setSessionBroadcaster(
      (channel, payload) => {
        if (channel === 'n10/launch/step') broadcasts.push(payload);
      },
      () => undefined
    );
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    expect(broadcasts).toEqual([]);
  });

  it('a local launch never touches the machine resolver, and creates the worktree exactly as today', async () => {
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    expect(state.createWorktreeCalls[0]).toMatchObject({
      branch: 'feature/x',
      cwd: '/repo-a',
      machine: undefined,
    });
    expect(state.spawns[0].name).toBe(keyFor('feature/x', '/repo-a'));
  });

  it('launches a per-launch agent pick over the stored config', async () => {
    state.configByCwd['/repo-a'] = { agentId: 'claude', marker: 'root' };
    await launchAgent({
      branch: 'feature/x',
      intent: 'continue-or-blank',
      agentId: 'codex',
    });
    expect(state.spawns[0].config).toEqual({
      agentId: 'codex',
      marker: 'root',
    });
  });

  it('collapses overlapping launches of the same branch into one spawn', async () => {
    // A double-click can race the renderer's isPending flag; a second
    // spawn would dispose the first PTY and attach a duplicate relay.
    const [a, b] = await Promise.all([
      launchAgent({ branch: 'race', intent: 'continue-or-blank' }),
      launchAgent({ branch: 'race', intent: 'continue-or-blank' }),
    ]);
    expect(a).toEqual(b);
    expect(state.spawns).toHaveLength(1);
  });

  it('does not collapse a fresh request into a pending continuation', async () => {
    const first = launchAgent({ branch: 'race', intent: 'continue-or-blank' });
    await expect(
      launchAgent({ branch: 'race', intent: 'blank', fresh: true })
    ).rejects.toThrow('Another launch is in progress');
    await first;
    expect(state.spawns).toHaveLength(1);
  });

  it('forwards an explicit fresh replacement and selected agent for a live session', async () => {
    await launchAgent({ branch: 'fresh', intent: 'continue-or-blank' });
    const expected = {
      kind: 'tmux' as const,
      name: 'native',
      sessionId: '$1',
      paneId: '%2',
      panePid: 123,
      serverPid: 100,
    };
    await launchAgent({
      branch: 'fresh',
      intent: 'blank',
      fresh: true,
      expected,
      agentId: 'codex',
    });
    expect(state.spawns).toHaveLength(2);
    expect(state.spawns[1]).toMatchObject({
      fresh: true,
      expected,
      agent: { id: 'codex' },
      request: { intent: 'blank' },
    });
  });

  it('reattaches to its own live session instead of respawning', async () => {
    await launchAgent({ branch: 'again', intent: 'continue-or-blank' });
    await launchAgent({ branch: 'again', intent: 'continue-or-blank' });
    expect(state.spawns).toHaveLength(1);
  });

  // ── Finding 4 (MEDIUM): the duplicate-agent hole on the main launch ──
  //
  // getSessionLaunchContext only ever reads local state, so the dialog
  // offers "Start new session" with the local default for a branch whose
  // agent already runs on a fleet member, and this — unlike checkoutPlan
  // — never asked findRemoteBranchOwner at all. Same guard, reused.
  it('refuses a local launch, naming the machine, when the branch already runs there', async () => {
    state.knownMachines.add('bbbbbbbbbbbbbbbb');
    state.machines = [connectedMachine('bbbbbbbbbbbbbbbb', 'workbox')];
    state.remoteSessions.set('bbbbbbbbbbbbbbbb', [
      remoteWorktreeSession('/repo-a', 'feature/x', 'bbbbbbbbbbbbbbbb'),
    ]);

    await expect(
      launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' })
    ).rejects.toThrow(/workbox/);
    expect(state.createWorktreeCalls).toEqual([]);
    expect(state.spawns).toEqual([]);
  });

  it('does not refuse an explicit remote launch on a different machine than the owner', async () => {
    state.knownMachines.add('bbbbbbbbbbbbbbbb');
    state.knownMachines.add('cccccccccccccccc');
    state.machines = [connectedMachine('bbbbbbbbbbbbbbbb', 'workbox')];
    state.remoteSessions.set('bbbbbbbbbbbbbbbb', [
      remoteWorktreeSession('/repo-a', 'feature/x', 'bbbbbbbbbbbbbbbb'),
    ]);

    await expect(
      launchAgent({
        branch: 'feature/x',
        intent: 'continue-or-blank',
        machine: 'cccccccccccccccc',
      })
    ).resolves.toBeDefined();
  });

  it('does not refuse a local launch when the local agent is already running (finding 1 reused here)', async () => {
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    state.spawns = [];
    state.knownMachines.add('bbbbbbbbbbbbbbbb');
    state.machines = [connectedMachine('bbbbbbbbbbbbbbbb', 'workbox')];
    state.remoteSessions.set('bbbbbbbbbbbbbbbb', [
      remoteWorktreeSession('/repo-a', 'feature/x', 'bbbbbbbbbbbbbbbb'),
    ]);

    await expect(
      launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' })
    ).resolves.toBeDefined();
  });
});

describe('reusing an already-attached connection', () => {
  // LaunchDialog always sends `expected` (the incarnation it read when it
  // opened), so "Open Claude" on an already-connected session must still
  // reuse the connection instead of tearing down and re-attaching the PTY.
  const name = () => keyFor('reuse', '/repo-a');
  const incarnationFor = (nativeName: string) => ({
    kind: 'tmux' as const,
    name: nativeName,
    sessionId: '$1',
    paneId: '%2',
    panePid: 123,
    serverPid: 100,
  });

  it('reuses the connection when the expected incarnation matches the live snapshot', async () => {
    await launchAgent({ branch: 'reuse', intent: 'continue-or-blank' });
    expect(state.spawns).toHaveLength(1);
    state.tmuxSnapshots.set(name(), { incarnation: incarnationFor(name()) });

    await launchAgent({
      branch: 'reuse',
      intent: 'continue-or-blank',
      expected: incarnationFor(name()),
    });
    expect(state.spawns).toHaveLength(1);
  });

  it('does not reuse when the live snapshot no longer matches the expected incarnation', async () => {
    await launchAgent({ branch: 'reuse', intent: 'continue-or-blank' });
    // The live session was killed and recreated under this same tmux
    // label (labels are reused after a kill — see tmux-launch.ts's
    // free-name probe), so a fresh snapshot's native fields differ from
    // what the dialog captured even though the label is unchanged.
    state.tmuxSnapshots.set(name(), {
      incarnation: { ...incarnationFor(name()), sessionId: '$99' },
    });

    await launchAgent({
      branch: 'reuse',
      intent: 'continue-or-blank',
      expected: incarnationFor(name()),
    });
    expect(state.spawns).toHaveLength(2);
  });

  it('does not reuse when the live snapshot cannot be read', async () => {
    await launchAgent({ branch: 'reuse', intent: 'continue-or-blank' });
    state.tmuxSnapshots.delete(name());

    await launchAgent({
      branch: 'reuse',
      intent: 'continue-or-blank',
      expected: incarnationFor(name()),
    });
    expect(state.spawns).toHaveLength(2);
  });

  it('does not reuse a fresh request even when the incarnation matches', async () => {
    await launchAgent({ branch: 'reuse', intent: 'continue-or-blank' });
    state.tmuxSnapshots.set(name(), { incarnation: incarnationFor(name()) });

    await launchAgent({
      branch: 'reuse',
      intent: 'blank',
      fresh: true,
      expected: incarnationFor(name()),
    });
    expect(state.spawns).toHaveLength(2);
  });

  // Finding 9: tmux session labels are `<repo>-<branch>` on both
  // machines, so a *local* tmux session sharing the exact native name
  // a remote one's registry key resolves to could otherwise answer for
  // its incarnation check. `state.tmuxSnapshots` here is keyed exactly
  // the way a colliding local session would be (the local mocks in
  // this suite use the same string for a registry key and its native
  // pty name throughout) — so the test only passes if the guard never
  // asks local tmux at all for a remote session, not merely that this
  // particular snapshot happens to disagree.
  it('does not reuse a remote session by asking local tmux for its incarnation', async () => {
    state.knownMachines.add('bbbbbbbbbbbbbbbb');
    const remoteName = keyFor('reuse-remote', '/repo-a', 'bbbbbbbbbbbbbbbb');
    await launchAgent({
      branch: 'reuse-remote',
      intent: 'continue-or-blank',
      machine: 'bbbbbbbbbbbbbbbb',
    });
    expect(state.spawns).toHaveLength(1);
    state.tmuxSnapshots.set(remoteName, {
      incarnation: incarnationFor(remoteName),
    });

    await launchAgent({
      branch: 'reuse-remote',
      intent: 'continue-or-blank',
      machine: 'bbbbbbbbbbbbbbbb',
      expected: incarnationFor(remoteName),
    });
    expect(state.spawns).toHaveLength(2);
  });
});

describe('listSessions: a local session never carries a connectionState (finding 10)', () => {
  it('omits connectionState for a local session even when the PTY reports one', async () => {
    const name = keyFor('local-conn', '/repo-a');
    await launchAgent({ branch: 'local-conn', intent: 'continue-or-blank' });
    // TmuxBackend's own local-client reconnect (a distinct, older
    // concern than the remote D4 banner) can legitimately report this
    // — it must still never reach the renderer for a local session.
    state.connectionStateByName.set(name, 'reconnecting');
    const summary = listSessions(state.cwd).find((s) => s.name === name);
    expect(summary?.connectionState).toBeUndefined();
  });

  it('still reports connectionState for a remote session', async () => {
    state.knownMachines.add('bbbbbbbbbbbbbbbb');
    const name = keyFor('remote-conn', '/repo-a', 'bbbbbbbbbbbbbbbb');
    await launchAgent({
      branch: 'remote-conn',
      intent: 'continue-or-blank',
      machine: 'bbbbbbbbbbbbbbbb',
    });
    state.connectionStateByName.set(name, 'reconnecting');
    const summary = listSessions(state.cwd).find((s) => s.name === name);
    expect(summary?.connectionState).toBe('reconnecting');
  });
});

describe('listSessions: a held worktree session’s resume recipe', () => {
  it('names the native session it is attached to, not its registry key', async () => {
    const name = keyFor('native-label', '/repo-a');
    state.ptyNames.set(name, 'repo-a-native-label-2');
    await launchAgent({ branch: 'native-label', intent: 'continue-or-blank' });
    const summary = listSessions(state.cwd).find((s) => s.name === name);
    expect(summary?.restore?.target).toEqual({
      kind: 'tmux',
      name: 'repo-a-native-label-2',
    });
  });
});

describe('another repository owns the name', () => {
  /** Launch `branch` in repo A, then switch to repo B. */
  async function launchInAThenSwitch(branch = 'shared') {
    state.cwd = '/repo-a';
    await launchAgent({ branch, intent: 'continue-or-blank' });
    emit(keyFor(branch, '/repo-a'), 'repo-a secrets');
    state.cwd = '/repo-b';
  }

  it('launches the same branch in another repository without replacing the first agent', async () => {
    await launchInAThenSwitch();
    const second = await launchAgent({
      branch: 'shared',
      intent: 'continue-or-blank',
    });
    expect(second.name).toBe(keyFor('shared', '/repo-b'));
    expect(state.spawns).toHaveLength(2);
    expect(state.alive.has(keyFor('shared', '/repo-a'))).toBe(true);
    expect(listSessions(state.cwd).map((s) => s.name)).toEqual([second.name]);
  });

  it('refuses to kill it', async () => {
    await launchInAThenSwitch();
    expect(() => killSession(keyFor('shared', '/repo-a'))).toThrow(
      'belongs to another repository'
    );
    expect(state.killed).toEqual([]);
  });

  it('hides it from the session list', async () => {
    await launchInAThenSwitch();
    expect(listSessions(state.cwd)).toEqual([]);
    state.cwd = '/repo-a';
    expect(listSessions(state.cwd).map((s) => s.name)).toEqual([
      keyFor('shared', '/repo-a'),
    ]);
  });

  it('hides it from the activity map', async () => {
    await launchInAThenSwitch();
    expect(getSessionActivity()).toEqual({});
  });

  it('hands over its scrollback by its own name, and only that', async () => {
    await launchInAThenSwitch();
    // A pane of the parked repository, held ready, starts from it: the
    // name says which repository's agent it is.
    expect(getSessionBuffer(keyFor('shared', '/repo-a')).data).toBe(
      'repo-a secrets'
    );
    // The same branch here is another session, with none of it.
    expect(getSessionBuffer(keyFor('shared', '/repo-b')).data).toBe('');
  });

  it('reports it as not alive here, so this repo does not show it running', () => {
    // The sidebar asks this per worktree row. `isSessionAlive` alone
    // answers for any repository's registry entry, so the other repo's
    // agent would make a row asking with its key look
    // live — and `sync-items` would auto-open a tab onto an agent this
    // repo cannot reach, kill or relaunch.
    return launchInAThenSwitch().then(() => {
      expect(sessions.isOwnSessionAlive(keyFor('shared', '/repo-a'))).toBe(
        false
      );
      state.cwd = '/repo-a';
      expect(sessions.isOwnSessionAlive(keyFor('shared', '/repo-a'))).toBe(
        true
      );
    });
  });

  it('ignores names without a worktree identity', () => {
    // A name without an explicit worktree identity never authorizes a stop.
    expect(() => killSession('never-seen')).toThrow('another repository');
    expect(state.killed).toEqual([]);
    expect(state.persistedKilled).toEqual([]);
  });
});

describe('session buffer', () => {
  it('accumulates output with a monotonic sequence number', async () => {
    await launchAgent({ branch: 'buf', intent: 'continue-or-blank' });
    emit(keyFor('buf', '/repo-a'), 'one ');
    emit(keyFor('buf', '/repo-a'), 'two');

    // The seq lets a late subscriber drop chunks the snapshot covered.
    expect(getSessionBuffer(keyFor('buf', '/repo-a'))).toEqual({
      data: 'one two',
      seq: 2,
      truncated: false,
    });
  });

  it('is empty for a session that was never launched', () => {
    expect(getSessionBuffer('nothing')).toEqual({
      data: '',
      seq: 0,
      truncated: false,
    });
  });

  it("drops the oldest output after the client's first once the ring is full", async () => {
    await launchAgent({ branch: 'big', intent: 'continue-or-blank' });
    const chunk = 'x'.repeat(256 * 1024);
    emit(keyFor('big', '/repo-a'), 'setup');
    emit(keyFor('big', '/repo-a'), chunk);
    emit(keyFor('big', '/repo-a'), chunk);
    emit(keyFor('big', '/repo-a'), chunk);

    // The ring is bounded at 512 KiB: the scrollback stays useful without
    // letting a chatty agent grow the host without limit. The client's
    // first output, its terminal setup, stays ahead of it.
    const { data, truncated } = getSessionBuffer(keyFor('big', '/repo-a'));
    expect(data).toBe('setup' + chunk + chunk);
    expect(truncated).toBe(true);
  });
});

describe('reconnectSession', () => {
  it('calls the backend’s manual retry (the pane’s Reconnect action)', async () => {
    await launchAgent({ branch: 'buf', intent: 'continue-or-blank' });
    const name = keyFor('buf', '/repo-a');
    reconnectSession(name);
    expect(state.reconnectCalls).toEqual([name]);
  });

  it('is a no-op for a session that is not there', () => {
    expect(() => reconnectSession('nothing')).not.toThrow();
  });
});

describe('launchReviewAgent', () => {
  it('launches on the pull request branch with the review prompt', async () => {
    // The prompt and guidance come from app-core so the desktop and the
    // TUI seed a review identically; the branch is the PR's source, not
    // whatever is checked out.
    await launchReviewAgent({
      pr: { id: 42, sourceBranch: 'feature/review' },
      instruction: 'focus on error handling',
      guide: false,
    } as Parameters<typeof launchReviewAgent>[0]);

    expect(state.spawns).toHaveLength(1);
    expect(state.spawns[0].name).toBe(keyFor('feature/review', '/repo-a'));
    expect(state.spawns[0].request).toMatchObject({
      intent: 'seed',
      prompt: 'review #42: focus on error handling',
      systemGuidance: 'guidance',
    });
  });

  it('rejects overlapping reviews with different instructions instead of dropping a prompt', async () => {
    const pr = { id: 1, sourceBranch: 'dup' } as Parameters<
      typeof launchReviewAgent
    >[0]['pr'];
    const first = launchReviewAgent({ pr, instruction: 'first', guide: false });
    await expect(
      launchReviewAgent({ pr, instruction: 'second', guide: false })
    ).rejects.toThrow('Another launch is in progress');
    await first;
    expect(state.spawns[0].request).toMatchObject({
      prompt: 'review #1: first',
    });
  });

  it('forwards the selected review agent and guarded fresh intent', async () => {
    const pr = { id: 1, sourceBranch: 'selected' } as Parameters<
      typeof launchReviewAgent
    >[0]['pr'];
    await launchReviewAgent({ pr, agentId: 'codex', guide: false });
    expect(state.spawns[0]).toMatchObject({
      fresh: true,
      agent: { id: 'codex' },
      request: {
        intent: 'seed',
        prompt: 'review #1',
        systemGuidance: 'guidance',
      },
    });
  });

  it('goes through the same de-duplication as a plain launch', async () => {
    const pr = { id: 1, sourceBranch: 'dup' };
    await Promise.all([
      launchReviewAgent({ pr, guide: false } as Parameters<
        typeof launchReviewAgent
      >[0]),
      launchReviewAgent({ pr, guide: false } as Parameters<
        typeof launchReviewAgent
      >[0]),
    ]);
    expect(state.spawns).toHaveLength(1);
  });

  it('asks for a guided review exactly when the request does', async () => {
    const pr = { id: 7, sourceBranch: 'guided' } as Parameters<
      typeof launchReviewAgent
    >[0]['pr'];
    await launchReviewAgent({ pr, guide: true });
    expect(state.spawns[0].request).toMatchObject({
      systemGuidance: 'guidance, guide',
    });
  });
});

// ── Plan checkout ────────────────────────────────────────────────

describe('checkoutPlan', () => {
  const pr = { id: 7, sourceBranch: 'feature/x' } as never;
  const req = (mode: 'inject' | 'new-session' = 'new-session') => ({
    pr,
    prompt: 'Resolve these PR review comments:\n\n### 1. a.ts:1\n@a: fix it',
    mode,
  });

  it('adopts a spawned session so its output reaches the renderer', async () => {
    // The engine owns the launch; without the host adopting it, the PTY
    // runs with nothing relaying it and the terminal pane stays blank.
    await expect(checkoutPlan(req())).resolves.toBe('spawned');
    emit(keyFor('feature/x', '/repo-a'), 'agent says hello');
    expect(getSessionBuffer(keyFor('feature/x', '/repo-a')).data).toBe(
      'agent says hello'
    );
    expect(listSessions(state.cwd).map((s) => s.name)).toEqual([
      keyFor('feature/x', '/repo-a'),
    ]);
  });

  it('relays output when injection attaches a persisted agent for the first time', async () => {
    addCheckout('feature/x');
    const name = keyFor('feature/x', '/repo-a');
    state.persisted.add(name);
    const request = req('inject');
    await expect(checkoutPlan(request)).resolves.toBe('injected');
    emit(name, 'persisted agent output');
    expect(getSessionBuffer(name).data).toBe('persisted agent output');
    expect(listSessions(state.cwd).map((session) => session.name)).toContain(
      name
    );
  });

  it('injecting neither spawns nor disturbs the scrollback', async () => {
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    emit(keyFor('feature/x', '/repo-a'), 'existing conversation');
    state.spawns = [];

    await expect(checkoutPlan(req('inject'))).resolves.toBe('injected');

    expect(state.spawns).toEqual([]);
    expect(state.injected).toEqual([
      {
        name: keyFor('feature/x', '/repo-a'),
        prompt: req().prompt,
      },
    ]);
    // The pane is showing this text; a reset would blank it.
    expect(getSessionBuffer(keyFor('feature/x', '/repo-a')).data).toBe(
      'existing conversation'
    );
  });

  /**
   * A mounted terminal remembers the sequence number its replay ended
   * at and drops anything at or below it. Numbering a restarted
   * session's chunks from 1 again therefore makes the new agent look
   * dead in a pane that is still on screen — which is exactly the pane
   * you are looking at when you restart one with a plan.
   */
  it('keeps chunk numbering monotonic when it restarts a session', async () => {
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    emit(keyFor('feature/x', '/repo-a'), 'first run');
    const before = getSessionBuffer(keyFor('feature/x', '/repo-a')).seq;
    expect(before).toBe(1);

    await checkoutPlan(req('new-session'));
    emit(keyFor('feature/x', '/repo-a'), 'second run');

    const after = getSessionBuffer(keyFor('feature/x', '/repo-a'));
    expect(after.seq).toBeGreaterThan(before);
    // The scrollback itself does start over — it is a new agent.
    expect(after.data).toBe('second run');
  });

  it('rejects with the reason, so the plan can be retried', async () => {
    state.checkoutFails.add('feature/x');
    await expect(checkoutPlan(req())).rejects.toThrow(
      'Failed to create worktree for feature/x'
    );
  });

  it('refuses to deliver into another repository’s agent', async () => {
    state.cwd = '/repo-a';
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    state.cwd = '/repo-b';

    await expect(checkoutPlan(req('inject'))).resolves.toBe('spawned');
    expect(state.spawns.at(-1)?.name).toBe(keyFor('feature/x', '/repo-b'));
    expect(state.injected).toEqual([]);
  });

  it('collapses a double-send into one delivery', async () => {
    const [a, b] = await Promise.all([
      checkoutPlan(req()),
      checkoutPlan(req()),
    ]);
    expect([a, b]).toEqual(['spawned', 'spawned']);
    expect(state.spawns).toHaveLength(1);
  });

  // ── Cross-machine duplicate agent (Phase 8's closed hole) ─────────
  it('refuses, naming the machine, when the branch already has an agent running elsewhere', async () => {
    state.knownMachines.add('bbbbbbbbbbbbbbbb');
    state.machines = [connectedMachine('bbbbbbbbbbbbbbbb', 'workbox')];
    state.remoteSessions.set('bbbbbbbbbbbbbbbb', [
      remoteWorktreeSession('/repo-a', 'feature/x', 'bbbbbbbbbbbbbbbb'),
    ]);

    await expect(checkoutPlan(req())).rejects.toThrow(/workbox/);
    expect(state.spawns).toEqual([]);
    expect(state.createWorktreeCalls).toEqual([]);
  });

  it('does not refuse for a same-named branch in a different repository on that machine', async () => {
    state.knownMachines.add('bbbbbbbbbbbbbbbb');
    state.machines = [connectedMachine('bbbbbbbbbbbbbbbb', 'workbox')];
    state.remoteSessions.set('bbbbbbbbbbbbbbbb', [
      remoteWorktreeSession(
        '/some-other-repo',
        'feature/x',
        'bbbbbbbbbbbbbbbb'
      ),
    ]);

    await expect(checkoutPlan(req())).resolves.toBe('spawned');
  });

  it('ignores a fleet member that is not connected — nothing to ask', async () => {
    state.machines = [
      {
        ...connectedMachine('bbbbbbbbbbbbbbbb', 'workbox'),
        state: 'offline',
      },
    ];
    state.remoteSessions.set('bbbbbbbbbbbbbbbb', [
      remoteWorktreeSession('/repo-a', 'feature/x', 'bbbbbbbbbbbbbbbb'),
    ]);

    await expect(checkoutPlan(req())).resolves.toBe('spawned');
  });

  it('proceeds locally when no fleet member is running that branch', async () => {
    state.knownMachines.add('bbbbbbbbbbbbbbbb');
    state.machines = [connectedMachine('bbbbbbbbbbbbbbbb', 'workbox')];
    state.remoteSessions.set('bbbbbbbbbbbbbbbb', []);

    await expect(checkoutPlan(req())).resolves.toBe('spawned');
  });

  it('injects into a live local agent even when a peer also has a session for this branch', async () => {
    await launchAgent({ branch: 'feature/x', intent: 'continue-or-blank' });
    state.spawns = [];
    state.knownMachines.add('bbbbbbbbbbbbbbbb');
    state.machines = [connectedMachine('bbbbbbbbbbbbbbbb', 'workbox')];
    state.remoteSessions.set('bbbbbbbbbbbbbbbb', [
      remoteWorktreeSession('/repo-a', 'feature/x', 'bbbbbbbbbbbbbbbb'),
    ]);

    await expect(checkoutPlan(req('inject'))).resolves.toBe('injected');
    expect(state.injected).toEqual([
      {
        name: keyFor('feature/x', '/repo-a'),
        prompt: req().prompt,
      },
    ]);
  });
});

describe('listAgentOptions', () => {
  it('lists the repo config default first, then the rest of the registry', () => {
    state.configByCwd['/repo-a'] = { agentId: 'claude' };
    expect(sessions.listAgentOptions(state.cwd)[0]).toEqual({
      id: 'claude',
      name: 'Claude (default)',
    });
    expect(sessions.listAgentOptions(state.cwd)).toContainEqual({
      id: 'codex',
      name: 'Codex',
    });
  });

  it('labels a custom command as the hidden test runner', () => {
    state.configByCwd['/repo-a'] = {
      agentId: 'test',
      aiCommand: 'node fake.mjs',
    };
    expect(sessions.listAgentOptions(state.cwd)[0]).toEqual({
      id: 'test',
      name: 'Custom (default)',
    });
  });
});

describe('stopping persisted sessions', () => {
  it('stops a retained worktree session with no local connection', () => {
    const name = keyFor('retained', '/repo-a');
    killSession(name);
    expect(state.persistedKilled).toEqual([name]);
  });

  it('does not stop an unregistered session from another repository', () => {
    expect(() => killSession(keyFor('retained', '/repo-b'))).toThrow(
      'another repository'
    );
    expect(state.persistedKilled).toEqual([]);
    expect(state.killed).toEqual([]);
  });

  it('does not stop a foreign registry entry that was never adopted by this host', () => {
    const name = keyFor('retained', '/repo-b');
    state.alive.add(name);
    expect(() => killSession(name)).toThrow('another repository');
    expect(state.alive.has(name)).toBe(true);
    expect(state.killed).toEqual([]);
    expect(state.persistedKilled).toEqual([]);
  });
});
