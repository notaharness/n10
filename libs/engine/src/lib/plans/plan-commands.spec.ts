import type * as Core from '@n10/core';
import type * as Worktrees from '@n10/worktree-manager';
import { worktreeSessionKey } from '@n10/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig, PullRequestInfo } from '@n10/vcs-core';
import { createPlanCommands } from './plan-commands.js';

const {
  hasSession,
  hasLiveTmuxSession,
  hasSessionConnection,
  stopSession,
  launchSession,
  deliverToRunningSession,
  createWorktree,
} = vi.hoisted(() => ({
  hasSession: vi.fn(),
  hasLiveTmuxSession: vi.fn(),
  hasSessionConnection: vi.fn(),
  stopSession: vi.fn(),
  launchSession: vi.fn(),
  deliverToRunningSession: vi.fn(),
  createWorktree: vi.fn(),
}));
vi.mock('@n10/core', async (original) => ({
  ...(await original<typeof Core>()),
  isSessionAlive: hasSession,
  hasLiveTmuxSession,
  hasSessionConnection,
  stopSession,
  launchSession,
  deliverToRunningSession,
}));
vi.mock('@n10/worktree-manager', async (original) => ({
  ...(await original<typeof Worktrees>()),
  createWorktree: (branch: string) => createWorktree(branch),
  listWorktrees: async () => [{ branch: 'feature/x', path: '/wt/feature-x' }],
}));
let checkoutPlan: ReturnType<typeof createPlanCommands>['checkoutPlan'];
const pr = { id: 7, sourceBranch: 'feature/x' } as PullRequestInfo;
const config = { vendorAuth: {}, vendorProject: {} } as AppConfig;

function deps(mode: 'inject' | 'new-session') {
  return {
    pr,
    prompt: 'Resolve these PR review comments:\n\n### 1. a.ts:1\n@a: b',
    cols: 80,
    rows: 24,
    mode,
  };
}

describe('checkoutPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkoutPlan = createPlanCommands({
      config: {
        repo: '/repo',
        getSnapshot: () => ({ config }),
        subscribe: () => () => undefined,
      },
      isCurrent: () => true,
      changed: async () => undefined,
    }).checkoutPlan;
    hasLiveTmuxSession.mockReturnValue(false);
    hasSessionConnection.mockImplementation((name: string) => hasSession(name));
    createWorktree.mockResolvedValue('/wt/feature-x');
  });

  it('State A / inject: delivers to the running session, never spawns', async () => {
    hasSession.mockReturnValue(true);
    deliverToRunningSession.mockReturnValue(true);

    const result = await checkoutPlan(deps('inject'));

    expect(result.outcome).toBe('injected');
    expect(deliverToRunningSession).toHaveBeenCalledWith(
      worktreeSessionKey('/wt/feature-x', '/repo'),
      expect.stringContaining('Resolve these PR review comments')
    );
    expect(launchSession).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('attaches a persisted live agent before injecting without starting another process', async () => {
    hasSession.mockReturnValue(false);
    hasLiveTmuxSession.mockReturnValue(true);
    deliverToRunningSession.mockReturnValue(true);
    await expect(checkoutPlan(deps('inject'))).resolves.toMatchObject({
      outcome: 'injected',
    });
    expect(launchSession).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'attach' })
    );
    expect(deliverToRunningSession).toHaveBeenCalledOnce();
    expect(stopSession).not.toHaveBeenCalled();
  });

  it('refreshes an exited local entry when Orchestra has already restarted its process', async () => {
    hasSession.mockReturnValue(false);
    hasSessionConnection.mockReturnValue(true);
    hasLiveTmuxSession.mockReturnValue(true);
    deliverToRunningSession.mockReturnValue(true);
    await expect(checkoutPlan(deps('inject'))).resolves.toMatchObject({
      outcome: 'injected',
    });
    expect(launchSession).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'attach' })
    );
  });

  it('stops a persisted live agent before starting a requested fresh plan session', async () => {
    hasSession.mockReturnValue(false);
    hasLiveTmuxSession.mockReturnValue(true);
    await expect(checkoutPlan(deps('new-session'))).resolves.toMatchObject({
      outcome: 'spawned',
    });
    expect(stopSession).toHaveBeenCalledWith(
      worktreeSessionKey('/wt/feature-x', '/repo')
    );
    expect(stopSession.mock.invocationCallOrder[0]).toBeLessThan(
      launchSession.mock.invocationCallOrder[0]
    );
  });

  it('State A / inject: fails when the session is no longer alive', async () => {
    hasSession.mockReturnValue(true);
    deliverToRunningSession.mockReturnValue(false);
    await expect(checkoutPlan(deps('inject'))).rejects.toThrow(
      'Agent is no longer running'
    );
    expect(launchSession).not.toHaveBeenCalled();
  });

  it('State A / new-session: respawns in the existing worktree with the seed intent', async () => {
    hasSession.mockReturnValue(true);

    const result = await checkoutPlan(deps('new-session'));

    expect(result.outcome).toBe('spawned');
    expect(createWorktree).toHaveBeenCalledWith('feature/x');
    expect(launchSession).toHaveBeenCalledTimes(1);
    const arg = launchSession.mock.calls[0][0];
    expect(arg.name).toBe(worktreeSessionKey('/wt/feature-x', '/repo'));
    expect(arg.cwd).toBe('/wt/feature-x');
    // Must seed (deliver the plan), never continue.
    expect(arg.request).toEqual({
      intent: 'seed',
      prompt: expect.stringContaining('Resolve these PR review comments'),
    });
  });

  it('States B/C: no running agent → create worktree + spawn', async () => {
    hasSession.mockReturnValue(false);

    const result = await checkoutPlan(deps('new-session'));

    expect(result.outcome).toBe('spawned');
    expect(createWorktree).toHaveBeenCalledWith('feature/x');
    expect(launchSession).toHaveBeenCalledTimes(1);
    expect(launchSession.mock.calls[0][0].cwd).toBe('/wt/feature-x');
  });

  it('fails when the worktree cannot be created', async () => {
    hasSession.mockReturnValue(false);
    createWorktree.mockResolvedValue(null);
    await expect(checkoutPlan(deps('new-session'))).rejects.toThrow(
      'Failed to create worktree'
    );
    expect(launchSession).not.toHaveBeenCalled();
  });

  it('passes the prompt through verbatim — no quote stripping', async () => {
    hasSession.mockReturnValue(false);

    await checkoutPlan({ ...deps('new-session'), prompt: `it's "quoted"` });

    expect(launchSession.mock.calls[0][0].request.prompt).toBe(`it's "quoted"`);
  });
});
