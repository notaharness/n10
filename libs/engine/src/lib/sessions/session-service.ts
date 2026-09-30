import { paneDimension } from '../kernel/terminal-size.js';
import { createPlanCommands } from '../plans/api.js';
import { createSessionConnections } from './session-connections.js';
import { isDeepStrictEqual } from 'node:util';
import {
  getSession,
  hasSessionConnection,
  isSessionAlive,
  launchSession,
  onSessionExit,
  worktreeSessionRow,
} from '@n10/core';
import type {
  AgentSession,
  DiscoveredTerminal,
  DiscoveredWorktree,
  DiscoveryDelta,
} from '@n10/core';
import { logError } from '@n10/logger';
import type { WorktreeConfig } from '../worktrees/api.js';
import type { WorktreeService } from '../worktrees/api.js';
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
  changed?(delta: DiscoveryDelta): void;
}
export type SessionService = ReturnType<typeof createSessionService>;

/** Observation ends with the repository handle; existing PTY clients survive. */
export function createSessionService(options: {
  config: WorktreeConfig;
  worktrees: WorktreeService;
  isCurrent(): boolean;
  connections?: ReturnType<typeof createSessionConnections>;
}) {
  const { config, worktrees, isCurrent } = options;
  const connections = options.connections ?? createSessionConnections();
  let disposed = false;
  let discovery: SessionDiscovery | undefined;
  let stopWatch: (() => void) | undefined;
  let snapshot: SessionSnapshot = { sessions: [], error: null };
  const listeners = new Set<() => void>();
  function publish(): void {
    if (disposed) return;
    connections.observe();
    const next = {
      sessions: worktrees
        .getSnapshot()
        .worktrees.map((wt) =>
          worktreeSessionRow(wt, isSessionAlive, config.repo)
        ),
      error: worktrees.getSnapshot().error,
    };
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
  return {
    ...createPlanCommands({
      config,
      isCurrent: () => !disposed && isCurrent(),
      changed: refresh,
    }),
    ...createSessionCommands({
      ...options,
      changed: publish,
      isCurrent: () => !disposed && isCurrent(),
    }),
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
      connections.observe();
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
        isCurrent: live,
        adopt: (wt) => adopt(wt, ports, live),
        adoptTerminal: ports.adoptTerminal,
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
      listeners.clear();
    },
  };
}
