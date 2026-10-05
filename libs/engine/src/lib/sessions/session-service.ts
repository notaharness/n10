import { paneDimension } from '../kernel/terminal-size.js';
import { createPlanCommands } from '../plans/api.js';
import { createSessionConnections } from './session-connections.js';
import { isDeepStrictEqual } from 'node:util';
import {
  canonicalWorktreePath,
  getSession,
  hasSessionConnection,
  isSessionAlive,
  launchSession,
  LOCAL_MACHINE,
  onSessionExit,
  strandedSessionRows,
  worktreeSessionRow,
} from '@n10/core';
import type {
  AgentSession,
  DiscoveredTerminal,
  DiscoveredWorktree,
  DiscoveryDelta,
  DiscoveryScan,
} from '@n10/core';
import { logError } from '@n10/logger';
import type { WorktreeConfig } from '../worktrees/api.js';
import type { WorktreeService } from '../worktrees/api.js';
import {
  branchSessions,
  remoteAgentCheckouts,
  terminalBranch,
} from './branch-sessions.js';
import type {
  AgentConnection,
  BranchSessions,
  BranchTerminal,
} from './branch-sessions.js';
import { createSessionCommands } from './session-commands.js';
import type { SessionLaunchPorts } from './session-commands.js';
import { startSessionDiscovery } from './session-discovery.js';
import type { SessionDiscovery } from './session-discovery.js';

export interface SessionSnapshot {
  sessions: AgentSession[];
  error: string | null;
}
export interface SessionWatchPorts extends SessionLaunchPorts {
  size(): { cols: number; rows: number };
  adoptTerminal?(terminal: DiscoveredTerminal): void | Promise<void>;
  /** The connected machines whose terminals discovery lists too. */
  remoteMachines?(): readonly string[];
  changed?(delta: DiscoveryDelta): void;
}
export type SessionService = ReturnType<typeof createSessionService>;

