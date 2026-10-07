import { paneDimension } from '../kernel/terminal-size.js';
import {
  getSession,
  getSessionLaunchContext,
  hasSessionConnection,
  isSessionAlive,
  launchSession,
  LOCAL_MACHINE,
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
import type { BranchCheckout } from './branch-sessions.js';

export interface SessionLaunch {
  target: WorktreeTarget;
  request: LaunchRequest;
  agentId?: AppConfig['agentId'];
  fresh?: boolean;
  expected?: SessionIncarnation;
  cols?: number;
  rows?: number;
  remote?: { id: string; machine: Machine };
  restore?: {
    sessionName: string;
    tmuxName: string;
    tags: Record<string, string>;
    agent?: string;
    aiCommand?: string;
    env?: Record<string, string>;
    conversationId?: string;
  };
}
export interface SessionLaunchPorts {
  /** Fleet ownership policy, applied before creating a local checkout. */
  beforeLaunch?(branch: string, name: string | null): Promise<void>;
  started?(name: string, repo: string): void;
  progress?(step: 'worktree' | 'start'): void;
}
type SavedIdentity = Extract<
  NonNullable<ReturnType<typeof sessionIdentity>>,
  { kind: 'worktree' }
>;

function selectedConfig(req: SessionLaunch, stored: AppConfig): AppConfig {
  if (!req.restore)
    return req.agentId ? { ...stored, agentId: req.agentId } : stored;
  return {
    ...stored,
    ...(req.restore.agent
      ? { agentId: req.restore.agent as AppConfig['agentId'] }
      : {}),
    ...(req.restore.aiCommand ? { aiCommand: req.restore.aiCommand } : {}),
  };
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
    req.restore,
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
  /** Remote checkouts resolved this run, by machine and branch. */
  const remoteCheckouts = new Map<string, BranchCheckout>();
  function assertCurrent(): void {
    if (!isCurrent())
      throw new Error(
        'The repository changed. Open it again to launch this session.'
      );
  }
  function savedIdentity(req: SessionLaunch): SavedIdentity | null {
    if (!req.restore) return null;
    const identity = sessionIdentity(req.restore.sessionName);
    if (identity?.kind !== 'worktree' || identity.repo !== repo)
      throw new Error('Saved session belongs to another repository.');
    return identity;
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
    return remoteCheckout(req.target.branch, req.remote);
  }
  async function resolveSavedLocal(
    name: string,
    ports: SessionLaunchPorts
  ): Promise<void> {
    const found = await worktrees.find({ session: name });
    assertCurrent();
    if (!found)
      throw new Error('The saved session worktree is no longer available.');
    await ports.beforeLaunch?.(found.branch, name);
    assertCurrent();
  }
  async function launchPath(
    req: SessionLaunch,
    ports: SessionLaunchPorts,
    identity: SavedIdentity | null
  ): Promise<string> {
    if (!identity) return resolve(req, ports);
    if (identity.machine === LOCAL_MACHINE)
      await resolveSavedLocal(req.restore!.sessionName, ports);
    return identity.path;
  }
  async function remoteCheckout(
    branch: string,
    remote: NonNullable<SessionLaunch['remote']>
  ): Promise<string> {
    const created = await worktrees.create(branch, remote.machine);
    const path = await resolveRemoteWorktreePath(
      created,
      remote.machine.executor
    );
    remoteCheckouts.set(JSON.stringify([remote.id, branch]), {
      machine: remote.id,
      path,
      branch,
    });
    return path;
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
    const selected = selectedConfig(req, stored);
    const explicit = req.fresh || req.agentId || req.request.intent === 'blank';
    const before = getSession(name);
    const entry = await launchSession({
      name,
      cwd,
      ...(!req.restore && 'branch' in req.target
        ? { branch: req.target.branch }
        : {}),
      cols: paneDimension(req.cols, 120),
      rows: paneDimension(req.rows, 40),
      config: selected,
      agent: explicit ? resolveAgent(selected) : undefined,
      request: { ...req.request, conversationId: req.restore?.conversationId },
      fresh: req.fresh,
      expected: req.expected,
      restore: req.restore,
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
    const identity = savedIdentity(req);
    const cwd = await launchPath(req, ports, identity);
    assertCurrent();
    const name = identity
      ? req.restore!.sessionName
      : worktreeSessionKey(cwd, repo, req.remote?.id);
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
    /** `branch`'s checkout on this machine or `remote`, created there
     *  when it has none, in that machine's terms. */
    async checkoutOn(
      branch: string,
      remote?: SessionLaunch['remote']
    ): Promise<string> {
      assertCurrent();
      const path = remote
        ? await remoteCheckout(branch, remote)
        : await worktrees.resolve({ branch });
      assertCurrent();
      if (!path) throw new Error(`Failed to check out ${branch}`);
      return path;
    },
    /** The remote checkouts resolved this run. */
    remoteCheckouts(): BranchCheckout[] {
      return [...remoteCheckouts.values()];
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
