import { logError } from '@n10/logger';
import {
  deliverToRunningSession,
  getSession,
  hasLiveTmuxSession,
  hasSessionConnection,
  isSessionAlive,
  launchSession,
  sessionKeyForBranch,
  stopSession,
  worktreeSessionKey,
} from '@n10/core';
import { createWorktree, worktreeScope } from '@n10/worktree-manager';
import type { WorktreeScope } from '@n10/worktree-manager';
import type { AppConfig } from '@n10/vcs-core';
import { paneDimension } from '../sessions/session-commands.js';
import type { SessionLaunchPorts } from '../sessions/session-commands.js';
import type { WorktreeConfig } from '../worktrees/worktree-commands.js';
import type { PlanCheckoutRequest, PlanDelivery } from './plan-types.js';

interface Captured {
  request: PlanCheckoutRequest;
  config: AppConfig;
  scope: WorktreeScope;
  ports: SessionLaunchPorts;
}

/** Repository-bound delivery; the cart and its preview remain frontend state. */
export function createPlanCommands(options: {
  config: WorktreeConfig;
  isCurrent(): boolean;
  changed(): Promise<unknown>;
}) {
  const pending = new Map<
    string,
    { signature: string; promise: Promise<PlanDelivery> }
  >();
  const repo = options.config.repo;
  function assertCurrent(): void {
    if (!options.isCurrent())
      throw new Error(
        'The repository changed. Open it again to send this plan.'
      );
  }
  async function checkout(at: Captured): Promise<string> {
    assertCurrent();
    const path = await createWorktree(at.request.pr.sourceBranch, at.scope);
    if (!path)
      throw new Error(
        `Failed to create worktree for ${at.request.pr.sourceBranch}`
      );
    assertCurrent();
    return path;
  }
  async function launch(
    at: Captured,
    cwd: string,
    attach: boolean
  ): Promise<string> {
    assertCurrent();
    const name = worktreeSessionKey(cwd, repo);
    const before = getSession(name);
    await launchSession({
      name,
      cwd,
      ...(attach
        ? { mode: 'attach' as const }
        : { branch: at.request.pr.sourceBranch }),
      cols: paneDimension(at.request.cols, 120),
      rows: paneDimension(at.request.rows, 40),
      config: at.config,
      request: attach
        ? { intent: 'blank' }
        : { intent: 'seed', prompt: at.request.prompt },
    });
    if (!attach || getSession(name) !== before) at.ports.started?.(name, repo);
    return name;
  }
  async function deliver(at: Captured): Promise<PlanDelivery> {
    assertCurrent();
    const current = await sessionKeyForBranch(
      at.request.pr.sourceBranch,
      at.scope
    );
    assertCurrent();
    await at.ports.beforeLaunch?.(at.request.pr.sourceBranch, current);
    assertCurrent();
    const running =
      current && (isSessionAlive(current) || hasLiveTmuxSession(current));
    if (running && at.request.mode === 'inject') {
      if (!isSessionAlive(current) || !hasSessionConnection(current))
        await launch(at, await checkout(at), true);
      assertCurrent();
      if (!deliverToRunningSession(current, at.request.prompt))
        throw new Error('Agent is no longer running');
      return { outcome: 'injected', name: current };
    }
    const cwd = await checkout(at);
    if (running) stopSession(current);
    const name = await launch(at, cwd, false);
    return { outcome: 'spawned', name };
  }
  return {
    checkoutPlan(
      request: PlanCheckoutRequest,
      ports: SessionLaunchPorts = {}
    ): Promise<PlanDelivery> {
      const branch = request.pr.sourceBranch;
      const signature = JSON.stringify([request.prompt, request.mode]);
      const existing = pending.get(branch);
      if (existing)
        return existing.signature === signature
          ? existing.promise
          : Promise.reject(
              new Error(
                'Another plan is being sent to this worktree. Try again when it finishes.'
              )
            );
      const config = options.config.getSnapshot().config;
      const scope = worktreeScope(repo, { template: config.worktreePath });
      const promise = deliver({ request, ports, config, scope }).finally(
        async () => {
          try {
            await options.changed();
          } catch (error) {
            logError('refresh after plan delivery', error);
          } finally {
            pending.delete(branch);
          }
        }
      );
      pending.set(branch, { signature, promise });
      return promise;
    },
  };
}
