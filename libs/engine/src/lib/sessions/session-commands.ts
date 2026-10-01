import { paneDimension } from '../kernel/terminal-size.js';
import {
  getSession,
  getSessionLaunchContext,
  hasSessionConnection,
  isSessionAlive,
  launchSession,
  resolveAgent,
  resolveRemoteWorktreePath,
  sessionIncarnationMatches,
  sessionIdentity,
  stopSession,
  worktreeSessionKey,
} from '@n10/core';
import type { LaunchRequest, SessionIncarnation } from '@n10/core';
import type { AppConfig } from '@n10/vcs-core';
import type { Machine } from '@n10/worktree-manager';
import type { WorktreeService } from '../worktrees/api.js';
import type { WorktreeTarget, WorktreeConfig } from '../worktrees/api.js';

export interface SessionLaunch {
  target: WorktreeTarget;
  request: LaunchRequest;
  agentId?: AppConfig['agentId'];
  fresh?: boolean;
  expected?: SessionIncarnation;
  cols?: number;
  rows?: number;
  remote?: { id: string; machine: Machine };
}
export interface SessionLaunchPorts {
  /** Fleet ownership policy, applied before creating a local checkout. */
  beforeLaunch?(branch: string, name: string | null): Promise<void>;
  started?(name: string, repo: string): void;
  progress?(step: 'worktree' | 'start'): void;
}
function canReuse(req: SessionLaunch, name: string): boolean {
  return (
    !req.fresh &&
    isSessionAlive(name) &&
    hasSessionConnection(name) &&
    (!req.expected || sessionIncarnationMatches(name, req.expected))
  );
}
type Pending = Map<string, { signature: string; promise: Promise<string> }>;
function joinLaunch(
  pending: Pending,
  key: string,
  req: SessionLaunch,
  run: () => Promise<string>
): Promise<string> {
  const signature = JSON.stringify([
    req.target,
    req.request,
    req.agentId,
    req.fresh,
    req.expected,
  ]);
  const active = pending.get(key);
  if (active)
    return active.signature === signature
      ? active.promise
      : Promise.reject(
          new Error(
            'Another launch is in progress for this worktree. Try again when it finishes.'
          )
        );
  const promise = run().finally(() => pending.delete(key));
  pending.set(key, { signature, promise });
  return promise;
}

/** One captured repository owns resolution, intent and concurrent launches. */
export function createSessionCommands(options: {
  config: WorktreeConfig;
  worktrees: WorktreeService;
  changed(): void;
  isCurrent(): boolean;
}) {
  const { config, worktrees, changed, isCurrent } = options;
  const repo = config.repo;
  const requested: Pending = new Map();
  const resolved: Pending = new Map();
  function assertCurrent(): void {
    if (!isCurrent())
      throw new Error(
        'The repository changed. Open it again to launch this session.'
      );
  }
  async function resolveLocal(
    req: SessionLaunch,
    ports: SessionLaunchPorts
  ): Promise<string> {
    const found = await worktrees.find(req.target);
    assertCurrent();
    const branch = 'branch' in req.target ? req.target.branch : found?.branch;
    if (branch === undefined)
      throw new Error('No worktree found for selected session');
    await ports.beforeLaunch?.(
      branch,
      found ? worktreeSessionKey(found.path, repo) : null
    );
    assertCurrent();
    ports.progress?.('worktree');
    const path = found?.path ?? (await worktrees.resolve(req.target));
    if (!path) throw new Error('No worktree found for selected session');
    return path;
  }
  async function resolve(
    req: SessionLaunch,
    ports: SessionLaunchPorts
  ): Promise<string> {
    if (!req.remote) return resolveLocal(req, ports);
    if (!('branch' in req.target))
      throw new Error('Choose a branch to launch on another machine.');
    ports.progress?.('worktree');
    const path = await worktrees.create(req.target.branch, {
      cwd: repo,
      machine: req.remote.machine,
    });
    return resolveRemoteWorktreePath(path, req.remote.machine.executor);
  }
  async function start(
    req: SessionLaunch,
    ports: SessionLaunchPorts,
    cwd: string,
    name: string,
    stored: AppConfig
  ): Promise<string> {
    assertCurrent();
    if (canReuse(req, name)) return name;
    ports.progress?.('start');
    const selected = req.agentId ? { ...stored, agentId: req.agentId } : stored;
    const explicit = req.fresh || req.agentId || req.request.intent === 'blank';
    const before = getSession(name);
    const entry = await launchSession({
      name,
      cwd,
      ...('branch' in req.target ? { branch: req.target.branch } : {}),
      cols: paneDimension(req.cols, 120),
      rows: paneDimension(req.rows, 40),
      config: selected,
      agent: explicit ? resolveAgent(selected) : undefined,
      request: req.request,
      fresh: req.fresh,
      expected: req.expected,
    });
    if (entry !== before) ports.started?.(name, repo);
    changed();
    return name;
  }
  async function perform(
    req: SessionLaunch,
    ports: SessionLaunchPorts
  ): Promise<string> {
    assertCurrent();
    const stored = config.getSnapshot().config;
    const cwd = await resolve(req, ports);
    assertCurrent();
    const name = worktreeSessionKey(cwd, repo, req.remote?.id);
    // A branch request and a checkout request can resolve to the same PTY.
    return joinLaunch(resolved, name, req, () =>
      start(req, ports, cwd, name, stored)
    );
  }
  return {
    async launchContext(target: WorktreeTarget) {
      assertCurrent();
      const stored = config.getSnapshot().config;
      const found = await worktrees.find(target);
      assertCurrent();
      return {
        ...(found
          ? getSessionLaunchContext(
              worktreeSessionKey(found.path, repo),
              stored
            )
          : { exists: false, running: false, canResume: false }),
        defaultAgentName: resolveAgent(stored).name,
      };
    },
    launch(
      req: SessionLaunch,
      ports: SessionLaunchPorts = {}
    ): Promise<string> {
      const key = JSON.stringify([req.target, req.remote?.id]);
      return joinLaunch(requested, key, req, () => perform(req, ports));
    },
    stop(name: string): void {
      assertCurrent();
      const identity = sessionIdentity(name);
      if (identity?.kind !== 'worktree' || identity.repo !== repo)
        throw new Error('This session belongs to another repository.');
      stopSession(name);
      changed();
    },
  };
}