/** Observation ends with the repository handle; existing PTY clients survive. */
export function createSessionService(options: {
  config: WorktreeConfig;
  worktrees: WorktreeService;
  isCurrent(): boolean;
  connections?: ReturnType<typeof createSessionConnections>;
  /** Each repository's last discovery scan, kept across handles: a
   *  reopened repository's scanner starts from it, so worktrees removed
   *  while another repository was open are reported removed. */
  lastScans?: Map<string, DiscoveryScan>;
}) {
  const { config, worktrees, isCurrent } = options;
  const lastScans = options.lastScans ?? new Map<string, DiscoveryScan>();
  const connections = options.connections ?? createSessionConnections();
  const ownsConnections = !options.connections;
  let disposed = false;
  let discovery: SessionDiscovery | undefined;
  let stopWatch: (() => void) | undefined;
  let snapshot: SessionSnapshot = { sessions: [], error: null };
  const listeners = new Set<() => void>();
  function publish(): void {
    if (disposed) return;
    // A row per worktree, then one per agent still running in a
    // worktree that is gone, so it can be seen and stopped. One
    // discovery holds stranded stays so while git does not list it,
    // whatever recreated its directory.
    const rows = worktrees
      .getSnapshot()
      .worktrees.map((wt) =>
        worktreeSessionRow(wt, isSessionAlive, config.repo)
      );
    const listed = new Set(rows.map((row) => row.name));
    const stranded = new Set(
      discovery?.lastScan()?.stranded.map((wt) => wt.name)
    );
    const next = {
      sessions: [
        ...rows,
        ...strandedSessionRows(
          config.repo,
          isSessionAlive,
          (name) => stranded.has(name) && !listed.has(name)
        ),
      ],
      error: worktrees.getSnapshot().error,
    };
    scanUnseen();
    if (isDeepStrictEqual(next, snapshot)) return;
    snapshot = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        logError('session observer', error);
      }
    }
  }
  /** Discovery reports only the removal of a worktree it has seen, and a
   *  shell can show any worktree this resource lists. One discovery has
   *  not seen yet is scanned for now rather than at the next tick, or a
   *  removal before that tick would go unreported. */
  function scanUnseen(): void {
    const seen = discovery?.lastScan();
    if (!seen) return;
    const paths = new Set(seen.worktrees.map((wt) => wt.path));
    const listed = worktrees.getSnapshot().worktrees;
    // `scanNow` settles every scan itself and never rejects.
    if (listed.some((wt) => !paths.has(wt.path))) void discovery?.scanNow();
  }
  const unsubscribeWorktrees = worktrees.subscribe(publish);
  async function refresh(): Promise<AgentSession[]> {
    await worktrees.refresh();
    publish();
    return snapshot.sessions;
  }
  async function adopt(
    wt: DiscoveredWorktree,
    ports: SessionWatchPorts,
    live: () => boolean
  ): Promise<void> {
    await ports.beforeLaunch?.(wt.branch, wt.name);
    if (!live() || (isSessionAlive(wt.name) && hasSessionConnection(wt.name)))
      return;
    const size = ports.size();
    const before = getSession(wt.name);
    const entry = await launchSession({
      name: wt.name,
      cwd: wt.path,
      mode: 'attach',
      cols: paneDimension(size.cols, 120),
      rows: paneDimension(size.rows, 40),
      config: config.getSnapshot().config,
      request: { intent: 'continue-or-blank' },
    });
    if (entry !== before) ports.started?.(wt.name, config.repo);
  }
  /** Every checkout known here: this machine's linked worktrees (the
   *  main checkout is the repository, not a branch's), remote ones
   *  resolved this run, and those remote agents work in. */
  function knownCheckouts(agents: readonly AgentConnection[]) {
    const root = canonicalWorktreePath(config.repo);
    const local = worktrees.getSnapshot().worktrees.flatMap((wt) => {
      const path = canonicalWorktreePath(wt.path);
      return wt.branch && path !== root
        ? [{ machine: LOCAL_MACHINE, path, branch: wt.branch }]
        : [];
    });
    return [
      ...local,
      ...commands.remoteCheckouts(),
      ...remoteAgentCheckouts(agents),
    ];
  }
  const commands = createSessionCommands({
    ...options,
    changed: publish,
    isCurrent: () => !disposed && isCurrent(),
  });
  return {
    ...createPlanCommands({
      config,
      isCurrent: () => !disposed && isCurrent(),
      changed: refresh,
    }),
    ...commands,
    /** Stopping kills the session without an exit to report, so
     *  discovery looks at once: a stranded worktree is gone with it. */
    stop(name: string): void {
      commands.stop(name);
      void discovery?.scanNow();
    },
    /** The agents and `terminals` working in `branch`'s checkouts. */
    branchSessions(
      branch: string,
      terminals: readonly BranchTerminal[]
    ): BranchSessions {
      const agents = connections.read(config.repo);
      return branchSessions({
        branch,
        checkouts: knownCheckouts(agents),
        agents,
        terminals,
      });
    },
    /** The branch whose checkout `terminal` is in: its review tab lists
     *  it. Undefined for any other directory, the main checkout's too. */
    terminalBranch(terminal: Pick<BranchTerminal, 'machine' | 'cwd'>) {
      return terminalBranch(
        terminal,
        knownCheckouts(connections.read(config.repo))
      );
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    async read(): Promise<AgentSession[]> {
      await worktrees.read();
      publish();
      return snapshot.sessions;
    },
    connections() {
      return connections.read(config.repo);
    },
    scanNow: async () => {
      await discovery?.scanNow();
    },
    watch(ports: SessionWatchPorts): () => void {
      stopWatch?.();
      if (disposed) return () => undefined;
      let stopped = false;
      const live = () => !stopped && !disposed && isCurrent();
      const scanner = startSessionDiscovery({
        repo: config.repo,
        scope: worktrees.scope,
        baseline: lastScans.get(config.repo),
        isCurrent: live,
        adopt: (wt) => adopt(wt, ports, live),
        adoptTerminal: ports.adoptTerminal,
        remoteMachines: ports.remoteMachines,
        onChanged(delta) {
          void refresh();
          ports.changed?.(delta);
        },
      });
      discovery = scanner;
      const offExit = onSessionExit(publish);
      void refresh();
      const stop = () => {
        stopped = true;
        const scan = scanner.lastScan();
        if (scan) lastScans.set(config.repo, scan);
        scanner.stop();
        offExit();
        if (discovery === scanner) discovery = undefined;
      };
      stopWatch = stop;
      return stop;
    },
    dispose() {
      disposed = true;
      stopWatch?.();
      unsubscribeWorktrees();
      if (ownsConnections) connections.dispose();
      listeners.clear();
    },
  };
}
